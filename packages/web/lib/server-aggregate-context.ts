/**
 * Server-side AggregateContext builder (Milestones 3D + 3F).
 *
 * The operations API route calls `core.agg*` functions to drive the
 * workflow. Each `agg*` call needs an AggregateContext: provider, env,
 * actor, env_config, and a per-role provider router. Real LLM providers
 * are instantiated directly here (not via the browser proxy hop) since
 * we ARE on the server.
 *
 * Milestone 3F: the actor is no longer a hardcoded `DEMO_LAWYER`. It is
 * resolved from the demo actor registry based on the client-supplied
 * `actor_id` (or the registry default for callers that don't pass one).
 * Lawyer-only aggregate ops still enforce `actor.role === "human_lawyer"`
 * inside @contractops/core — selecting `business_choi` therefore makes
 * approve_* / decide_issue / classify_and_confirm throw as designed.
 *
 * SERVER ONLY. Importing this file transitively pulls in the OpenAI and
 * Anthropic SDKs via `selectProviderByName`, so it must never be loaded
 * from a client component (enforced by the SDK isolation test).
 */
import * as core from "@contractops/core";
import type { Actor, AgentRole } from "@contractops/schemas";
import { buildPlaybookCannedResponses } from "./actions";
import { DEMO_ACTOR_REGISTRY, DEFAULT_DEMO_ACTOR_ID } from "./demo-actors";

/**
 * Backward-compat aliases used by server-store and the existing
 * fallback callers. Both resolve to the demo registry entries so
 * `actions.ts`'s `DEMO_LAWYER` / `DEMO_USER` constants stay in sync.
 */
export function getDefaultLawyer(): Actor {
  return DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID];
}
export function getDefaultBusinessUser(): Actor {
  return DEMO_ACTOR_REGISTRY.business_choi;
}

// Older name kept so existing internal call-sites compile until the
// 3F refactor finishes propagating. New code should call
// `getDefaultLawyer()` directly.
export const getDemoLawyer = getDefaultLawyer;
export const getDemoUser = getDefaultBusinessUser;

/** Server clock + id factory. */
export function makeServerEnv(): core.Env {
  return {
    newId: () => {
      if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      }
      return Math.random().toString(36).slice(2, 14);
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Build an AggregateContext for the server. The actor must be one of
 * the demo registry entries (the API route validates this before
 * calling us). Falls back to the mock provider for any role that is
 * not on the real-mode allowlist.
 */
export function buildServerAggregateContext(
  state: core.ProjectState,
  actor: Actor,
): core.AggregateContext {
  const mockProvider = core.createMockProvider({
    json_responses: buildPlaybookCannedResponses(state),
  });

  const envConfig = core.readEnvConfig();
  const realEnabled = envConfig.USE_REAL_LLM === true;
  const allowlist = envConfig.LLM_PROVIDER_ALLOWLIST ?? [];

  function tryReal(role: AgentRole): core.LLMProvider | null {
    if (!realEnabled) return null;
    try {
      if (role === "deal_memo_drafter" && allowlist.includes("openai")) {
        return core.selectProviderByName("openai", envConfig);
      }
      if (role === "counterparty_reviewer" && allowlist.includes("anthropic")) {
        return core.selectProviderByName("anthropic", envConfig);
      }
    } catch {
      // Real-mode misconfigured (missing key, etc.) — fall back to mock.
    }
    return null;
  }

  return {
    provider: mockProvider,
    env_config: envConfig,
    env: makeServerEnv(),
    actor,
    getProvider: (role) => tryReal(role) ?? mockProvider,
  };
}
