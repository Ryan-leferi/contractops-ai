/**
 * OpenAI provider. The ONLY file in `packages/core/src/` that is permitted to
 * import the `openai` SDK (enforced by `no-sdk-imports.test.ts`).
 *
 * Node-only. The web client must never instantiate this — see the HTTP proxy
 * provider in `packages/web/lib/openai-proxy-provider.ts` for the browser
 * seam. Real API calls happen exclusively in Node (CLI, vitest, Next API
 * route).
 */
import OpenAI from "openai";
import type { z } from "zod";
import type {
  LLMProvider,
  LLMProviderInput,
  LLMProviderJsonResult,
  LLMProviderTextResult,
} from "../provider";
import { ProviderValidationError } from "../provider";

/**
 * Minimal client shape — the real `OpenAI` instance satisfies this. Tests
 * inject a stub that conforms without going through the SDK or the network.
 */
export interface OpenAIClientLike {
  chat: {
    completions: {
      create(req: {
        model: string;
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        response_format?: { type: "json_object" } | { type: "text" };
        temperature?: number;
        max_tokens?: number;
      }): Promise<{
        choices: { message: { content: string | null } }[];
        model?: string;
        usage?: { prompt_tokens: number; completion_tokens: number };
      }>;
    };
  };
}

export interface CreateOpenAIProviderInput {
  /** API key — never logged. Read from env by selectProvider. */
  api_key: string;
  /** Model identifier (e.g. "gpt-4o-mini"). Defaults to OPENAI_DEFAULT_MODEL. */
  model_id?: string;
  /** When true, completion prompts are echoed to stderr for debugging. */
  log_prompts?: boolean;
  /**
   * Test override: replace the real SDK client. When passed, `api_key` is
   * still required (we don't actually use it) so tests can confirm the field
   * is plumbed through without any real network call.
   */
  client?: OpenAIClientLike;
}

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export function createOpenAIProvider(input: CreateOpenAIProviderInput): LLMProvider {
  const provider_id = "openai";
  const model_id = input.model_id ?? OPENAI_DEFAULT_MODEL;
  const log = input.log_prompts ?? false;

  // Only instantiate the real SDK when no test stub was provided.
  const client: OpenAIClientLike = input.client ?? new OpenAI({ apiKey: input.api_key });

  function logPrompt(label: string, payload: unknown): void {
    if (!log) return;
    // eslint-disable-next-line no-console
    console.error(`[openai-provider] ${label}`, JSON.stringify(payload).slice(0, 400));
  }

  function buildMessages(input: LLMProviderInput, extra?: { role: "user"; content: string }[]) {
    const messages = [
      ...(input.system ? [{ role: "system" as const, content: input.system }] : []),
      { role: "user" as const, content: input.prompt },
      ...(extra ?? []),
    ];
    return messages;
  }

  function buildUsage(usage?: { prompt_tokens: number; completion_tokens: number }) {
    if (!usage) return null;
    return { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens };
  }

  async function completeText(input: LLMProviderInput): Promise<LLMProviderTextResult> {
    logPrompt(`completeText:${input.prompt_id}`, { prompt: input.prompt });
    const res = await client.chat.completions.create({
      model: model_id,
      messages: buildMessages(input),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
    });
    const text = res.choices[0]?.message?.content ?? "";
    return {
      text,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      input_id: input.input_id ?? null,
      token_usage: buildUsage(res.usage),
      cost_estimate: null,
    };
  }

  async function callJsonOnce<T>(
    input: LLMProviderInput,
    schema: z.ZodType<T>,
    correctionFromPrior?: string,
  ): Promise<LLMProviderJsonResult<T>> {
    const correction = correctionFromPrior
      ? [
          {
            role: "user" as const,
            content:
              `Your previous response failed schema validation: ${correctionFromPrior}\n` +
              `Return ONLY valid JSON matching the requested schema.`,
          },
        ]
      : undefined;
    logPrompt(`completeJson:${input.prompt_id}${correctionFromPrior ? ":retry" : ""}`, {
      prompt: input.prompt,
    });
    const res = await client.chat.completions.create({
      model: model_id,
      messages: buildMessages(input, correction),
      response_format: { type: "json_object" },
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
    });
    const raw_text = res.choices[0]?.message?.content ?? "";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw_text);
    } catch {
      throw new ProviderValidationError({
        provider_id,
        prompt_id: input.prompt_id,
        raw_text,
        zod_message: "response was not valid JSON",
      });
    }
    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new ProviderValidationError({
        provider_id,
        prompt_id: input.prompt_id,
        raw_text,
        zod_message: validated.error.message,
      });
    }
    return {
      value: validated.data,
      raw_text,
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      input_id: input.input_id ?? null,
      token_usage: buildUsage(res.usage),
      cost_estimate: null,
    };
  }

  async function completeJson<T>(
    input: LLMProviderInput,
    schema: z.ZodType<T>,
  ): Promise<LLMProviderJsonResult<T>> {
    try {
      return await callJsonOnce(input, schema);
    } catch (e) {
      // Single corrective retry — only on schema/JSON validation failures.
      if (e instanceof ProviderValidationError) {
        return await callJsonOnce(input, schema, e.zod_message);
      }
      throw e;
    }
  }

  return {
    provider_id,
    model_id,
    mode: "real",
    completeText,
    completeJson,
  };
}
