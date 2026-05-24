/**
 * Server-side proxy for the Deal Memo drafter agent.
 *
 * The browser must NEVER instantiate the OpenAI SDK directly — OPENAI_API_KEY
 * stays in the server environment. The browser's proxy provider POSTs here;
 * we run `selectProvider(envConfig)` server-side, call the real provider, and
 * return the validated structured output.
 *
 * This route is the only place in the web package that exercises the real
 * provider. All other roles in Milestone 2C stay on the browser-side mock.
 */
import { NextResponse } from "next/server";
import {
  readEnvConfig,
  selectProvider,
  ProviderRealModeNotConfiguredError,
  ProviderValidationError,
} from "@contractops/core";
import { dealMemoDraftOutputSchema } from "@contractops/schemas";

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

  // Hard gate: the route only does real-mode work. If server-side env is
  // mock, the client misconfigured itself — return 503 (not 200) so the
  // bug surfaces.
  if (!envConfig.USE_REAL_LLM) {
    return NextResponse.json(
      {
        error:
          "Server is in mock mode (USE_REAL_LLM=false). The Deal Memo drafter " +
          "should use the in-browser mock provider in this configuration.",
      },
      { status: 503 },
    );
  }

  let provider;
  try {
    provider = selectProvider(envConfig);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof ProviderRealModeNotConfiguredError ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  // Defense in depth: refuse to fall through to mock here even if selectProvider
  // somehow returns it.
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
        prompt_id: body.prompt_id ?? "deal_memo_drafter",
        prompt_version: body.prompt_version ?? "v1",
        input_id: body.input_id,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
      },
      dealMemoDraftOutputSchema,
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
