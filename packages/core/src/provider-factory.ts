import type { LLMProvider } from "./provider";
import { ProviderRealModeNotConfiguredError } from "./provider";
import type { EnvConfig } from "./env-config";
import { DEFAULT_ENV_CONFIG } from "./env-config";
import { createMockProvider } from "./providers/mock-provider";

/**
 * Pick a provider based on env config.
 *
 * - If `USE_REAL_LLM` is false (the default), always return the mock.
 * - If `USE_REAL_LLM` is true, throw — no real providers are implemented in
 *   Milestone 2A. The throw is the safety net: setting the flag in the wrong
 *   environment fails loud rather than silently falling back to mock.
 *
 * Callers that need a mock with custom canned responses should call
 * `createMockProvider({ ... })` directly instead of going through this factory.
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

  // No real providers are wired up yet. Milestone 2B will add them.
  throw new ProviderRealModeNotConfiguredError(
    `USE_REAL_LLM=true but no real provider implementation is registered. ` +
      `Allowlist requested: [${envConfig.LLM_PROVIDER_ALLOWLIST.join(", ")}]. ` +
      `Real providers will arrive in Milestone 2B.`,
  );
}
