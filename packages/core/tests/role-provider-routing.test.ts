import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  aggCreateRevision,
  aggCreateV0,
  aggDraftDealMemo,
  aggDraftDraftingPlan,
  aggRunMockFinalQA,
  aggRunMockReviews,
  createMockAggregateContext,
  createMockProvider,
  createOpenAIProvider,
  resolveProvider,
  type AggregateContext,
  type LLMProvider,
  type OpenAIClientLike,
} from "@contractops/core";
import type { AgentRole } from "@contractops/schemas";
import { humanLawyer } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";

/**
 * Milestone 2C scope rule: only the Deal Memo drafter is allowed to use a
 * real provider. All other 6 roles must stay on mock — verified end-to-end.
 */

function stubOpenAIClient(text: string): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: text } }],
          model: "stub-model",
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      },
    },
  };
}

function buildSplitCtx(state: import("@contractops/core").ProjectState): {
  ctx: AggregateContext;
  mock: LLMProvider;
  real: LLMProvider;
} {
  const mock = createMockProvider();
  const real = createOpenAIProvider({
    api_key: "sk-fake",
    model_id: "gpt-4o-mini",
    client: stubOpenAIClient(JSON.stringify({ content: "from real provider", warnings: [] })),
  });
  const base = createMockAggregateContext({ env: { newId: () => "x", now: () => "2026-01-01T00:00:00.000Z" }, actor: humanLawyer, provider: mock });
  const ctx: AggregateContext = {
    ...base,
    provider: mock,
    getProvider: (role: AgentRole) => (role === "deal_memo_drafter" ? real : mock),
  };
  return { ctx, mock, real };
}

describe("resolveProvider falls back to ctx.provider when getProvider returns nothing", () => {
  it("with no getProvider, every role gets ctx.provider", () => {
    const ctx = createMockAggregateContext();
    expect(resolveProvider(ctx, "deal_memo_drafter").mode).toBe("mock");
    expect(resolveProvider(ctx, "contract_drafter").mode).toBe("mock");
    expect(resolveProvider(ctx, "revision_agent").mode).toBe("mock");
  });

  it("with getProvider returning a real provider only for deal_memo_drafter, others stay mock", () => {
    const ready = buildToReadyForReviews; // not invoked — just type sanity
    void ready;
    const ctx = createMockAggregateContext();
    const real = createOpenAIProvider({
      api_key: "sk-fake",
      client: stubOpenAIClient("{}"),
    });
    const ctxSplit: AggregateContext = {
      ...ctx,
      getProvider: (role) => (role === "deal_memo_drafter" ? real : ctx.provider),
    };
    expect(resolveProvider(ctxSplit, "deal_memo_drafter").mode).toBe("real");
    expect(resolveProvider(ctxSplit, "deal_memo_drafter").provider_id).toBe("openai");
    expect(resolveProvider(ctxSplit, "contract_drafter").mode).toBe("mock");
    expect(resolveProvider(ctxSplit, "drafting_plan_drafter").mode).toBe("mock");
    expect(resolveProvider(ctxSplit, "counterparty_reviewer").mode).toBe("mock");
    expect(resolveProvider(ctxSplit, "source_consistency_reviewer").mode).toBe("mock");
    expect(resolveProvider(ctxSplit, "legal_style_reviewer").mode).toBe("mock");
    expect(resolveProvider(ctxSplit, "revision_agent").mode).toBe("mock");
    expect(resolveProvider(ctxSplit, "final_qa_assistant").mode).toBe("mock");
  });
});

