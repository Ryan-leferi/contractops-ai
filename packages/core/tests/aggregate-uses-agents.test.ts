import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  aggCreateRevision,
  aggCreateV0,
  aggDraftDealMemo,
  aggDraftDraftingPlan,
  aggRunMockReviews,
} from "@contractops/core";
import { buildToReadyForReviews } from "./scenarios";
import type { LLMProvider, LLMProviderInput, LLMProviderJsonResult } from "@contractops/core";
import { createMockProvider } from "@contractops/core";

/**
 * Spy provider — wraps an inner LLMProvider and counts each call by prompt_id.
 * Verifies that aggregate ops call the agent layer exactly once per agent.
 */
function spyProvider(inner: LLMProvider): {
  provider: LLMProvider;
  calls: Map<string, number>;
} {
  const calls = new Map<string, number>();
  const bump = (id: string) => calls.set(id, (calls.get(id) ?? 0) + 1);
  const provider: LLMProvider = {
    provider_id: inner.provider_id,
    model_id: inner.model_id,
    mode: inner.mode,
    completeText: async (input: LLMProviderInput) => {
      bump(input.prompt_id);
      return inner.completeText(input);
    },
    completeJson: async <T,>(input: LLMProviderInput, schema: Parameters<typeof inner.completeJson<T>>[1]) => {
      bump(input.prompt_id);
      return inner.completeJson(input, schema) as Promise<LLMProviderJsonResult<T>>;
    },
  };
  return { provider, calls };
}

describe("Aggregate ops call the role-agent layer", () => {
  it("aggDraftDealMemo invokes the deal_memo_drafter prompt exactly once", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    // Reset state: drop agent runs so we can isolate this op.
    const { provider, calls } = spyProvider(createMockProvider());
    const ctx = { ...ready.ctx, provider };
    const freshState = {
      ...ready.s,
      project: { ...ready.s.project, status: "intake_in_progress" as const },
      deal_memo: null,
      drafting_plan: null,
      contract_versions: [],
      agent_runs: [],
    };
    await aggDraftDealMemo(freshState, ctx);
    expect(calls.get("deal_memo_drafter")).toBe(1);
    expect(calls.size).toBe(1);
  });

  it("aggDraftDraftingPlan invokes drafting_plan_drafter exactly once", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { provider, calls } = spyProvider(createMockProvider());
    const ctx = { ...ready.ctx, provider };
    // Roll back to deal_memo_approved
    const freshState = {
      ...ready.s,
      project: { ...ready.s.project, status: "deal_memo_approved" as const },
      drafting_plan: null,
      contract_versions: [],
    };
    await aggDraftDraftingPlan(freshState, ctx);
    expect(calls.get("drafting_plan_drafter")).toBe(1);
    expect(calls.size).toBe(1);
  });

  it("aggCreateV0 invokes contract_drafter exactly once", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { provider, calls } = spyProvider(createMockProvider());
    const ctx = { ...ready.ctx, provider };
    const freshState = {
      ...ready.s,
      project: { ...ready.s.project, status: "drafting_plan_approved" as const },
      contract_versions: [],
    };
    await aggCreateV0(freshState, ctx);
    expect(calls.get("contract_drafter")).toBe(1);
    expect(calls.size).toBe(1);
  });

  it("aggRunMockReviews invokes all 3 reviewer agents exactly once each", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const { provider, calls } = spyProvider(createMockProvider());
    const ctx = { ...ready.ctx, provider };
    await aggRunMockReviews(ready.s, ctx);
    expect(calls.get("counterparty_reviewer")).toBe(1);
    expect(calls.get("source_consistency_reviewer")).toBe(1);
    expect(calls.get("legal_style_reviewer")).toBe(1);
    expect(calls.size).toBe(3);
  });

  it("aggCreateRevision invokes revision_agent exactly once", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    const { provider, calls } = spyProvider(createMockProvider());
    const ctx = { ...ready.ctx, provider };
    await aggCreateRevision(reviewed.state, ctx);
    expect(calls.get("revision_agent")).toBe(1);
    expect(calls.size).toBe(1);
  });
});
