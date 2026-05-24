import type { LLMProvider } from "./provider";
import { ProviderRealModeNotConfiguredError } from "./provider";
import type { EnvConfig } from "./env-config";
import { DEFAULT_ENV_CONFIG } from "./env-config";
import { createMockProvider } from "./providers/mock-provider";
import { createOpenAIProvider } from "./providers/openai-provider";

/**
 * Pick a provider based on env config.
 *
 * - `USE_REAL_LLM=false` (default): always MockProvider, even if an API key
 *   is present. No silent escalation to real mode.
 * - `USE_REAL_LLM=true`:
 *   - `LLM_PROVIDER_ALLOWLIST` must include "openai".
 *   - `OPENAI_API_KEY` must be set.
 *   - All four conditions met → real OpenAI provider.
 *   - Any condition missing → throws `ProviderRealModeNotConfiguredError`
 *     (NO fallback to mock).
 *
 * Node-only. The web does NOT call this in the browser — the browser uses
 * `createMockProvider` directly and routes real-mode calls through the
 * `/api/agent/...` route, which calls `selectProvider` server-side.
 *
 * Callers that need a mock with custom canned responses should call
 * `createMockProvider({ ... })` directly instead.
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
    if (!envConfig.OPENAI_API_KEY) {
      throw new ProviderRealModeNotConfiguredError(
        "USE_REAL_LLM=true and 'openai' on allowlist but OPENAI_API_KEY is not set",
      );
    }
    return createOpenAIProvider({
      api_key: envConfig.OPENAI_API_KEY,
      model_id: envConfig.OPENAI_MODEL ?? undefined,
      log_prompts: envConfig.LLM_LOG_PROMPTS,
    });
  }

  throw new ProviderRealModeNotConfiguredError(
    `USE_REAL_LLM=true but no supported provider on allowlist: [${envConfig.LLM_PROVIDER_ALLOWLIST.join(
      ", ",
    )}]. Supported in Milestone 2C: "openai".`,
  );
}
