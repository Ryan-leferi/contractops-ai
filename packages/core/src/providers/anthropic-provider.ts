/**
 * Anthropic provider. The ONLY file in `packages/core/src/` that is permitted
 * to import the `@anthropic-ai/sdk` package (enforced by
 * `no-sdk-imports.test.ts`).
 *
 * Node-only. The web client never instantiates this — see the HTTP proxy in
 * `packages/web/lib/anthropic-proxy-provider.ts` for the browser seam.
 *
 * Mirrors the OpenAI provider's contract:
 *   - completeText: plain text out.
 *   - completeJson: Zod-validated structured output, with a single corrective
 *     retry on schema/JSON failure. Persistent failure → ProviderValidationError.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type {
  LLMProvider,
  LLMProviderInput,
  LLMProviderJsonResult,
  LLMProviderTextResult,
} from "../provider";
import { ProviderValidationError } from "../provider";

/**
 * Minimal client shape — the real Anthropic instance satisfies this. Tests
 * inject a stub so no SDK or network is required.
 */
/**
 * Loose response-content shape. The real SDK returns a richer ContentBlock
 * union (text | tool_use | …); this interface only requires the fields we
 * actually use, so the real Anthropic client satisfies it structurally and
 * tests can pass a minimal stub.
 */
interface ResponseContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicClientLike {
  messages: {
    create(req: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: { role: "user" | "assistant"; content: string }[];
      temperature?: number;
    }): Promise<{
      content: ResponseContentBlock[];
      model?: string;
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export interface CreateAnthropicProviderInput {
  api_key: string;
  /** Model id (e.g. "claude-3-5-sonnet-20241022"). Defaults to ANTHROPIC_DEFAULT_MODEL. */
  model_id?: string;
  /** Cap on output tokens. Defaults to 4096 (well under Claude's max). */
  max_tokens?: number;
  log_prompts?: boolean;
  /** Test override: skip the real SDK. `api_key` is still required for parity. */
  client?: AnthropicClientLike;
}

export const ANTHROPIC_DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const DEFAULT_MAX_TOKENS = 4096;

export function createAnthropicProvider(input: CreateAnthropicProviderInput): LLMProvider {
  const provider_id = "anthropic";
  const model_id = input.model_id ?? ANTHROPIC_DEFAULT_MODEL;
  const default_max_tokens = input.max_tokens ?? DEFAULT_MAX_TOKENS;
  const log = input.log_prompts ?? false;

  const client: AnthropicClientLike =
    input.client ?? new Anthropic({ apiKey: input.api_key });

  function logPrompt(label: string, payload: unknown): void {
    if (!log) return;
    // eslint-disable-next-line no-console
    console.error(`[anthropic-provider] ${label}`, JSON.stringify(payload).slice(0, 400));
  }

  function buildMessages(input: LLMProviderInput, extra?: { role: "user"; content: string }[]) {
    return [{ role: "user" as const, content: input.prompt }, ...(extra ?? [])];
  }

  function buildUsage(usage?: { input_tokens: number; output_tokens: number }) {
    if (!usage) return null;
    return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
  }

  function extractText(blocks: ResponseContentBlock[]): string {
    return blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text ?? "")
      .join("");
  }

  async function completeText(input: LLMProviderInput): Promise<LLMProviderTextResult> {
    logPrompt(`completeText:${input.prompt_id}`, { prompt: input.prompt });
    const res = await client.messages.create({
      model: model_id,
      max_tokens: input.max_tokens ?? default_max_tokens,
      ...(input.system ? { system: input.system } : {}),
      messages: buildMessages(input),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    });
    return {
      text: extractText(res.content),
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
    // Claude doesn't have an OpenAI-style `response_format: json_object`, so
    // we instruct it via the system message + user prompt. The fake stub in
    // tests doesn't care; the real Claude model honors the instruction.
    const baseSystem =
      input.system ??
      "You produce ONLY a single valid JSON object that matches the requested schema. " +
        "Do not wrap the JSON in code fences. Do not add commentary.";
    const correction = correctionFromPrior
      ? [
          {
            role: "user" as const,
            content:
              `Your previous response failed schema validation: ${correctionFromPrior}\n` +
              `Return ONLY valid JSON matching the requested schema, no code fences.`,
          },
        ]
      : undefined;
    logPrompt(
      `completeJson:${input.prompt_id}${correctionFromPrior ? ":retry" : ""}`,
      { prompt: input.prompt },
    );
    const res = await client.messages.create({
      model: model_id,
      max_tokens: input.max_tokens ?? default_max_tokens,
      system: baseSystem,
      messages: buildMessages(input, correction),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    });
    const raw_text = extractText(res.content).trim();
    // Strip code fences if the model added them despite instructions.
    const cleaned = raw_text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleaned);
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
