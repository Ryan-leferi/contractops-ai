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
 * Anthropic SDK call happens server-side; the browser only sees the validated
 * structured output. ANTHROPIC_API_KEY never crosses the wire.
 *
 * Milestone 2E exposes ONE endpoint (counterparty_reviewer); other roles
 * continue to use the in-browser mock or the OpenAI proxy.
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

export interface CreateAnthropicProxyProviderOptions {
  endpoint: string;
  model_id_hint?: string;
}

export function createAnthropicProxyProvider(
  options: CreateAnthropicProxyProviderOptions,
): LLMProvider {
  const provider_id = "anthropic";
  const model_id = options.model_id_hint ?? "remote";

  async function completeText(_input: LLMProviderInput): Promise<LLMProviderTextResult> {
    throw new Error(
      "completeText is not supported via the Anthropic proxy in Milestone 2E. " +
        "Only completeJson is exposed for the counterparty reviewer.",
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
      throw new Error(`Anthropic proxy returned non-JSON response (HTTP ${res.status})`);
    }

    if (!res.ok) {
      if (res.status === 422 && body.code === "PROVIDER_OUTPUT_INVALID") {
        throw new ProviderValidationError({
          provider_id,
          prompt_id: input.prompt_id,
          raw_text: "(see server logs)",
          zod_message: body.error ?? "PROVIDER_OUTPUT_INVALID",
        });
      }
      throw new Error(
        `Anthropic proxy returned HTTP ${res.status}: ${body.error ?? res.statusText}`,
      );
    }

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
