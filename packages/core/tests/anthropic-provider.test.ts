import { describe, expect, it } from "vitest";
import {
  createAnthropicProvider,
  ProviderRealModeNotConfiguredError,
  ProviderValidationError,
  selectProvider,
  selectProviderByName,
  type AnthropicClientLike,
} from "@contractops/core";
import { dealMemoDraftOutputSchema } from "@contractops/schemas";

/**
 * Anthropic provider + provider-factory tests.
 *
 * Stub client throughout — no network. The real Anthropic SDK is imported
 * only inside packages/core/src/providers/anthropic-provider.ts (enforced
 * by no-sdk-imports.test.ts) and never reached during tests.
 */

interface StubCall {
  model: string;
  messages: { role: string; content: string }[];
  system?: string;
}

function makeStub(responses: (string | (() => string))[]): {
  client: AnthropicClientLike;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  let i = 0;
  const client: AnthropicClientLike = {
    messages: {
      create: async (req) => {
        calls.push({ model: req.model, messages: req.messages, system: req.system });
        if (i >= responses.length) throw new Error("stub exhausted");
        const r = responses[i]!;
        const text = typeof r === "function" ? r() : r;
        i++;
        return {
          content: [{ type: "text", text }],
          model: req.model,
          usage: { input_tokens: 200, output_tokens: 75 },
        };
      },
    },
  };
  return { client, calls };
}

