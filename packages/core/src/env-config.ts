/**
 * Environment configuration for LLM provider selection. Read once at process
 * start; never re-evaluated. Mock is the default; real mode requires an
 * explicit USE_REAL_LLM=true plus a provider on the allowlist.
 *
 * No real provider may be selected in tests. Tests should always pass an
 * explicit mock provider rather than rely on env vars.
 */

export interface EnvConfig {
  /** Master switch. Default: false. Real providers are unreachable without it. */
  USE_REAL_LLM: boolean;
  /** Provider API keys — never logged, never hardcoded. */
  OPENAI_API_KEY: string | null;
  ANTHROPIC_API_KEY: string | null;
  GOOGLE_API_KEY: string | null;
  /** Default OpenAI model id used by createOpenAIProvider. Null → provider default. */
  OPENAI_MODEL: string | null;
  /** Default Anthropic model id used by createAnthropicProvider. Null → provider default. */
  ANTHROPIC_MODEL: string | null;
  /**
   * Comma-separated provider ids that are permitted in real mode (e.g. "openai,anthropic").
   * If empty, no real provider is allowed even with USE_REAL_LLM=true.
   */
  LLM_PROVIDER_ALLOWLIST: string[];
  /** If true, prompts are written to console/log for debugging. Default: false. */
  LLM_LOG_PROMPTS: boolean;
}

type EnvSource = Record<string, string | undefined>;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const lower = raw.toLowerCase();
  if (lower === "1" || lower === "true" || lower === "yes" || lower === "on") return true;
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return fallback;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function readEnvConfig(env: EnvSource = (typeof process !== "undefined" ? process.env : {})): EnvConfig {
  return {
    USE_REAL_LLM: parseBool(env.USE_REAL_LLM, false),
    OPENAI_API_KEY: env.OPENAI_API_KEY?.trim() || null,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY?.trim() || null,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY?.trim() || null,
    OPENAI_MODEL: env.OPENAI_MODEL?.trim() || null,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL?.trim() || null,
    LLM_PROVIDER_ALLOWLIST: parseList(env.LLM_PROVIDER_ALLOWLIST),
    LLM_LOG_PROMPTS: parseBool(env.LLM_LOG_PROMPTS, false),
  };
}

export const DEFAULT_ENV_CONFIG: EnvConfig = {
  USE_REAL_LLM: false,
  OPENAI_API_KEY: null,
  ANTHROPIC_API_KEY: null,
  GOOGLE_API_KEY: null,
  OPENAI_MODEL: null,
  ANTHROPIC_MODEL: null,
  LLM_PROVIDER_ALLOWLIST: [],
  LLM_LOG_PROMPTS: false,
};
