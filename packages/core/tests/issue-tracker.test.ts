import { describe, expect, it } from "vitest";

import {
  dashboardCounts,
  decisionHistoryForCard,
  filterIssueCards,
  sortIssueCards,
  summarizeRevisionInput,
} from "@contractops/core";
import type {
  AgentRun,
  IssueCard,
  IssueDecisionHistoryEntry,
  IssueHumanDecision,
  IssueSeverity,
} from "@contractops/schemas";

function card(overrides: Partial<IssueCard> = {}): IssueCard {
  return {
    issue_id: "ic",
    project_id: "proj",
    source_agent: "mock_counterparty",
    severity: "medium",
    location: { article: "제1조" },
    issue_type: "term_clarity",
    problem: "테스트 문제",
    why_it_matters: "테스트",
    recommended_revision: "수정안",
    business_impact: "moderate",
    recommended_action: "revise",
    human_decision: "pending",
    partial_note: null,
    reason_note: null,
    decided_by: null,
    decided_at: null,
    applied_version: null,
    ...overrides,
  };
}

function agentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "ar",
    project_id: "proj",
    role: "deal_memo_drafter",
    source_agent: "mock_drafter",
    provider_id: "mock",
    model_id: "mock",
    mode: "mock",
    prompt_version: null,
    input_hash: null,
    output_json: null,
    output_text: null,
    status: "completed",
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:01.000Z",
    error_message: null,
    token_usage: null,
    cost_estimate: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// filterIssueCards
// ─────────────────────────────────────────────────────────────────────────