describe("createAnthropicProvider", () => {
  it("provider_id=anthropic, mode=real, model_id from input", () => {
    const { client } = makeStub([]);
    const provider = createAnthropicProvider({
      api_key: "sk-ant-fake",
      model_id: "claude-3-5-sonnet-20241022",
      client,
    });
    expect(provider.provider_id).toBe("anthropic");
    expect(provider.mode).toBe("real");
    expect(provider.model_id).toBe("claude-3-5-sonnet-20241022");
  });

  it("completeJson parses valid JSON and returns it as value", async () => {
    const validBody = { content: "Mock deal memo body", warnings: [] };
    const { client, calls } = makeStub([JSON.stringify(validBody)]);
    const provider = createAnthropicProvider({ api_key: "sk-ant-fake", client });
    const result = await provider.completeJson(
      { prompt: "Draft a memo", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("Mock deal memo body");
    expect(result.token_usage).toEqual({ input_tokens: 200, output_tokens: 75 });
    expect(calls.length).toBe(1);
    // Anthropic supplies a JSON-instruction system prompt when caller omits one
    expect(calls[0]!.system).toContain("ONLY a single valid JSON object");
  });

  it("strips code fences from the response", async () => {
    const wrappedJson = "```json\n" + JSON.stringify({ content: "fenced" }) + "\n```";
    const { client } = makeStub([wrappedJson]);
    const provider = createAnthropicProvider({ api_key: "sk-ant-fake", client });
    const result = await provider.completeJson(
      { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("fenced");
  });

  it("retries once with corrective prompt on schema mismatch", async () => {
    const wrong = { not_content: "missing field" };
    const right = { content: "After retry" };
    const { client, calls } = makeStub([
      JSON.stringify(wrong),
      JSON.stringify(right),
    ]);
    const provider = createAnthropicProvider({ api_key: "sk-ant-fake", client });
    const result = await provider.completeJson(
      { prompt: "Draft", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("After retry");
    expect(calls.length).toBe(2);
    const retryMsg = calls[1]!.messages.map((m) => m.content).join("\n");
    expect(retryMsg).toContain("Your previous response failed schema validation");
  });

  it("throws ProviderValidationError when both attempts fail", async () => {
    const { client, calls } = makeStub(["not json", "still not"]);
    const provider = createAnthropicProvider({ api_key: "sk-ant-fake", client });
    await expect(
      provider.completeJson(
        { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
        dealMemoDraftOutputSchema,
      ),
    ).rejects.toThrowError(ProviderValidationError);
    expect(calls.length).toBe(2);
  });

  it("completeText returns aggregated text + usage", async () => {
    const { client } = makeStub(["plain text body"]);
    const provider = createAnthropicProvider({ api_key: "sk-ant-fake", client });
    const result = await provider.completeText({
      prompt: "hello",
      prompt_id: "deal_memo_drafter",
      prompt_version: "v1",
    });
    expect(result.text).toBe("plain text body");
    expect(result.token_usage).toEqual({ input_tokens: 200, output_tokens: 75 });
  });
});

describe("selectProvider — anthropic branch", () => {
  it("returns Anthropic when USE_REAL_LLM=true + allowlist=[anthropic] + key set", () => {
    const p = selectProvider({
      USE_REAL_LLM: true,
      OPENAI_API_KEY: null,
      ANTHROPIC_API_KEY: "sk-ant-fake",
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["anthropic"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: "claude-3-5-sonnet-20241022",
      REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
    });
    expect(p.provider_id).toBe("anthropic");
    expect(p.mode).toBe("real");
    expect(p.model_id).toBe("claude-3-5-sonnet-20241022");
  });

  it("prefers openai when both are allowlisted", () => {
    const p = selectProvider({
      USE_REAL_LLM: true,
      OPENAI_API_KEY: "sk-fake",
      ANTHROPIC_API_KEY: "sk-ant-fake",
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai", "anthropic"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: null,
      REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
    });
    expect(p.provider_id).toBe("openai");
  });

  it("throws when anthropic is allowlisted but ANTHROPIC_API_KEY is missing", () => {
    expect(() =>
      selectProvider({
        USE_REAL_LLM: true,
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: ["anthropic"],
        OPENAI_MODEL: null,
        ANTHROPIC_MODEL: null,
        REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
      }),
    ).toThrowError(/ANTHROPIC_API_KEY is not set/);
  });

  it("mock mode wins even when an Anthropic key is present", () => {
    const p = selectProvider({
      USE_REAL_LLM: false,
      OPENAI_API_KEY: null,
      ANTHROPIC_API_KEY: "sk-ant-fake",
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["anthropic"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: null,
      REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
    });
    expect(p.mode).toBe("mock");
  });
});

describe("selectProviderByName", () => {
  it("explicitly picks anthropic regardless of allowlist order", () => {
    const p = selectProviderByName("anthropic", {
      USE_REAL_LLM: true,
      OPENAI_API_KEY: "sk-fake",
      ANTHROPIC_API_KEY: "sk-ant-fake",
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai", "anthropic"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: null,
      REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
    });
    expect(p.provider_id).toBe("anthropic");
  });

  it("explicitly picks openai", () => {
    const p = selectProviderByName("openai", {
      USE_REAL_LLM: true,
      OPENAI_API_KEY: "sk-fake",
      ANTHROPIC_API_KEY: "sk-ant-fake",
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai", "anthropic"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: null,
      REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
    });
    expect(p.provider_id).toBe("openai");
  });

  it("throws if the requested name is not on the allowlist", () => {
    expect(() =>
      selectProviderByName("anthropic", {
        USE_REAL_LLM: true,
        OPENAI_API_KEY: "sk-fake",
        ANTHROPIC_API_KEY: "sk-ant-fake",
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: ["openai"], // anthropic NOT allowlisted
        OPENAI_MODEL: null,
        ANTHROPIC_MODEL: null,
        REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
      }),
    ).toThrowError(ProviderRealModeNotConfiguredError);
  });

  it("returns mock when USE_REAL_LLM=false (no silent escalation by name either)", () => {
    const p = selectProviderByName("anthropic", {
      USE_REAL_LLM: false,
      OPENAI_API_KEY: null,
      ANTHROPIC_API_KEY: "sk-ant-fake",
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["anthropic"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: null,
      REAL_LLM_ROLE_ALLOWLIST: [],
      LLM_LOG_PROMPTS: false,
    });
    expect(p.mode).toBe("mock");
  });
});
