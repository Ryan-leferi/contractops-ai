import type { LLMProvider } from "./provider";
import { ProviderRealModeNotConfiguredError } from "./provider";
import type { EnvConfig } from "./env-config";
import { DEFAULT_ENV_CONFIG } from "./env-config";
import { createMockProvider } from "./providers/mock-provider";
import { createOpenAIProvider } from "./providers/openai-provider";
import { createAnthropicProvider } from "./providers/anthropic-provider";

/** Provider ids the factory knows how to construct. */
export type RealProviderId = "openai" | "anthropic";

/**
 * Pick a provider based on env config (default selector).
 *
 * - `USE_REAL_LLM=false` (default): always MockProvider, even with API keys.
 * - `USE_REAL_LLM=true`:
 *   - allowlist empty → throws.
 *   - first supported allowlist entry wins ("openai" preferred over
 *     "anthropic" for compatibility with Milestone 2C tests).
 *   - the chosen provider's API key must be present.
 *   - any condition unsatisfied → throws `ProviderRealModeNotConfiguredError`
 *     (NO silent fallback to mock).
 *
 * For per-role provider selection (e.g. counterparty_reviewer → anthropic),
 * use `selectProviderByName` from API routes / server code.
 *
 * Node-only.
 */
export function selectProvider(
  envConfig: EnvConfig = DEFAULT_ENV_CONFIG,
): LLMProvider {
  if (!envConfig.USE_REAL_LLM) {
    return createMockProvider();
  }
  if (envConfig.LLM_PROVIDER_ALLOWLIST.length === 0) {
    throw new ProviderRealModeNotConfiguredError(
      "USE_REAL_LLM=true but LLM_PROVIDER_ALLOWLIST is empty",
    );
  }
  if (envConfig.LLM_PROVIDER_ALLOWLIST.includes("openai")) {
    return selectProviderByName("openai", envConfig);
  }
  if (envConfig.LLM_PROVIDER_ALLOWLIST.includes("anthropic")) {
    return selectProviderByName("anthropic", envConfig);
  }
  throw new ProviderRealModeNotConfiguredError(
    `USE_REAL_LLM=true but no supported provider on allowlist: [${envConfig.LLM_PROVIDER_ALLOWLIST.join(
      ", ",
    )}]. Supported in Milestone 2E: "openai", "anthropic".`,
  );
}

/**
 * Pick a specific provider by name. Server API routes use this to route
 * different agent roles to different providers (e.g. /api/agent/deal-memo
 * → "openai", /api/agent/counterparty-reviewer → "anthropic"), independent
 * of the default-selection order in `selectProvider`.
 *
 * Same gating rules apply: `USE_REAL_LLM` must be true, the name must be on
 * the allowlist, and the corresponding API key must be set. NO silent
 * fallback to mock.
 */
export function selectProviderByName(
  name: RealProviderId,
  envConfig: EnvConfig = DEFAULT_ENV_CONFIG,
): LLMProvider {
  if (!envConfig.USE_REAL_LLM) {
    return createMockProvider();
  }
  if (!envConfig.LLM_PROVIDER_ALLOWLIST.includes(name)) {
    throw new ProviderRealModeNotConfiguredError(
      `Provider "${name}" is not on LLM_PROVIDER_ALLOWLIST (current: [${envConfig.LLM_PROVIDER_ALLOWLIST.join(
        ", ",
      )}])`,
    );
  }
  if (name === "openai") {
    if (!envConfig.OPENAI_API_KEY) {
      throw new ProviderRealModeNotConfiguredError(
        `Provider "openai" is allowlisted but OPENAI_API_KEY is not set`,
      );
    }
    return createOpenAIProvider({
      api_key: envConfig.OPENAI_API_KEY,
      model_id: envConfig.OPENAI_MODEL ?? undefined,
      log_prompts: envConfig.LLM_LOG_PROMPTS,
    });
  }
  if (name === "anthropic") {
    if (!envConfig.ANTHROPIC_API_KEY) {
      throw new ProviderRealModeNotConfiguredError(
        `Provider "anthropic" is allowlisted but ANTHROPIC_API_KEY is not set`,
      );
    }
    return createAnthropicProvider({
      api_key: envConfig.ANTHROPIC_API_KEY,
      model_id: envConfig.ANTHROPIC_MODEL ?? undefined,
      log_prompts: envConfig.LLM_LOG_PROMPTS,
    });
  }
  // Exhaustive — TypeScript should mark `name` as `never` here.
  const exhaustive: never = name;
  throw new Error(`Unsupported provider id: ${String(exhaustive)}`);
}
