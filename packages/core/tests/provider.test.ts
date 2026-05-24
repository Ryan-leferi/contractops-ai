import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ProviderRealModeNotConfiguredError,
  ProviderValidationError,
  completeJsonWithRetry,
  createMockProvider,
  selectProvider,
} from "@contractops/core";
import { dealMemoDraftOutputSchema } from "@contractops/schemas";

describe("selectProvider", () => {
  it("returns a mock provider when USE_REAL_LLM is false (default)", () => {
    const p = selectProvider();
    expect(p.mode).toBe("mock");
    expect(p.provider_id).toBe("mock");
  });

  it("returns a mock provider when USE_REAL_LLM is explicitly false", () => {
    const p = selectProvider({
      USE_REAL_LLM: false,
      OPENAI_API_KEY: "sk-fake",
      ANTHROPIC_API_KEY: null,
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai"],
      OPENAI_MODEL: null,
      LLM_LOG_PROMPTS: false,
    });
    expect(p.mode).toBe("mock");
  });

  it("throws when USE_REAL_LLM=true but no provider on allowlist", () => {
    expect(() =>
      selectProvider({
        USE_REAL_LLM: true,
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: [],
        OPENAI_MODEL: null,
      LLM_LOG_PROMPTS: false,
      }),
    ).toThrowError(ProviderRealModeNotConfiguredError);
  });

  it("throws when USE_REAL_LLM=true + openai on allowlist but OPENAI_API_KEY is missing", () => {
    expect(() =>
      selectProvider({
        USE_REAL_LLM: true,
        OPENAI_API_KEY: null,
        ANTHROPIC_API_KEY: null,
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: ["openai"],
        OPENAI_MODEL: null,
        LLM_LOG_PROMPTS: false,
      }),
    ).toThrowError(/OPENAI_API_KEY is not set/);
  });

  it("throws when USE_REAL_LLM=true with unrecognized provider on allowlist", () => {
    expect(() =>
      selectProvider({
        USE_REAL_LLM: true,
        OPENAI_API_KEY: "sk-fake",
        ANTHROPIC_API_KEY: "sk-fake",
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: ["anthropic"],
        OPENAI_MODEL: null,
        LLM_LOG_PROMPTS: false,
      }),
    ).toThrowError(/no supported provider on allowlist/);
  });

  it("returns an OpenAI provider when USE_REAL_LLM=true + openai allowlisted + key set", () => {
    // This does NOT make a network call — instantiating the SDK is cheap and
    // safe. We never call provider.completeJson here.
    const p = selectProvider({
      USE_REAL_LLM: true,
      OPENAI_API_KEY: "sk-fake-for-test-only",
      ANTHROPIC_API_KEY: null,
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai"],
      OPENAI_MODEL: "gpt-4o-mini",
      LLM_LOG_PROMPTS: false,
    });
    expect(p.provider_id).toBe("openai");
    expect(p.mode).toBe("real");
    expect(p.model_id).toBe("gpt-4o-mini");
  });

  it("mock mode wins even when an API key is present (no silent escalation)", () => {
    const p = selectProvider({
      USE_REAL_LLM: false,
      OPENAI_API_KEY: "sk-fake",
      ANTHROPIC_API_KEY: null,
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai"],
      OPENAI_MODEL: "gpt-4o-mini",
      LLM_LOG_PROMPTS: false,
    });
    expect(p.mode).toBe("mock");
    expect(p.provider_id).toBe("mock");
  });
});

describe("MockProvider", () => {
  it("completeText returns default text when no responder matches", async () => {
    const provider = createMockProvider();
    const result = await provider.completeText({
      prompt: "x",
      prompt_id: "deal_memo_drafter",
      prompt_version: "v1",
    });
    expect(result.text).toContain("MOCK text");
    expect(result.prompt_id).toBe("deal_memo_drafter");
    expect(result.prompt_version).toBe("v1");
    expect(result.token_usage).toBeNull();
  });

  it("completeJson validates against the schema", async () => {
    const provider = createMockProvider();
    const result = await provider.completeJson(
      { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    // DEFAULT_MOCK_JSON_RESPONSES["deal_memo_drafter"] matches the schema.
    expect(result.value.content).toBeTruthy();
    expect(result.prompt_id).toBe("deal_memo_drafter");
  });

  it("rejects invalid JSON shape with ProviderValidationError", async () => {
    const provider = createMockProvider({
      default_json: { content: 42 }, // wrong type
    });
    await expect(
      provider.completeJson(
        { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
        dealMemoDraftOutputSchema,
      ),
    ).rejects.toThrowError(ProviderValidationError);
  });

  it("force_invalid_json triggers ProviderValidationError", async () => {
    const provider = createMockProvider({ force_invalid_json: true });
    await expect(
      provider.completeJson(
        { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
        dealMemoDraftOutputSchema,
      ),
    ).rejects.toThrowError(ProviderValidationError);
  });

  it("per-(prompt_id,input_id) responders override defaults", async () => {
    const provider = createMockProvider({
      json_responses: {
        "deal_memo_drafter::project_42": {
          content: "Custom canned memo",
          warnings: ["just a warning"],
        },
      },
    });
    const result = await provider.completeJson(
      {
        prompt: "x",
        prompt_id: "deal_memo_drafter",
        prompt_version: "v1",
        input_id: "project_42",
      },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("Custom canned memo");
  });
});

describe("completeJsonWithRetry", () => {
  it("returns the value when the first attempt succeeds", async () => {
    const provider = createMockProvider();
    const result = await completeJsonWithRetry(
      provider,
      { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBeTruthy();
  });

  it("re-tries up to maxRetries and throws when all attempts fail", async () => {
    const provider = createMockProvider({ force_invalid_json: true });
    let attempts = 0;
    const wrapped = {
      ...provider,
      completeJson: async <T,>(...args: Parameters<typeof provider.completeJson<T>>) => {
        attempts++;
        return provider.completeJson(...args);
      },
    };
    await expect(
      completeJsonWithRetry(
        wrapped,
        { prompt: "x", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
        dealMemoDraftOutputSchema,
        { maxRetries: 2 },
      ),
    ).rejects.toThrowError(ProviderValidationError);
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe("MockProvider — schema flexibility", () => {
  it("accepts any Zod schema (not only output_schemas)", async () => {
    const customSchema = z.object({ a: z.number(), b: z.string() });
    const provider = createMockProvider({
      default_json: { a: 1, b: "two" },
    });
    const result = await provider.completeJson(
      { prompt: "x", prompt_id: "custom", prompt_version: "v1" },
      customSchema,
    );
    expect(result.value).toEqual({ a: 1, b: "two" });
  });
});
