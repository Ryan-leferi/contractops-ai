/**
 * Server-side AggregateContext builder (Milestone 3D).
 *
 * The operations API route calls `core.agg*` functions to drive the
 * workflow. Each `agg*` call needs an AggregateContext: provider, env,
 * actor, env_config, and a per-role provider router.
 *
 * The legacy client-side builder in `lib/actions.ts` instantiates HTTP
 * proxy providers because the browser cannot import the OpenAI /
 * Anthropic SDKs directly. Here we ARE the server, so we instantiate the
 * real providers directly via `selectProviderByName` — no extra hop.
 *
 * SERVER ONLY. Any file that imports this transitively pulls in
 * `openai` and `@anthropic-ai/sdk` (via `selectProviderByName`), so it
 * must never be imported from a client component or the SDK isolation
 * test will fail.
 */
import * as core from "@contractops/core";
import type { Actor, AgentRole } from "@contractops/schemas";
import { buildPlaybookCannedResponses } from "./actions";

/** Demo lawyer used for every server-side action that needs an actor. */
const DEMO_LAWYER: Actor = {
  id: "lawyer_demo",
  role: "human_lawyer",
  display_name: "Demo Lawyer",
};

/** Demo user used for source-upload + intake-answer actions. */
const DEMO_USER: Actor = {
  id: "user_demo",
  role: "user",
  display_name: "Demo User",
};

export function getDemoLawyer(): Actor {
  return DEMO_LAWYER;
}

export function getDemoUser(): Actor {
  return DEMO_USER;
}

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
 * Build an AggregateContext for the server. Falls back to the mock
 * provider for any role that is not on the real-mode allowlist.
 *
 * Provider routing rules (mirror the client-side proxy behavior so the
 * same role escalation rules apply whether the call originates in the
 * browser or in an operations API route):
 *
 *   - `deal_memo_drafter` → OpenAI if USE_REAL_LLM + "openai" allowed
 *   - `counterparty_reviewer` → Anthropic if USE_REAL_LLM + "anthropic" allowed
 *   - everything else → MockProvider
 *
 * If real-mode env is misconfigured, we swallow the construction error
 * and quietly fall back to the mock provider — running the workflow
 * must not crash because of an env hiccup. The mock badge in the agent
 * runs panel surfaces the fallback.
 */
export function buildServerAggregateContext(
  state: core.ProjectState,
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
    actor: DEMO_LAWYER,
    getProvider: (role) => tryReal(role) ?? mockProvider,
  };
}
