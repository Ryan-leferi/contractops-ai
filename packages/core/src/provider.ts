import type { z } from "zod";
import type { ProviderMode, TokenUsage } from "@contractops/schemas";

/**
 * Generic LLM provider interface. Every agent role talks to one of these.
 * Mock and real providers implement the same shape so the workflow layer
 * never knows which is which.
 */

export interface LLMProviderInput {
  /** Rendered prompt text sent to the model. */
  prompt: string;
  /** Optional system message. */
  system?: string;
  /** Stable identifier for the prompt template (e.g. "deal_memo_drafter"). */
  prompt_id: string;
  /** Stable version of the template (e.g. "v1", "v2024-01-15"). */
  prompt_version: string;
  /**
   * Stable identifier for the input payload — typically a hash of the input
   * doc set + intake answers + Playbook id. Used for replay/caching.
   */
  input_id?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface LLMProviderTextResult {
  text: string;
  prompt_id: string;
  prompt_version: string;
  input_id: string | null;
  token_usage: TokenUsage | null;
  cost_estimate: number | null;
}

export interface LLMProviderJsonResult<T> {
  value: T;
  raw_text: string;
  prompt_id: string;
  prompt_version: string;
  input_id: string | null;
  token_usage: TokenUsage | null;
  cost_estimate: number | null;
}

export interface LLMProvider {
  readonly provider_id: string;
  readonly model_id: string;
  readonly mode: ProviderMode;
  completeText(input: LLMProviderInput): Promise<LLMProviderTextResult>;
  completeJson<T>(input: LLMProviderInput, schema: z.ZodType<T>): Promise<LLMProviderJsonResult<T>>;
}

export class ProviderValidationError extends Error {
  readonly code = "PROVIDER_OUTPUT_INVALID";
  readonly provider_id: string;
  readonly prompt_id: string;
  readonly raw_text: string;
  readonly zod_message: string;
  constructor(opts: { provider_id: string; prompt_id: string; raw_text: string; zod_message: string }) {
    super(
      `Provider "${opts.provider_id}" returned invalid JSON for prompt "${opts.prompt_id}": ${opts.zod_message}`,
    );
    this.name = "ProviderValidationError";
    this.provider_id = opts.provider_id;
    this.prompt_id = opts.prompt_id;
    this.raw_text = opts.raw_text;
    this.zod_message = opts.zod_message;
  }
}

export class ProviderRealModeNotConfiguredError extends Error {
  readonly code = "PROVIDER_REAL_MODE_NOT_CONFIGURED";
  constructor(reason: string) {
    super(`Real LLM provider mode is not configured: ${reason}`);
    this.name = "ProviderRealModeNotConfiguredError";
  }
}

/**
 * Wrap a JSON completion in a retry loop. Useful when a provider returns
 * malformed JSON occasionally — the wrapper re-calls up to `maxRetries`
 * times before giving up. For mock providers that always return the same
 * thing, retries achieve nothing; they exist to make the real-provider seam
 * clean.
 */
export async function completeJsonWithRetry<T>(
  provider: LLMProvider,
  input: LLMProviderInput,
  schema: z.ZodType<T>,
  options: { maxRetries?: number } = {},
): Promise<LLMProviderJsonResult<T>> {
  const maxRetries = options.maxRetries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await provider.completeJson(input, schema);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`completeJsonWithRetry: failed after ${maxRetries + 1} attempts`);
}
