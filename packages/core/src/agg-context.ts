import type { Actor } from "@contractops/schemas";
import { DEFAULT_ENV_CONFIG, type EnvConfig } from "./env-config";
import { createCounterIdGenerator, createFixedClock, type Env } from "./env";
import type { LLMProvider } from "./provider";
import { createMockProvider } from "./providers/mock-provider";

/**
 * AggregateContext bundles everything an agent-backed aggregate op needs:
 *
 *   - `provider`     — the LLMProvider to call (mock by default)
 *   - `env_config`   — environment switches (USE_REAL_LLM, allowlist, etc.)
 *   - `env`          — id generator + clock
 *   - `actor`        — who initiated this aggregate call (for audit attribution)
 *
 * Callers that don't use any of these (e.g. createProject) can still construct
 * a context for uniformity, but sync ops accept a plain `Env` and need no ctx.
 */
export interface AggregateContext {
  provider: LLMProvider;
  env_config: EnvConfig;
  env: Env;
  actor: Actor;
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
