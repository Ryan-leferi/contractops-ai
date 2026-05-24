import { describe, expect, it } from "vitest";
import {
  createOpenAIProvider,
  ProviderValidationError,
  type OpenAIClientLike,
} from "@contractops/core";
import { dealMemoDraftOutputSchema } from "@contractops/schemas";

/**
 * Unit tests for OpenAIProvider with a stub client — no network, no real
 * OpenAI account required. Tests verify the provider's contract: schema
 * validation, single corrective retry, and ProviderValidationError on
 * persistent failure.
 */

interface StubCall {
  model: string;
  messages: { role: string; content: string }[];
}

function makeStubClient(responses: (string | (() => string))[]): {
  client: OpenAIClientLike;
  calls: StubCall[];
} {
  const calls: StubCall[] = [];
  let i = 0;
  const client: OpenAIClientLike = {
    chat: {
      completions: {
        create: async (req) => {
          calls.push({ model: req.model, messages: req.messages });
          if (i >= responses.length) {
            throw new Error("stub exhausted");
          }
          const r = responses[i]!;
          const text = typeof r === "function" ? r() : r;
          i++;
          return {
            choices: [{ message: { content: text } }],
            model: req.model,
            usage: { prompt_tokens: 123, completion_tokens: 45 },
          };
        },
      },
    },
  };
  return { client, calls };
}

describe("createOpenAIProvider", () => {
  it("provider_id=openai, mode=real, model_id from input", () => {
    const { client } = makeStubClient([]);
    const provider = createOpenAIProvider({
      api_key: "sk-fake",
      model_id: "gpt-4o-mini",
      client,
    });
    expect(provider.provider_id).toBe("openai");
    expect(provider.mode).toBe("real");
    expect(provider.model_id).toBe("gpt-4o-mini");
  });

  it("completeJson parses valid JSON and returns it as `value`", async () => {
    const validBody = { content: "Mock deal memo body", warnings: [] };
    const { client, calls } = makeStubClient([JSON.stringify(validBody)]);
    const provider = createOpenAIProvider({ api_key: "sk-fake", client });

    const result = await provider.completeJson(
      { prompt: "Draft a memo", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("Mock deal memo body");
    expect(result.prompt_id).toBe("deal_memo_drafter");
    expect(result.token_usage).toEqual({ input_tokens: 123, output_tokens: 45 });
    expect(calls.length).toBe(1);
    expect(calls[0]!.model).toBe("gpt-4o-mini");
  });

  it("completeJson retries once with corrective prompt on invalid JSON", async () => {
    const validBody = { content: "Corrected on retry" };
    const { client, calls } = makeStubClient([
      "this is not valid json {",
      JSON.stringify(validBody),
    ]);
    const provider = createOpenAIProvider({ api_key: "sk-fake", client });

    const result = await provider.completeJson(
      { prompt: "Draft a memo", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("Corrected on retry");
    expect(calls.length).toBe(2);
    // Second call should contain a corrective message
    const secondCallMessages = calls[1]!.messages.map((m) => m.content).join("\n");
    expect(secondCallMessages).toContain("Your previous response failed schema validation");
  });

  it("completeJson retries on schema mismatch (valid JSON but wrong shape)", async () => {
    const wrongShape = { not_content: "missing required field" };
    const validBody = { content: "After retry" };
    const { client, calls } = makeStubClient([
      JSON.stringify(wrongShape),
      JSON.stringify(validBody),
    ]);
    const provider = createOpenAIProvider({ api_key: "sk-fake", client });

    const result = await provider.completeJson(
      { prompt: "Draft a memo", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
      dealMemoDraftOutputSchema,
    );
    expect(result.value.content).toBe("After retry");
    expect(calls.length).toBe(2);
  });

  it("completeJson throws ProviderValidationError when both attempts fail", async () => {
    const { client, calls } = makeStubClient([
      "not json",
      "{not valid either",
    ]);
    const provider = createOpenAIProvider({ api_key: "sk-fake", client });

    await expect(
      provider.completeJson(
        { prompt: "Draft", prompt_id: "deal_memo_drafter", prompt_version: "v1" },
        dealMemoDraftOutputSchema,
      ),
    ).rejects.toThrowError(ProviderValidationError);
    expect(calls.length).toBe(2);
  });

  it("completeText returns raw text + token usage", async () => {
    const { client } = makeStubClient(["plain text response"]);
    const provider = createOpenAIProvider({ api_key: "sk-fake", client });
    const result = await provider.completeText({
      prompt: "hello",
      prompt_id: "deal_memo_drafter",
      prompt_version: "v1",
    });
    expect(result.text).toBe("plain text response");
    expect(result.token_usage).toEqual({ input_tokens: 123, output_tokens: 45 });
  });

  it("includes system message when supplied", async () => {
    const validBody = { content: "x" };
    const { client, calls } = makeStubClient([JSON.stringify(validBody)]);
    const provider = createOpenAIProvider({ api_key: "sk-fake", client });
    await provider.completeJson(
      {
        prompt: "user",
        system: "system instructions",
        prompt_id: "deal_memo_drafter",
        prompt_version: "v1",
      },
      dealMemoDraftOutputSchema,
    );
    expect(calls[0]!.messages[0]).toEqual({ role: "system", content: "system instructions" });
  });
});
