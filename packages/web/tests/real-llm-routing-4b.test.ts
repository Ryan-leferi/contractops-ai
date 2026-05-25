/**
 * Milestone 4B — server-side per-role real-LLM routing for review roles.
 *
 *   counterparty_reviewer       → anthropic (carried from 2E, but now
 *                                 gated by REAL_LLM_ROLE_ALLOWLIST)
 *   source_consistency_reviewer → openai (Gemini is post-alpha)
 *   legal_style_reviewer        → openai (same IssueCardListOutput risk
 *                                 profile as the other reviewers)
 *
 * Default remains mock. Missing REAL_LLM_ROLE_ALLOWLIST entry keeps each
 * role on mock even when USE_REAL_LLM=true and the provider is on the
 * provider allowlist.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildServerAggregateContext } from "../lib/server-aggregate-context";
import type * as core from "@contractops/core";

const FAKE_OPENAI_KEY = "sk-fake-test-key";
const FAKE_ANTHROPIC_KEY = "sk-ant-fake-test-key";

function makeState(): core.ProjectState {
  return {
    project: {
      id: "proj_x",
      name: "Test",
      status: "created",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "lawyer_kim",
    },
    source_pack: {
      id: "sp_x",
      project_id: "proj_x",
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

// ─────────────────────────────────────────────────────────────────────
// counterparty_reviewer (4B BREAKING: now requires role allowlist)
// ─────────────────────────────────────────────────────────────────────

describe("counterparty_reviewer — 4B role allowlist required (breaking vs 2E)", () => {
  it("mock when role allowlist omits counterparty_reviewer", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "anthropic";
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("counterparty_reviewer").mode).toBe("mock");
  });

  it("real (anthropic) when both allowlists name it AND API key set", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "anthropic";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "counterparty_reviewer";
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    const p = ctx.getProvider!("counterparty_reviewer");
    expect(p.mode).toBe("real");
    expect(p.provider_id).toBe("anthropic");
  });

  it("mock when ANTHROPIC_API_KEY missing (no silent failure)", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "anthropic";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "counterparty_reviewer";
    // ANTHROPIC_API_KEY intentionally unset
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("counterparty_reviewer").mode).toBe("mock");
  });
});

// ─────────────────────────────────────────────────────────────────────
// source_consistency_reviewer (4B — OpenAI, role allowlist required)
// ─────────────────────────────────────────────────────────────────────

describe("source_consistency_reviewer — 4B routing to openai", () => {
  it("mock when role allowlist omits source_consistency_reviewer", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("source_consistency_reviewer").mode).toBe("mock");
  });

  it("real (openai) when both allowlists name it AND API key set", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "source_consistency_reviewer";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    const p = ctx.getProvider!("source_consistency_reviewer");
    expect(p.mode).toBe("real");
    expect(p.provider_id).toBe("openai");
  });

  it("provider allowlist missing 'openai' keeps source_consistency_reviewer on mock", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "anthropic";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "source_consistency_reviewer";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("source_consistency_reviewer").mode).toBe("mock");
  });
});

// ─────────────────────────────────────────────────────────────────────
// legal_style_reviewer (4B — OpenAI, role allowlist required)
// ─────────────────────────────────────────────────────────────────────

describe("legal_style_reviewer — 4B routing to openai", () => {
  it("mock without role allowlist entry", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("legal_style_reviewer").mode).toBe("mock");
  });

  it("real (openai) when both allowlists name it", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "legal_style_reviewer";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("legal_style_reviewer").mode).toBe("real");
  });
});

// ─────────────────────────────────────────────────────────────────────
// All three review roles enabled simultaneously (mixed providers)
// ─────────────────────────────────────────────────────────────────────

describe("4B — all three review roles enabled together (mixed providers)", () => {
  it("counterparty=anthropic, source_consistency=openai, legal_style=openai", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai,anthropic";
    process.env.REAL_LLM_ROLE_ALLOWLIST =
      "counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("counterparty_reviewer").provider_id).toBe("anthropic");
    expect(ctx.getProvider!("source_consistency_reviewer").provider_id).toBe("openai");
    expect(ctx.getProvider!("legal_style_reviewer").provider_id).toBe("openai");
    // Non-review roles unaffected.
    expect(ctx.getProvider!("contract_drafter").mode).toBe("mock");
    expect(ctx.getProvider!("revision_agent").mode).toBe("mock");
  });
});
