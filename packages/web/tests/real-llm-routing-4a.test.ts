/**
 * Milestone 4A — server-side per-role real-LLM routing.
 *
 * Verifies `buildServerAggregateContext().getProvider(role)` returns:
 *   - mock for every role when USE_REAL_LLM=false (the default).
 *   - mock for contract_drafter + revision_agent when
 *     REAL_LLM_ROLE_ALLOWLIST is empty, even with USE_REAL_LLM=true
 *     and LLM_PROVIDER_ALLOWLIST=openai. This is the new 4A gate:
 *     opting a new role into real mode is an explicit ops decision.
 *   - real (openai) for contract_drafter + revision_agent when ALL of
 *     USE_REAL_LLM + LLM_PROVIDER_ALLOWLIST + REAL_LLM_ROLE_ALLOWLIST
 *     name the right combination.
 *   - real (openai) for deal_memo_drafter without
 *     REAL_LLM_ROLE_ALLOWLIST entry (backward compat with 2C). Same
 *     for counterparty_reviewer / anthropic from 2E.
 *
 * The test sets/clears process.env directly. Restores in afterEach so
 * other tests aren't affected.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildServerAggregateContext } from "../lib/server-aggregate-context";
import type * as core from "@contractops/core";

const FAKE_OPENAI_KEY = "sk-fake-test-key";
const FAKE_ANTHROPIC_KEY = "sk-ant-fake-test-key";

// Synthetic minimal ProjectState — the routing decision doesn't look
// inside it, only the env config does.
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
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
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
// Default (mock mode)
// ─────────────────────────────────────────────────────────────────────

describe("buildServerAggregateContext — default mock mode", () => {
  it("every role gets the mock provider when USE_REAL_LLM is unset", () => {
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    for (const role of [
      "contract_drafter",
      "revision_agent",
      "deal_memo_drafter",
      "counterparty_reviewer",
    ] as const) {
      const p = ctx.getProvider!(role);
      expect(p.mode).toBe("mock");
    }
  });

  it("USE_REAL_LLM=true + empty allowlists still routes everything to mock", () => {
    process.env.USE_REAL_LLM = "true";
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("contract_drafter").mode).toBe("mock");
    expect(ctx.getProvider!("revision_agent").mode).toBe("mock");
    expect(ctx.getProvider!("deal_memo_drafter").mode).toBe("mock");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4A role allowlist gate for contract_drafter + revision_agent
// ─────────────────────────────────────────────────────────────────────

describe("4A — REAL_LLM_ROLE_ALLOWLIST gates contract_drafter + revision_agent", () => {
  it("contract_drafter stays MOCK when role allowlist omits it (provider allowlist alone is not enough)", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    // REAL_LLM_ROLE_ALLOWLIST is intentionally unset.
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("contract_drafter").mode).toBe("mock");
    expect(ctx.getProvider!("revision_agent").mode).toBe("mock");
  });

  it("contract_drafter goes REAL when role allowlist names it AND openai is configured", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "contract_drafter";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    const p = ctx.getProvider!("contract_drafter");
    expect(p.mode).toBe("real");
    expect(p.provider_id).toBe("openai");
    // revision_agent is NOT on the role allowlist → still mock.
    expect(ctx.getProvider!("revision_agent").mode).toBe("mock");
  });

  it("revision_agent goes REAL only when on the role allowlist (independent of contract_drafter)", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "revision_agent";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("contract_drafter").mode).toBe("mock");
    expect(ctx.getProvider!("revision_agent").mode).toBe("real");
    expect(ctx.getProvider!("revision_agent").provider_id).toBe("openai");
  });

  it("both roles can be enabled simultaneously", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "contract_drafter,revision_agent";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("contract_drafter").mode).toBe("real");
    expect(ctx.getProvider!("revision_agent").mode).toBe("real");
  });

  it("missing OPENAI_API_KEY falls back to mock (no silent real-mode failure)", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.REAL_LLM_ROLE_ALLOWLIST = "contract_drafter";
    // OPENAI_API_KEY intentionally unset
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("contract_drafter").mode).toBe("mock");
  });

  it("provider allowlist missing 'openai' → contract_drafter still mock even with role allowlisted", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "anthropic"; // wrong provider for drafter
    process.env.REAL_LLM_ROLE_ALLOWLIST = "contract_drafter";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("contract_drafter").mode).toBe("mock");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Backward compat — 2C deal_memo_drafter + 2E counterparty_reviewer
// ─────────────────────────────────────────────────────────────────────

describe("Backward compat — deal_memo_drafter (2C) does NOT require REAL_LLM_ROLE_ALLOWLIST", () => {
  it("deal_memo_drafter goes real with just openai on provider allowlist (no role allowlist needed)", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "openai";
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    // REAL_LLM_ROLE_ALLOWLIST intentionally unset
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    const p = ctx.getProvider!("deal_memo_drafter");
    expect(p.mode).toBe("real");
    expect(p.provider_id).toBe("openai");
  });

  // Milestone 4B BREAKING change vs 2E: counterparty_reviewer now requires
  // a REAL_LLM_ROLE_ALLOWLIST entry (see ADR-021). Existing 2E deployments
  // that flipped USE_REAL_LLM=true for the counterparty reviewer must add
  // `counterparty_reviewer` to the role allowlist to keep real mode.
  it("counterparty_reviewer is MOCK without REAL_LLM_ROLE_ALLOWLIST (4B change)", () => {
    process.env.USE_REAL_LLM = "true";
    process.env.LLM_PROVIDER_ALLOWLIST = "anthropic";
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;
    const ctx = buildServerAggregateContext(makeState(), ACTOR);
    expect(ctx.getProvider!("counterparty_reviewer").mode).toBe("mock");
  });
});
