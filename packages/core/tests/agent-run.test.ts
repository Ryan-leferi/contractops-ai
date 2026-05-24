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

describe("recordMockAgentRun (legacy helper, still available for non-agent provenance)", () => {
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

describe("Agent-backed aggregate ops create AgentRun records (via role agents)", () => {
  it("aggDraftDealMemo / aggDraftDraftingPlan / aggCreateV0 each produce exactly one AgentRun", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dealRun = ready.s.agent_runs.filter((r) => r.role === "deal_memo_drafter");
    const planRun = ready.s.agent_runs.filter((r) => r.role === "drafting_plan_drafter");
    const draftRun = ready.s.agent_runs.filter((r) => r.role === "contract_drafter");
    expect(dealRun.length).toBe(1);
    expect(planRun.length).toBe(1);
    expect(draftRun.length).toBe(1);
    for (const r of [...dealRun, ...planRun, ...draftRun]) {
      expect(r.mode).toBe("mock");
      expect(r.provider_id).toBe("mock");
      expect(r.status).toBe("completed");
    }
  });

  it("aggRunMockReviews creates exactly one AgentRun per reviewer agent (3 total)", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const res = await aggRunMockReviews(ready.s, ready.ctx);
    const newRuns = res.state.agent_runs.filter(
      (r) => !ready.s.agent_runs.some((p) => p.id === r.id),
    );
    const roles = newRuns.map((r) => r.role).sort();
    expect(roles).toEqual(
      ["counterparty_reviewer", "legal_style_reviewer", "source_consistency_reviewer"].sort(),
    );
    for (const r of newRuns) expect(r.mode).toBe("mock");
  });

  it("aggCreateRevision creates exactly one revision_agent AgentRun", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    let s = (await aggRunMockReviews(ready.s, ready.ctx)).state;
    if (s.issue_cards.length > 0) {
      s = aggDecideIssue(
        s,
        {
          issue_id: s.issue_cards[0]!.issue_id,
          decision: "accepted",
          decided_by: humanLawyer,
        },
        ready.env,
      ).state;
    }
    const rev = await aggCreateRevision(s, ready.ctx);
    const revisionRuns = rev.state.agent_runs.filter((r) => r.role === "revision_agent");
    expect(revisionRuns.length).toBe(1);
    expect(revisionRuns[0]!.mode).toBe("mock");
  });

  it("aggRunMockFinalQA creates exactly one final_qa_assistant AgentRun", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    let s = (await aggRunMockReviews(ready.s, ready.ctx)).state;
    if (s.issue_cards.length > 0) {
      s = aggDecideIssue(
        s,
        {
          issue_id: s.issue_cards[0]!.issue_id,
          decision: "accepted",
          decided_by: humanLawyer,
        },
        ready.env,
      ).state;
    }
    s = (await aggCreateRevision(s, ready.ctx)).state;
    const qa = await aggRunMockFinalQA(s, ready.ctx);
    const qaRuns = qa.state.agent_runs.filter((r) => r.role === "final_qa_assistant");
    expect(qaRuns.length).toBe(1);
  });
});
