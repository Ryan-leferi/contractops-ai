import { describe, expect, it } from "vitest";
import {
  aggCreateRevision,
  aggDecideIssue,
  aggRunMockFinalQA,
  aggRunMockReviews,
  recordMockAgentRun,
} from "@contractops/core";
import { humanLawyer, testEnv } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";

describe("recordMockAgentRun", () => {
  it("populates all required fields and marks mode=mock", () => {
    const env = testEnv();
    const run = recordMockAgentRun({
      project_id: "p1",
      source_agent: "mock_claude",
      role: "counterparty_reviewer",
      output_json: { findings: 3 },
      prompt_version: "v1",
      input_hash: "v0_hash",
      env,
    });
    expect(run.mode).toBe("mock");
    expect(run.provider_id).toBe("mock");
    expect(run.model_id).toBe("mock-v1");
    expect(run.source_agent).toBe("mock_claude");
    expect(run.role).toBe("counterparty_reviewer");
    expect(run.prompt_version).toBe("v1");
    expect(run.input_hash).toBe("v0_hash");
    expect(run.output_json).toEqual({ findings: 3 });
    expect(run.status).toBe("completed");
    expect(run.started_at).toBeTruthy();
    expect(run.completed_at).toBeTruthy();
    expect(run.error_message).toBeNull();
  });
});

describe("Aggregate ops create AgentRun records", () => {
  it("aggDraftDealMemo / aggDraftDraftingPlan / aggCreateV0 each create an AgentRun", () => {
    const ready = buildToReadyForReviews("nda.json");
    expect(ready.s.agent_runs.some((r) => r.role === "deal_memo_drafter")).toBe(true);
    expect(ready.s.agent_runs.some((r) => r.role === "drafting_plan_drafter")).toBe(true);
    expect(ready.s.agent_runs.some((r) => r.role === "contract_drafter")).toBe(true);
  });

  it("aggRunMockReviews creates one AgentRun per default provider plus IssueCards", () => {
    const ready = buildToReadyForReviews("nda.json");
    const res = aggRunMockReviews(
      ready.s,
      {
        seeds: [
          {
            source_agent: "mock_claude",
            severity: "high",
            location: { article: "제3조" },
            issue_type: "obligation_scope",
            problem: "scope too broad",
            why_it_matters: "risk",
            recommended_revision: "narrow it",
            business_impact: "moderate",
            recommended_action: "revise",
          },
          {
            source_agent: "mock_gemini",
            severity: "medium",
            location: { article: "제4조" },
            issue_type: "source_inconsistency",
            problem: "schedule mismatch",
            why_it_matters: "inconsistency",
            recommended_revision: "reconcile schedule",
            business_impact: "low",
            recommended_action: "revise",
          },
        ],
      },
      ready.env,
    );
    const reviewRuns = res.state.agent_runs.filter(
      (r) =>
        r.role === "counterparty_reviewer" ||
        r.role === "source_consistency_reviewer" ||
        r.role === "legal_style_reviewer" ||
        r.role === "deterministic_qa",
    );
    expect(reviewRuns.length).toBeGreaterThanOrEqual(4);
    expect(res.state.issue_cards.length).toBe(2);
    for (const r of reviewRuns) expect(r.mode).toBe("mock");
  });

  it("aggCreateRevision creates a revision_agent AgentRun", () => {
    const ready = buildToReadyForReviews("nda.json");
    let s = aggRunMockReviews(ready.s, {
      seeds: [
        {
          source_agent: "mock_claude",
          severity: "low",
          location: {},
          issue_type: "x",
          problem: "x",
          why_it_matters: "x",
          recommended_revision: "x",
          business_impact: "x",
          recommended_action: "accept",
        },
      ],
    }, ready.env).state;
    s = aggDecideIssue(s, {
      issue_id: s.issue_cards[0]!.issue_id,
      decision: "accepted",
      decided_by: humanLawyer,
    }, ready.env).state;
    const rev = aggCreateRevision(s, {}, ready.env);
    expect(rev.state.agent_runs.some((r) => r.role === "revision_agent")).toBe(true);
  });

  it("aggRunMockFinalQA creates a final_qa_assistant AgentRun", () => {
    const ready = buildToReadyForReviews("nda.json");
    let s = aggRunMockReviews(ready.s, {
      seeds: [
        {
          source_agent: "mock_claude",
          severity: "low",
          location: {},
          issue_type: "x",
          problem: "x",
          why_it_matters: "x",
          recommended_revision: "x",
          business_impact: "x",
          recommended_action: "accept",
        },
      ],
    }, ready.env).state;
    s = aggDecideIssue(s, {
      issue_id: s.issue_cards[0]!.issue_id,
      decision: "accepted",
      decided_by: humanLawyer,
    }, ready.env).state;
    s = aggCreateRevision(s, {}, ready.env).state;

    const qa = aggRunMockFinalQA(s, ready.env);
    expect(qa.state.agent_runs.some((r) => r.role === "final_qa_assistant")).toBe(true);
  });
});
