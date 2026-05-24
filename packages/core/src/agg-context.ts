import type { Actor, AgentRole } from "@contractops/schemas";
import { DEFAULT_ENV_CONFIG, type EnvConfig } from "./env-config";
import { createCounterIdGenerator, createFixedClock, type Env } from "./env";
import type { LLMProvider } from "./provider";
import { createMockProvider } from "./providers/mock-provider";

/**
 * AggregateContext bundles everything an agent-backed aggregate op needs:
 *
 *   - `provider`     — default LLMProvider (mock unless explicitly real)
 *   - `getProvider?` — optional per-role override (e.g. route only
 *                      deal_memo_drafter to a real provider in Milestone 2C
 *                      while keeping the other 6 roles on mock)
 *   - `env_config`   — environment switches (USE_REAL_LLM, allowlist, etc.)
 *   - `env`          — id generator + clock
 *   - `actor`        — who initiated this aggregate call (for audit attribution)
 *
 * Aggregate ops resolve their provider via:
 *     ctx.getProvider?.(role) ?? ctx.provider
 *
 * Sync ops (no agent) accept a plain `Env` and need no ctx.
 */
export interface AggregateContext {
  provider: LLMProvider;
  getProvider?: (role: AgentRole) => LLMProvider;
  env_config: EnvConfig;
  env: Env;
  actor: Actor;
}

/** Resolve the provider for a given role with the canonical fallback. */
export function resolveProvider(ctx: AggregateContext, role: AgentRole): LLMProvider {
  return ctx.getProvider?.(role) ?? ctx.provider;
}

/**
 * Build a mock-mode AggregateContext for tests, the CLI harness, and the web's
 * per-call provider construction. Production wiring (when real LLMs land) will
 * route through `selectProvider(env_config)` instead.
 */
export function createMockAggregateContext(opts?: {
  provider?: LLMProvider;
  env?: Env;
  env_config?: EnvConfig;
  actor?: Actor;
}): AggregateContext {
  return {
    provider: opts?.provider ?? createMockProvider(),
    env_config: opts?.env_config ?? DEFAULT_ENV_CONFIG,
    env:
      opts?.env ??
      ({
        newId: createCounterIdGenerator("ctx"),
        now: createFixedClock("2026-06-01T00:00:00.000Z"),
      } as Env),
    actor: opts?.actor ?? {
      id: "system_demo",
      role: "system",
      display_name: "System",
    },
  };
}
