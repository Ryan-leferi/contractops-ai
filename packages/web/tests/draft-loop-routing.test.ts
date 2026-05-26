/**
 * Pilot P1 — provider routing assertions for the Solo Drafting Loop.
 *
 * `review_synthesizer` is mock-only in P1 even when the lawyer's
 * deployment has `USE_REAL_LLM=true` and providers + role allowlist set
 * for the other roles. The seam is provider-agnostic — a future Google /
 * Gemini provider plugs in via the same `tryReal()` switch without
 * touching aggregate or role code. Documented in ADR-022.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildServerAggregateContext } from "../lib/server-aggregate-context";
import type * as core from "@contractops/core";

const FAKE_OPENAI_KEY = "sk-fake-test-key";
const FAKE_ANTHROPIC_KEY = "sk-ant-fake-test-key";

function makeState(): core.ProjectState {
  return {
    project: {
      id: "proj_p1",
      name: "Test",
      status: "created",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "lawyer_kim",
    },
    source_pack: {
      id: "sp_p1",
      project_id: "proj_p1",
      locked: false,
      locked_at: null,
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
    issue_cards: [],
    agent_runs: [],
    exports: [],
    qa_runs: [],
    decision_history: [],
    draft_iterations: [],
    memberships: [],
  } as unknown as core.ProjectState;
}

const ACTOR = {
  id: "lawyer_kim",
  role: "human_lawyer" as const,
  display_name: "Kim",
};

const ENV_KEYS = [
  "USE_REAL_LLM",
  "LLM_PROVIDER_ALLOWLIST",
  "REAL_LLM_ROLE_ALLOWLIST",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    SAVED_ENV[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

describe("review_synthesizer — P1 mock-only routing", () => {
  it("defaults to mock when nothing is set", () => {
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("review_synthesizer").mode).toBe("mock");
  });

  it("stays mock even when role allowlist names review_synthesizer", () => {
    // P1 intentionally does NOT wire a tryReal branch for review_synthesizer
    // (Gemini is the post-P1 target — see ADR-022). The role allowlist
    // entry is a no-op until the wiring lands.
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai,anthropic";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "review_synthesizer";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("review_synthesizer").mode).toBe("mock");
  });

  it("stays mock when every other role is opted in to real", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai,anthropic";
    process.env.REAL_LLM_ROLE_ALLOWLIST =
      "contract_drafter,revision_agent,counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("review_synthesizer").mode).toBe("mock");
    // Spot-check the others still pass through correctly so this test
    // also catches accidental regressions to the 4A/4B routing.
    expect(ctx.getProvider!("contract_drafter").mode).toBe("real");
    expect(ctx.getProvider!("counterparty_reviewer").provider_id).toBe("anthropic");
  });
});