describe("filterIssueCards", () => {
  const cards: IssueCard[] = [
    card({ issue_id: "a", severity: "critical", human_decision: "pending", problem: "Korean numbering" }),
    card({ issue_id: "b", severity: "high", human_decision: "accepted", source_agent: "deterministic_qa", issue_type: "amount_format", problem: "VAT mismatch" }),
    card({ issue_id: "c", severity: "low", human_decision: "rejected", recommended_revision: "Replace 결과손해 with 간접손해" }),
    card({ issue_id: "d", severity: "medium", human_decision: "deferred", source_agent: "mock_counterparty", problem: "penalty cap" }),
  ];

  it("returns all cards when criteria is empty", () => {
    expect(filterIssueCards(cards, {})).toHaveLength(4);
  });

  it("filters by severity", () => {
    const out = filterIssueCards(cards, { severities: ["critical", "high"] });
    expect(out.map((c) => c.issue_id)).toEqual(["a", "b"]);
  });

  it("filters by human_decision", () => {
    expect(filterIssueCards(cards, { decisions: ["pending"] }).map((c) => c.issue_id)).toEqual(["a"]);
    expect(filterIssueCards(cards, { decisions: ["rejected", "deferred"] }).map((c) => c.issue_id)).toEqual(["c", "d"]);
  });

  it("filters by source_agent", () => {
    expect(
      filterIssueCards(cards, { source_agents: ["deterministic_qa"] }).map((c) => c.issue_id),
    ).toEqual(["b"]);
  });

  it("filters by issue_type", () => {
    expect(filterIssueCards(cards, { issue_types: ["amount_format"] }).map((c) => c.issue_id)).toEqual(["b"]);
  });

  it("text-searches across problem, recommended_revision, why_it_matters, business_impact (case-insensitive)", () => {
    expect(filterIssueCards(cards, { text: "VAT" }).map((c) => c.issue_id)).toEqual(["b"]);
    // hits recommended_revision
    expect(filterIssueCards(cards, { text: "결과손해" }).map((c) => c.issue_id)).toEqual(["c"]);
    // case-insensitive
    expect(filterIssueCards(cards, { text: "PENALTY" }).map((c) => c.issue_id)).toEqual(["d"]);
    // no match
    expect(filterIssueCards(cards, { text: "nothing-matches-this" })).toEqual([]);
  });

  it("combines filters with AND semantics", () => {
    const out = filterIssueCards(cards, { severities: ["high"], decisions: ["accepted"] });
    expect(out.map((c) => c.issue_id)).toEqual(["b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sortIssueCards
// ─────────────────────────────────────────────────────────────────────────

describe("sortIssueCards", () => {
  const a = card({ issue_id: "a", severity: "low", human_decision: "accepted", decided_at: "2026-03-01T00:00:00.000Z" });
  const b = card({ issue_id: "b", severity: "critical", human_decision: "pending" });
  const c2 = card({ issue_id: "c", severity: "high", human_decision: "rejected", decided_at: "2026-04-01T00:00:00.000Z" });
  const d = card({ issue_id: "d", severity: "medium", human_decision: "pending" });

  it("default pending_first puts pending cards first, then severity high→low", () => {
    const out = sortIssueCards([a, b, c2, d]);
    expect(out.map((x) => x.issue_id)).toEqual(["b", "d", "c", "a"]);
    // b (critical pending), d (medium pending), c (high rejected), a (low accepted)
  });

  it("severity_high_to_low ignores decision", () => {
    const out = sortIssueCards([a, b, c2, d], "severity_high_to_low");
    expect(out.map((x) => x.severity)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("newest_first orders by decided_at descending; undecided fall last", () => {
    const out = sortIssueCards([a, b, c2, d], "newest_first");
    // c (Apr) → a (Mar) → b,d (undecided)
    expect(out[0]!.issue_id).toBe("c");
    expect(out[1]!.issue_id).toBe("a");
    expect(out.slice(2).every((c) => c.human_decision === "pending")).toBe(true);
  });

  it("oldest_first orders by decided_at ascending", () => {
    const out = sortIssueCards([a, b, c2, d], "oldest_first");
    expect(out[0]!.issue_id).toBe("a");
    expect(out[1]!.issue_id).toBe("c");
    expect(out.slice(2).every((c) => c.human_decision === "pending")).toBe(true);
  });

  it("decision_status orders pending → accepted → partially → rejected → deferred", () => {
    const all: IssueCard[] = [
      card({ issue_id: "p", human_decision: "pending" }),
      card({ issue_id: "ac", human_decision: "accepted" }),
      card({ issue_id: "pa", human_decision: "partially_accepted" }),
      card({ issue_id: "re", human_decision: "rejected" }),
      card({ issue_id: "de", human_decision: "deferred" }),
    ];
    const out = sortIssueCards([...all].reverse(), "decision_status");
    expect(out.map((x) => x.issue_id)).toEqual(["p", "ac", "pa", "re", "de"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b];
    const before = input.slice();
    sortIssueCards(input);
    expect(input).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// dashboardCounts
// ─────────────────────────────────────────────────────────────────────────

describe("dashboardCounts", () => {
  it("counts every decision bucket, severity bucket, and special source agents", () => {
    const cards: IssueCard[] = [
      card({ issue_id: "1", severity: "critical", human_decision: "pending" }),
      card({ issue_id: "2", severity: "high", human_decision: "pending" }),
      card({ issue_id: "3", severity: "medium", human_decision: "accepted" }),
      card({ issue_id: "4", severity: "low", human_decision: "partially_accepted", partial_note: "..." }),
      card({ issue_id: "5", severity: "low", human_decision: "rejected" }),
      card({ issue_id: "6", severity: "high", human_decision: "deferred" }),
      card({ issue_id: "7", severity: "high", source_agent: "deterministic_qa", human_decision: "accepted" }),
    ];
    const runs = [agentRun({ id: "r1" }), agentRun({ id: "r2", mode: "real" })];
    const qa_runs = [
      {
        findings: [
          { check_id: "forbidden_expressions" as const, severity: "medium" as IssueSeverity, location: {}, problem: "x", why_it_matters: "y", recommended_revision: "z" },
        ],
        checks_run: [],
      },
    ];
    const c = dashboardCounts(cards, runs, qa_runs);
    expect(c.total).toBe(7);
    expect(c.pending).toBe(2);
    expect(c.accepted).toBe(2);
    expect(c.partially_accepted).toBe(1);
    expect(c.rejected).toBe(1);
    expect(c.deferred).toBe(1);
    // critical (1) + high (3 — including the det_qa one)
    expect(c.critical_high).toBe(4);
    expect(c.deterministic_qa_findings).toBe(1);
    expect(c.real_agent_runs).toBe(1);
    expect(c.deterministic_qa_finding_total).toBe(1);
    expect(c.blocks_final_approval).toBe(true);
  });

  it("blocks_final_approval is false when every card has been decided", () => {
    const cards: IssueCard[] = [card({ human_decision: "accepted" })];
    expect(dashboardCounts(cards).blocks_final_approval).toBe(false);
  });

  it("handles empty inputs", () => {
    const c = dashboardCounts([], [], []);
    expect(c).toMatchObject({
      total: 0,
      pending: 0,
      accepted: 0,
      partially_accepted: 0,
      rejected: 0,
      deferred: 0,
      critical_high: 0,
      deterministic_qa_findings: 0,
      real_agent_runs: 0,
      deterministic_qa_finding_total: 0,
      blocks_final_approval: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// summarizeRevisionInput
// ─────────────────────────────────────────────────────────────────────────

describe("summarizeRevisionInput", () => {
  it("partitions every card into exactly one group", () => {
    const all: IssueCard[] = [
      card({ issue_id: "1", human_decision: "accepted" }),
      card({ issue_id: "2", human_decision: "partially_accepted", partial_note: "n" }),
      card({ issue_id: "3", human_decision: "rejected" }),
      card({ issue_id: "4", human_decision: "deferred" }),
      card({ issue_id: "5", human_decision: "pending" }),
    ];
    const s = summarizeRevisionInput(all);
    expect(s.to_be_applied.map((c) => c.issue_id)).toEqual(["1"]);
    expect(s.partially_applied.map((c) => c.issue_id)).toEqual(["2"]);
    expect(s.skipped.map((c) => c.issue_id)).toEqual(["3", "4"]);
    expect(s.pending.map((c) => c.issue_id)).toEqual(["5"]);
    const total = s.to_be_applied.length + s.partially_applied.length + s.skipped.length + s.pending.length;
    expect(total).toBe(all.length);
  });

  it("rejected and deferred cards never appear in to_be_applied or partially_applied", () => {
    const cards: IssueCard[] = [
      card({ human_decision: "rejected" }),
      card({ human_decision: "deferred" }),
    ];
    const s = summarizeRevisionInput(cards);
    expect(s.to_be_applied).toEqual([]);
    expect(s.partially_applied).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// decisionHistoryForCard
// ─────────────────────────────────────────────────────────────────────────

describe("decisionHistoryForCard", () => {
  const baseEntry = (over: Partial<IssueDecisionHistoryEntry>): IssueDecisionHistoryEntry => ({
    id: "h",
    project_id: "p",
    issue_id: "x",
    previous_decision: "pending" as IssueHumanDecision,
    new_decision: "accepted" as IssueHumanDecision,
    actor_id: "u",
    actor_role: "human_lawyer",
    changed_at: "2026-01-01T00:00:00.000Z",
    partial_note: null,
    reason_note: null,
    ...over,
  });

  it("returns only the entries for the requested issue, preserving insertion order", () => {
    const history: IssueDecisionHistoryEntry[] = [
      baseEntry({ id: "h1", issue_id: "a", new_decision: "rejected" }),
      baseEntry({ id: "h2", issue_id: "b", new_decision: "accepted" }),
      baseEntry({ id: "h3", issue_id: "a", previous_decision: "rejected", new_decision: "accepted" }),
    ];
    const out = decisionHistoryForCard(history, "a");
    expect(out.map((h) => h.id)).toEqual(["h1", "h3"]);
  });
});
