import { describe, expect, it } from "vitest";

import {
  aggDecideIssue,
  decideIssueCard,
  type ProjectState,
} from "@contractops/core";
import type { IssueCard } from "@contractops/schemas";
import { humanLawyer, otherLawyer, nonLawyer, testEnv } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

function pendingCard(overrides: Partial<IssueCard> = {}): IssueCard {
  return {
    issue_id: "ic_demo",
    project_id: "proj_demo",
    source_agent: "mock_counterparty",
    severity: "high",
    location: { article: "제3조" },
    issue_type: "term_clarity",
    problem: "테스트용 문제",
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

function projectStateWithCards(cards: IssueCard[]): ProjectState {
  // Minimal ProjectState shape — only fields aggDecideIssue inspects.
  return {
    project: {
      id: "proj_demo",
      name: "Demo",
      status: "issues_open",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "user_demo",
    },
    source_pack: {
      id: "sp_demo",
      project_id: "proj_demo",
      locked: true,
      locked_at: "2026-01-01T00:00:00.000Z",
      document_ids: [],
    },
    source_documents: [],
    source_contents: [],
    contract_type: null,
    playbook: null,
    intake_questions: [],
    intake_answers: [],
    deal_memo: null,
    drafting_plan: null,
    contract_versions: [],
    issue_cards: cards,
    agent_runs: [],
    exports: [],
    qa_runs: [],
    decision_history: [],
  } as unknown as ProjectState;
}

// ─────────────────────────────────────────────────────────────────────────
// decideIssueCard (low-level)
// ─────────────────────────────────────────────────────────────────────────

describe("decideIssueCard — history entry shape", () => {
  it("produces a history_entry whose previous_decision is 'pending' on first decision", () => {
    const card = pendingCard();
    const env = testEnv();
    const res = decideIssueCard({
      issue_card: card,
      decision: "rejected",
      decided_by: humanLawyer,
      reason_note: "  논점 외 / out of scope ",
      env,
    });
    expect(res.history_entry.previous_decision).toBe("pending");
    expect(res.history_entry.new_decision).toBe("rejected");
    expect(res.history_entry.actor_id).toBe(humanLawyer.id);
    expect(res.history_entry.actor_role).toBe("human_lawyer");
    expect(res.history_entry.reason_note).toBe("논점 외 / out of scope"); // trimmed
    expect(res.history_entry.partial_note).toBeNull();
    expect(res.issue_card.reason_note).toBe("논점 외 / out of scope");
  });

  it("captures the prior decision when the same card is decided a second time", () => {
    const card = pendingCard();
    const env = testEnv();
    const first = decideIssueCard({
      issue_card: card,
      decision: "rejected",
      decided_by: humanLawyer,
      env,
    });
    const second = decideIssueCard({
      issue_card: first.issue_card,
      decision: "accepted",
      decided_by: otherLawyer,
      reason_note: "reconsidered",
      env,
    });
    expect(first.history_entry.previous_decision).toBe("pending");
    expect(first.history_entry.new_decision).toBe("rejected");
    expect(second.history_entry.previous_decision).toBe("rejected");
    expect(second.history_entry.new_decision).toBe("accepted");
    expect(second.history_entry.actor_id).toBe(otherLawyer.id);
    expect(second.history_entry.reason_note).toBe("reconsidered");
  });

  it("preserves the partially_accepted partial_note in the history entry", () => {
    const card = pendingCard();
    const env = testEnv();
    const res = decideIssueCard({
      issue_card: card,
      decision: "partially_accepted",
      decided_by: humanLawyer,
      partial_note: "50% cap only",
      reason_note: "내부 합의 범위 내",
      env,
    });
    expect(res.history_entry.partial_note).toBe("50% cap only");
    expect(res.history_entry.reason_note).toBe("내부 합의 범위 내");
  });

  it("still throws when partially_accepted has no partial_note (unchanged invariant)", () => {
    const env = testEnv();
    expect(() =>
      decideIssueCard({
        issue_card: pendingCard(),
        decision: "partially_accepted",
        decided_by: humanLawyer,
        env,
      }),
    ).toThrow(/partial_note/i);
  });

  it("still rejects non-human-lawyer actors (unchanged invariant)", () => {
    const env = testEnv();
    expect(() =>
      decideIssueCard({
        issue_card: pendingCard(),
        decision: "accepted",
        decided_by: nonLawyer,
        env,
      }),
    ).toThrow(/human lawyer/i);
  });

  it("audit payload now carries previous_decision + reason_note", () => {
    const card = pendingCard();
    const env = testEnv();
    const res = decideIssueCard({
      issue_card: card,
      decision: "deferred",
      decided_by: humanLawyer,
      reason_note: "wait for finance approval",
      env,
    });
    expect(res.audit.event_type).toBe("issue_card_decided");
    expect(res.audit.payload.previous_decision).toBe("pending");
    expect(res.audit.payload.decision).toBe("deferred");
    expect(res.audit.payload.reason_note).toBe("wait for finance approval");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// aggDecideIssue (state-level append-only)
// ─────────────────────────────────────────────────────────────────────────

describe("aggDecideIssue — ProjectState.decision_history is append-only", () => {
  it("appends a history entry on first decision and never overwrites it on subsequent decisions", () => {
    const card = pendingCard();
    let state = projectStateWithCards([card]);
    const env1 = testEnv();
    state = aggDecideIssue(
      state,
      { issue_id: card.issue_id, decision: "rejected", decided_by: humanLawyer, reason_note: "initial reject" },
      env1,
    ).state;
    expect(state.decision_history).toHaveLength(1);
    expect(state.decision_history[0]!.previous_decision).toBe("pending");
    expect(state.decision_history[0]!.new_decision).toBe("rejected");
    const firstId = state.decision_history[0]!.id;

    // Re-decide
    const env2 = testEnv();
    state = aggDecideIssue(
      state,
      { issue_id: card.issue_id, decision: "accepted", decided_by: humanLawyer, reason_note: "reconsidered" },
      env2,
    ).state;
    expect(state.decision_history).toHaveLength(2);
    // The earlier entry is still there with the same id and same payload.
    expect(state.decision_history[0]!.id).toBe(firstId);
    expect(state.decision_history[0]!.previous_decision).toBe("pending");
    expect(state.decision_history[0]!.new_decision).toBe("rejected");
    expect(state.decision_history[0]!.reason_note).toBe("initial reject");

    // The newer entry was appended, not prepended, with the right link.
    expect(state.decision_history[1]!.previous_decision).toBe("rejected");
    expect(state.decision_history[1]!.new_decision).toBe("accepted");
    expect(state.decision_history[1]!.reason_note).toBe("reconsidered");
  });

  it("works across multiple cards independently", () => {
    const a = pendingCard({ issue_id: "ic_a" });
    const b = pendingCard({ issue_id: "ic_b" });
    let state = projectStateWithCards([a, b]);
    const env = testEnv();
    state = aggDecideIssue(state, { issue_id: "ic_a", decision: "accepted", decided_by: humanLawyer }, env).state;
    state = aggDecideIssue(state, { issue_id: "ic_b", decision: "rejected", decided_by: humanLawyer }, env).state;
    state = aggDecideIssue(state, { issue_id: "ic_a", decision: "rejected", decided_by: humanLawyer }, env).state;
    expect(state.decision_history).toHaveLength(3);
    expect(state.decision_history.filter((h) => h.issue_id === "ic_a")).toHaveLength(2);
    expect(state.decision_history.filter((h) => h.issue_id === "ic_b")).toHaveLength(1);
  });

  it("emits one AuditLog entry per decision call (existing behavior preserved)", () => {
    let state = projectStateWithCards([pendingCard()]);
    const env = testEnv();
    const first = aggDecideIssue(
      state,
      { issue_id: "ic_demo", decision: "accepted", decided_by: humanLawyer },
      env,
    );
    expect(first.audits).toHaveLength(1);
    state = first.state;
    const second = aggDecideIssue(
      state,
      { issue_id: "ic_demo", decision: "rejected", decided_by: humanLawyer },
      env,
    );
    expect(second.audits).toHaveLength(1);
  });
});