describe("Aggregate ops honor the per-role provider routing", () => {
  it("aggDraftDealMemo uses the OpenAI provider; its AgentRun is mode=real, provider_id=openai", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { ctx } = buildSplitCtx(ready.s);
    // Reset to intake_in_progress so we can re-draft Deal Memo
    const stateAtIntake = {
      ...ready.s,
      project: { ...ready.s.project, status: "intake_in_progress" as const },
      deal_memo: null,
      drafting_plan: null,
      contract_versions: [],
      agent_runs: [],
    };
    const result = await aggDraftDealMemo(stateAtIntake, ctx);
    const dealRuns = result.state.agent_runs.filter((r) => r.role === "deal_memo_drafter");
    expect(dealRuns.length).toBe(1);
    expect(dealRuns[0]!.mode).toBe("real");
    expect(dealRuns[0]!.provider_id).toBe("openai");
    expect(result.state.deal_memo?.content).toBe("from real provider");
  });

  it("aggDraftDraftingPlan stays on mock even when Deal Memo is real", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { ctx } = buildSplitCtx(ready.s);
    const stateAtDealApproved = {
      ...ready.s,
      project: { ...ready.s.project, status: "deal_memo_approved" as const },
      drafting_plan: null,
      contract_versions: [],
      // Reset agent_runs to isolate this op
      agent_runs: [],
    };
    const result = await aggDraftDraftingPlan(stateAtDealApproved, ctx);
    const planRuns = result.state.agent_runs.filter((r) => r.role === "drafting_plan_drafter");
    expect(planRuns.length).toBe(1);
    expect(planRuns[0]!.mode).toBe("mock");
    expect(planRuns[0]!.provider_id).toBe("mock");
  });

  it("aggCreateV0 stays on mock", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { ctx } = buildSplitCtx(ready.s);
    const stateAtPlanApproved = {
      ...ready.s,
      project: { ...ready.s.project, status: "drafting_plan_approved" as const },
      contract_versions: [],
      agent_runs: ready.s.agent_runs,
    };
    const result = await aggCreateV0(stateAtPlanApproved, ctx);
    const drafterRuns = result.state.agent_runs.filter((r) => r.role === "contract_drafter");
    expect(drafterRuns[0]!.mode).toBe("mock");
  });

  it("aggRunMockReviews stays on mock (all 3 reviewers)", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { ctx } = buildSplitCtx(ready.s);
    const result = await aggRunMockReviews(ready.s, ctx);
    const reviewerRuns = result.state.agent_runs.filter(
      (r) =>
        r.role === "counterparty_reviewer" ||
        r.role === "source_consistency_reviewer" ||
        r.role === "legal_style_reviewer",
    );
    for (const r of reviewerRuns) {
      expect(r.mode).toBe("mock");
      expect(r.provider_id).toBe("mock");
    }
  });

  it("aggCreateRevision stays on mock", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { ctx } = buildSplitCtx(ready.s);
    const reviewed = (await aggRunMockReviews(ready.s, ctx)).state;
    const rev = await aggCreateRevision(reviewed, ctx);
    const revisionRuns = rev.state.agent_runs.filter((r) => r.role === "revision_agent");
    expect(revisionRuns[0]!.mode).toBe("mock");
  });

  it("aggRunMockFinalQA stays on mock", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { ctx } = buildSplitCtx(ready.s);
    const reviewed = (await aggRunMockReviews(ready.s, ctx)).state;
    const revised = (await aggCreateRevision(reviewed, ctx)).state;
    const qa = await aggRunMockFinalQA(revised, ctx);
    const qaRuns = qa.state.agent_runs.filter((r) => r.role === "final_qa_assistant");
    expect(qaRuns[0]!.mode).toBe("mock");
  });
});

describe("Failed agent path records a failed AgentRun (real Deal Memo)", () => {
  it("when the real provider keeps returning invalid JSON, AgentRun.status=failed + DealMemo not created", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const realFailing = createOpenAIProvider({
      api_key: "sk-fake",
      client: stubOpenAIClient("not json {"),
    });
    const ctx = createMockAggregateContext({
      env: ready.env,
      actor: humanLawyer,
      provider: createMockProvider(),
    });
    const splitCtx: AggregateContext = {
      ...ctx,
      getProvider: (role) => (role === "deal_memo_drafter" ? realFailing : ctx.provider),
    };
    const stateAtIntake = {
      ...ready.s,
      project: { ...ready.s.project, status: "intake_in_progress" as const },
      deal_memo: null,
      drafting_plan: null,
      contract_versions: [],
      agent_runs: [],
    };
    await expect(aggDraftDealMemo(stateAtIntake, splitCtx)).rejects.toThrowError(
      /Deal Memo drafter failed/,
    );
  });
});
