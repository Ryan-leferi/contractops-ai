/**
 * Server-side proxy for the Counterparty Reviewer agent (Milestone 2E).
 *
 * The Anthropic SDK and ANTHROPIC_API_KEY live ONLY in the server runtime —
 * the browser proxy provider POSTs here, the server uses
 * `selectProviderByName("anthropic", env)` to instantiate Anthropic, calls
 * `completeJson` with the IssueCardListOutput schema, and returns the
 * validated structured output.
 *
 * Counterparty reviewer is the SECOND real-provider seam shipped (after the
 * Deal Memo / OpenAI seam in Milestone 2C). All other agent roles stay on
 * the browser-side mock in Milestone 2E.
 */
import { NextResponse } from "next/server";
import {
  readEnvConfig,
  selectProviderByName,
  ProviderRealModeNotConfiguredError,
  ProviderValidationError,
} from "@contractops/core";
import { issueCardListOutputSchema } from "@contractops/schemas";

export const dynamic = "force-dynamic";

interface ProxyRequestBody {
  prompt: string;
  prompt_id?: string;
  prompt_version?: string;
  input_id?: string;
  system?: string;
  max_tokens?: number;
  temperature?: number;
}

export async function POST(request: Request) {
  let body: ProxyRequestBody;
  try {
    body = (await request.json()) as ProxyRequestBody;
  } catch {
    return NextResponse.json({ error: "request body is not valid JSON" }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const envConfig = readEnvConfig();

  // Server must be in real mode for this route to do its job. If it isn't,
  // the client misconfigured itself — return 503 so the bug surfaces instead
  // of silently falling back.
  if (!envConfig.USE_REAL_LLM) {
    return NextResponse.json(
      {
        error:
          "Server is in mock mode (USE_REAL_LLM=false). The counterparty " +
          "reviewer should use the in-browser mock provider in this configuration.",
      },
      { status: 503 },
    );
  }

  let provider;
  try {
    provider = selectProviderByName("anthropic", envConfig);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof ProviderRealModeNotConfiguredError ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  if (provider.mode !== "real") {
    return NextResponse.json(
      { error: "Provider resolved to mock mode unexpectedly." },
      { status: 500 },
    );
  }

  try {
    const result = await provider.completeJson(
      {
        prompt: body.prompt,
        system: body.system,
        prompt_id: body.prompt_id ?? "counterparty_reviewer",
        prompt_version: body.prompt_version ?? "v1",
        input_id: body.input_id,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
      },
      issueCardListOutputSchema,
    );
    return NextResponse.json({
      value: result.value,
      raw_text: result.raw_text,
      provider_id: provider.provider_id,
      model_id: provider.model_id,
      mode: provider.mode,
      token_usage: result.token_usage,
      cost_estimate: result.cost_estimate,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof ProviderValidationError ? 422 : 500;
    return NextResponse.json(
      {
        error: message,
        code: e instanceof ProviderValidationError ? "PROVIDER_OUTPUT_INVALID" : "PROVIDER_ERROR",
      },
      { status },
    );
  }
}
