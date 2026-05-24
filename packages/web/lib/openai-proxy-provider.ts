import type { z } from "zod";
import {
  ProviderValidationError,
  type LLMProvider,
  type LLMProviderInput,
  type LLMProviderJsonResult,
  type LLMProviderTextResult,
} from "@contractops/core";

/**
 * Browser-side LLMProvider that POSTs to a server API route. The actual
 * OpenAI SDK call happens server-side; the browser only sees the validated
 * structured output. OPENAI_API_KEY never crosses the wire.
 *
 * In Milestone 2C only the Deal Memo drafter has a server endpoint
 * (/api/agent/deal-memo). Other roles continue to use createMockProvider in
 * the browser.
 */

interface ProxyEndpointResponse {
  value?: unknown;
  raw_text?: string;
  provider_id?: string;
  model_id?: string;
  mode?: "mock" | "real";
  token_usage?: { input_tokens: number; output_tokens: number } | null;
  cost_estimate?: number | null;
  error?: string;
  code?: string;
}

export interface CreateOpenAIProxyProviderOptions {
  endpoint: string;
  /** Build-time hint for the model id; the server is authoritative. */
  model_id_hint?: string;
}

export function createOpenAIProxyProvider(
  options: CreateOpenAIProxyProviderOptions,
): LLMProvider {
  const provider_id = "openai";
  const model_id = options.model_id_hint ?? "remote";

  async function completeText(_input: LLMProviderInput): Promise<LLMProviderTextResult> {
    throw new Error(
      "completeText is not supported via the OpenAI proxy in Milestone 2C. " +
        "Only completeJson is exposed for the Deal Memo drafter.",
    );
  }

  async function completeJson<T>(
    input: LLMProviderInput,
    schema: z.ZodType<T>,
  ): Promise<LLMProviderJsonResult<T>> {
    const res = await fetch(options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        system: input.system,
        prompt_id: input.prompt_id,
        prompt_version: input.prompt_version,
        input_id: input.input_id,
        max_tokens: input.max_tokens,
        temperature: input.temperature,
      }),
    });

    let body: ProxyEndpointResponse;
    try {
      body = (await res.json()) as ProxyEndpointResponse;
    } catch {
      throw new Error(`OpenAI proxy returned non-JSON response (HTTP ${res.status})`);
    }

    if (!res.ok) {
      // 422 with code PROVIDER_OUTPUT_INVALID corresponds to a server-side
      // schema validation failure even after the corrective retry.
      if (res.status === 422 && body.code === "PROVIDER_OUTPUT_INVALID") {
        throw new ProviderValidationError({
          provider_id,
          prompt_id: input.prompt_id,
          raw_text: "(see server logs)",
          zod_message: body.error ?? "PROVIDER_OUTPUT_INVALID",
        });
      }
      throw new Error(
        `OpenAI proxy returned HTTP ${res.status}: ${body.error ?? res.statusText}`,
      );
    }

    // Re-validate client-side too — defense in depth, and gives us a typed T.
    const validated = schema.safeParse(body.value);
    if (!validated.success) {
      throw new ProviderValidationError({
        provider_id,
        prompt_id: input.prompt_id,
        raw_text: body.raw_text ?? "",
        zod_message: validated.error.message,
      });
    }

    return {
      value: validated.data,
      raw_text: body.raw_text ?? "",
      prompt_id: input.prompt_id,
      prompt_version: input.prompt_version,
      input_id: input.input_id ?? null,
      token_usage: body.token_usage ?? null,
      cost_estimate: body.cost_estimate ?? null,
    };
  }

  return { provider_id, model_id, mode: "real", completeText, completeJson };
}
