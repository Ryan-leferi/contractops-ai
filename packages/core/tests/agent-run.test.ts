import { describe, expect, it } from "vitest";
import {
  aggCreateRevision,
  aggCreateV0,
  aggDecideIssue,
  aggDraftDealMemo,
  aggDraftDraftingPlan,
  aggRunMockFinalQA,
  aggRunMockReviews,
  recordMockAgentRun,
} from "@contractops/core";
import { humanLawyer, testEnv, user } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";

describe("recordMockAgentRun", () => {
  it("populates all required fields and marks mock=true", () => {
    const env = testEnv();
    const run = recordMockAgentRun({
      project_id: "p1",
      source_agent: "mock_claude",
      agent_role: "counterparty_reviewer",
      output: { findings: 3 },
      mock_prompt_id: "claude_v1",
      mock_input_id: "v0_hash",
      env,
    });
    expect(run.mock).toBe(true);
    expect(run.source_agent).toBe("mock_claude");
    expect(run.agent_role).toBe("counterparty_reviewer");
    expect(run.mock_prompt_id).toBe("claude_v1");
    expect(run.mock_input_id).toBe("v0_hash");
    expect(run.output_json).toEqual({ findings: 3 });
    expect(run.status).toBe("completed");
    expect(run.created_at).toBeTruthy();
    expect(run.finished_at).toBeTruthy();
  });
});

describe("Aggregate ops create AgentRun records", () => {
  it("aggDraftDealMemo creates a deal_memo_drafter AgentRun", () => {
    // Use a fresh-built scenario for this assertion
    // Build only as far as intake_in_progress; then verify draftDealMemo creates a run.
    const env = testEnv();
    // Manually build to intake_in_progress via aggregate ops
    // (Re-use buildToReadyForReviews and inspect runs)
    const ready = buildToReadyForReviews("nda.json");
    expect(ready.s.agent_runs.some((r) => r.agent_role === "deal_memo_drafter")).toBe(true);
    expect(ready.s.agent_runs.some((r) => r.agent_role === "drafting_plan_drafter")).toBe(true);
    expect(ready.s.agent_runs.some((r) => r.agent_role === "drafter")).toBe(true);
  });

  it("aggRunMockReviews creates one AgentRun per provider plus IssueCards", () => {
    const ready = buildToReadyForReviews("nda.json");
    let s = ready.s;
    const env = ready.env;

    const res = aggRunMockReviews(
      s,
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
      env,
    );
    s = res.state;
    // 4 default providers
    const newRunsFromReviews = s.agent_runs.filter(
      (r) =>
        r.agent_role === "counterparty_reviewer" ||
        r.agent_role === "source_consistency_reviewer" ||
        r.agent_role === "korean_style_reviewer" ||
        r.agent_role === "deterministic_qa",
    );
    expect(newRunsFromReviews.length).toBeGreaterThanOrEqual(4);
    expect(s.issue_cards.length).toBe(2);
  });

  it("aggCreateRevision creates a reviser AgentRun", () => {
    const ready = buildToReadyForReviews("nda.json");
    let s = aggRunMockReviews(ready.s, {
      seeds: [{
        source_agent: "mock_claude",
        severity: "low",
        location: {},
        issue_type: "x",
        problem: "x",
        why_it_matters: "x",
        recommended_revision: "x",
        business_impact: "x",
        recommended_action: "accept",
      }],
    }, ready.env).state;

    s = aggDecideIssue(s, {
      issue_id: s.issue_cards[0]!.issue_id,
      decision: "accepted",
      decided_by: humanLawyer,
    }, ready.env).state;

    const rev = aggCreateRevision(s, {}, ready.env);
    expect(rev.state.agent_runs.some((r) => r.agent_role === "reviser")).toBe(true);
  });

  it("aggRunMockFinalQA creates a final_qa AgentRun", () => {
    const ready = buildToReadyForReviews("nda.json");
    let s = aggRunMockReviews(ready.s, {
      seeds: [{
        source_agent: "mock_claude",
        severity: "low",
        location: {},
        issue_type: "x",
        problem: "x",
        why_it_matters: "x",
        recommended_revision: "x",
        business_impact: "x",
        recommended_action: "accept",
      }],
    }, ready.env).state;
    s = aggDecideIssue(s, {
      issue_id: s.issue_cards[0]!.issue_id,
      decision: "accepted",
      decided_by: humanLawyer,
    }, ready.env).state;
    s = aggCreateRevision(s, {}, ready.env).state;

    const qa = aggRunMockFinalQA(s, ready.env);
    expect(qa.state.agent_runs.some((r) => r.agent_role === "final_qa")).toBe(true);
  });
});
