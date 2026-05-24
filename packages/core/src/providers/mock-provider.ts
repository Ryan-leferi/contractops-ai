import type { z } from "zod";
import type {
  LLMProvider,
  LLMProviderInput,
  LLMProviderJsonResult,
  LLMProviderTextResult,
} from "../provider";
import { ProviderValidationError } from "../provider";
import { DEFAULT_MOCK_JSON_RESPONSES } from "./mock-defaults";

export interface MockProviderConfig {
  provider_id?: string;
  model_id?: string;
  /**
   * Per-(prompt_id, input_id) canned text responses. Keys are
   * `${prompt_id}::${input_id ?? ""}`.
   */
  text_responses?: Record<string, string>;
  /** Per-(prompt_id, input_id) canned JSON values (same key format). */
  json_responses?: Record<string, unknown>;
  /**
   * If true, the provider returns malformed JSON for any `completeJson` call
   * that has no per-key responder. Used by tests for the retry path.
   */
  force_invalid_json?: boolean;
  /**
   * Optional override for the default JSON when no responder matches.
   * If unset, falls back to DEFAULT_MOCK_JSON_RESPONSES[prompt_id] or {}.
   */
  default_json?: Record<string, unknown> | ((input: LLMProviderInput) => unknown);
  /** Optional override for default text. */
  default_text?: string | ((input: LLMProviderInput) => string);
}

function responderKey(input: LLMProviderInput): string {
  return `${input.prompt_id}::${input.input_id ?? ""}`;
}

export function createMockProvider(config: MockProviderConfig = {}): LLMProvider {
  const provider_id = config.provider_id ?? "mock";
  const model_id = config.model_id ?? "mock-v1";

  async function completeText(input: LLMProviderInput): Promise<LLMProviderTextResult> {
    const key = responderKey(input);
    const canned = config.text_responses?.[key];
    let text: string;
    if (canned !== undefined) {
      text = canned;
    } else if (typeof config.default_text === "function") {
      text = config.default_text(input);
    } else if (typeof config.default_text === "string") {
      text = config.default_text;
    } else {
      text = `[MOCK text for ${input.prompt_id}]`;
    }
    return {
      text,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      input_id: input.input_id ?? null,
      token_usage: null,
      cost_estimate: null,
    };
  }

  async function completeJson<T>(
    input: LLMProviderInput,
    schema: z.ZodType<T>,
  ): Promise<LLMProviderJsonResult<T>> {
    const key = responderKey(input);
    const canned = config.json_responses?.[key];

    let value: unknown;
    let raw_text: string;

    if (canned !== undefined) {
      value = canned;
      raw_text = JSON.stringify(canned);
    } else if (config.force_invalid_json) {
      raw_text = "this is not valid json {";
      throw new ProviderValidationError({
        provider_id,
        prompt_id: input.prompt_id,
        raw_text,
        zod_message: "raw response was not valid JSON",
      });
    } else if (typeof config.default_json === "function") {
      value = config.default_json(input);
      raw_text = JSON.stringify(value);
    } else if (config.default_json !== undefined) {
      value = config.default_json;
      raw_text = JSON.stringify(value);
    } else {
      value = DEFAULT_MOCK_JSON_RESPONSES[input.prompt_id] ?? {};
      raw_text = JSON.stringify(value);
    }

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ProviderValidationError({
        provider_id,
        prompt_id: input.prompt_id,
        raw_text,
        zod_message: parsed.error.message,
      });
    }

    return {
      value: parsed.data,
      raw_text,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      input_id: input.input_id ?? null,
      token_usage: null,
      cost_estimate: null,
    };
  }

  return {
    provider_id,
    model_id,
    mode: "mock",
    completeText,
    completeJson,
  };
}
