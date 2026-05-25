/**
 * Milestone 4B — real-LLM routing for review roles
 * (counterparty_reviewer, source_consistency_reviewer, legal_style_reviewer).
 *
 * Mirrors `real-llm-4a-routing.test.ts` but for `aggRunMockReviews`. The
 * three reviewer roles all produce the same `IssueCardListOutput` shape,
 * so we can use a single canned JSON response and stub both OpenAI +
 * Anthropic clients.
 *
 * Verifies:
 *   1. counterparty_reviewer → real Anthropic provider; AgentRun has
 *      mode=real + provider_id=anthropic.
 *   2. source_consistency_reviewer → real OpenAI provider; AgentRun has
 *      mode=real + provider_id=openai.
 *   3. legal_style_reviewer → real OpenAI provider; same provenance.
 *   4. All three real simultaneously — each review's AgentRun lands on
 *      the correct provider (mixed routing).
 *   5. Default `createMockAggregateContext()` keeps every review role on
 *      mock (defense-in-depth, parallels the 4A test).
 *
 * Real-provider plumbing is stubbed — no network. The fake clients
 * record every call so we can assert the per-role provider routing
 * actually reached the right backend.
 */
import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  aggRunMockReviews,
  createAnthropicProvider,
  createMockAggregateContext,
  createMockProvider,
  createOpenAIProvider,
  resolveProvider,
  type AggregateContext,
  type AnthropicClientLike,
  type LLMProvider,
  type OpenAIClientLike,
} from "@contractops/core";
import type { AgentRole } from "@contractops/schemas";
import { buildToReadyForReviews } from "./scenarios";

/** Minimal IssueCardListOutput payload (zero findings is valid). */
const EMPTY_REVIEW_OUTPUT = JSON.stringify({ findings: [] });

interface CapturedCall {
  prompt: string;
  provider: "openai" | "anthropic";
}

function stubOpenAIClient(
  text: string,
  captured: CapturedCall[],
): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: async (params: {
          model: string;
          messages: { role: string; content: string }[];
        }) => {
          const userMsg =
            params.messages.find((m) => m.role === "user")?.content ?? "";
          captured.push({ prompt: userMsg, provider: "openai" });
          return {
            choices: [{ message: { content: text } }],
            model: params.model,
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    },
  };
}

function stubAnthropicClient(
  text: string,
  captured: CapturedCall[],
): AnthropicClientLike {
  return {
    messages: {
      create: async (req: {
        model: string;
        messages: { role: string; content: string }[];
      }) => {
        const userMsg =
          req.messages.find((m) => m.role === "user")?.content ?? "";
        captured.push({ prompt: userMsg, provider: "anthropic" });
        return {
          content: [{ type: "text" as const, text }],
          model: req.model,
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    },
  };
}

/**
 * Build a ctx where the named review role gets its real provider and
 * everything else stays on mock.
 */
function buildCtxWithRealForReviewRole(
  base: AggregateContext,
  realRole: AgentRole,
  providerName: "openai" | "anthropic",
  captured: CapturedCall[],
): AggregateContext {
  const mock = createMockProvider();
  const real: LLMProvider =
    providerName === "openai"
      ? createOpenAIProvider({
          api_key: "sk-fake",
          model_id: "gpt-4o-mini",
          client: stubOpenAIClient(EMPTY_REVIEW_OUTPUT, captured),
        })
      : createAnthropicProvider({
          api_key: "sk-ant-fake",
          model_id: "claude-3-5-sonnet-20241022",
          client: stubAnthropicClient(EMPTY_REVIEW_OUTPUT, captured),
        });
  return {
    ...base,
    provider: mock,
    getProvider: (role: AgentRole) => (role === realRole ? real : mock),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Single-role real routing — one reviewer real, two mock
// ─────────────────────────────────────────────────────────────────────

describe("aggRunMockReviews honors counterparty_reviewer real (anthropic) routing", () => {
  it("counterparty_reviewer AgentRun records mode=real + provider_id=anthropic", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const captured: CapturedCall[] = [];
    const ctx = buildCtxWithRealForReviewRole(
      ready.ctx,
      "counterparty_reviewer",
      "anthropic",
      captured,
    );

    expect(resolveProvider(ctx, "counterparty_reviewer").mode).toBe("real");
    expect(resolveProvider(ctx, "counterparty_reviewer").provider_id).toBe("anthropic");
    expect(resolveProvider(ctx, "source_consistency_reviewer").mode).toBe("mock");
    expect(resolveProvider(ctx, "legal_style_reviewer").mode).toBe("mock");

    const result = await aggRunMockReviews(ready.s, ctx);

    const counterRun = result.state.agent_runs.find(
      (r) => r.role === "counterparty_reviewer",
    );
    expect(counterRun).toBeDefined();
    expect(counterRun!.mode).toBe("real");
    expect(counterRun!.provider_id).toBe("anthropic");
    expect(counterRun!.status).toBe("completed");

    // Other reviewers stayed on mock.
    const sourceRun = result.state.agent_runs.find(
      (r) => r.role === "source_consistency_reviewer",
    );
    const styleRun = result.state.agent_runs.find(
      (r) => r.role === "legal_style_reviewer",
    );
    expect(sourceRun!.mode).toBe("mock");
    expect(styleRun!.mode).toBe("mock");

    // The Anthropic stub was actually hit.
    expect(captured.some((c) => c.provider === "anthropic")).toBe(true);
    expect(captured.every((c) => c.provider === "anthropic")).toBe(true);
  });
});

describe("aggRunMockReviews honors source_consistency_reviewer real (openai) routing", () => {
  it("source_consistency_reviewer AgentRun records mode=real + provider_id=openai", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const captured: CapturedCall[] = [];
    const ctx = buildCtxWithRealForReviewRole(
      ready.ctx,
      "source_consistency_reviewer",
      "openai",
      captured,
    );

    const result = await aggRunMockReviews(ready.s, ctx);

    const sourceRun = result.state.agent_runs.find(
      (r) => r.role === "source_consistency_reviewer",
    );
    expect(sourceRun).toBeDefined();
    expect(sourceRun!.mode).toBe("real");
    expect(sourceRun!.provider_id).toBe("openai");
    expect(sourceRun!.status).toBe("completed");

    // Other reviewers stayed on mock.
    expect(
      result.state.agent_runs.find((r) => r.role === "counterparty_reviewer")!.mode,
    ).toBe("mock");
    expect(
      result.state.agent_runs.find((r) => r.role === "legal_style_reviewer")!.mode,
    ).toBe("mock");

    expect(captured.every((c) => c.provider === "openai")).toBe(true);
  });
});

describe("aggRunMockReviews honors legal_style_reviewer real (openai) routing", () => {
  it("legal_style_reviewer AgentRun records mode=real + provider_id=openai", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const captured: CapturedCall[] = [];
    const ctx = buildCtxWithRealForReviewRole(
      ready.ctx,
      "legal_style_reviewer",
      "openai",
      captured,
    );

    const result = await aggRunMockReviews(ready.s, ctx);

    const styleRun = result.state.agent_runs.find(
      (r) => r.role === "legal_style_reviewer",
    );
    expect(styleRun).toBeDefined();
    expect(styleRun!.mode).toBe("real");
    expect(styleRun!.provider_id).toBe("openai");
    expect(styleRun!.status).toBe("completed");

    expect(
      result.state.agent_runs.find((r) => r.role === "counterparty_reviewer")!.mode,
    ).toBe("mock");
    expect(
      result.state.agent_runs.find((r) => r.role === "source_consistency_reviewer")!.mode,
    ).toBe("mock");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Mixed-provider routing — all three real, different backends
// ─────────────────────────────────────────────────────────────────────

describe("aggRunMockReviews — all three reviewers real, mixed providers", () => {
  it("counterparty=anthropic, source_consistency=openai, legal_style=openai", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const openaiCaptured: CapturedCall[] = [];
    const anthropicCaptured: CapturedCall[] = [];

    const mock = createMockProvider();
    const realOpenai = createOpenAIProvider({
      api_key: "sk-fake",
      model_id: "gpt-4o-mini",
      client: stubOpenAIClient(EMPTY_REVIEW_OUTPUT, openaiCaptured),
    });
    const realAnthropic = createAnthropicProvider({
      api_key: "sk-ant-fake",
      model_id: "claude-3-5-sonnet-20241022",
      client: stubAnthropicClient(EMPTY_REVIEW_OUTPUT, anthropicCaptured),
    });

    const ctx: AggregateContext = {
      ...ready.ctx,
      provider: mock,
      getProvider: (role: AgentRole) => {
        if (role === "counterparty_reviewer") return realAnthropic;
        if (role === "source_consistency_reviewer") return realOpenai;
        if (role === "legal_style_reviewer") return realOpenai;
        return mock;
      },
    };

    const result = await aggRunMockReviews(ready.s, ctx);

    const counterRun = result.state.agent_runs.find(
      (r) => r.role === "counterparty_reviewer",
    );
    const sourceRun = result.state.agent_runs.find(
      (r) => r.role === "source_consistency_reviewer",
    );
    const styleRun = result.state.agent_runs.find(
      (r) => r.role === "legal_style_reviewer",
    );

    expect(counterRun!.mode).toBe("real");
    expect(counterRun!.provider_id).toBe("anthropic");
    expect(sourceRun!.mode).toBe("real");
    expect(sourceRun!.provider_id).toBe("openai");
    expect(styleRun!.mode).toBe("real");
    expect(styleRun!.provider_id).toBe("openai");

    // Both stubs were hit.
    expect(anthropicCaptured.length).toBeGreaterThanOrEqual(1);
    expect(openaiCaptured.length).toBeGreaterThanOrEqual(2); // source + style
  });
});

// ─────────────────────────────────────────────────────────────────────
// Defense-in-depth — default mock context
// ─────────────────────────────────────────────────────────────────────

describe("Default mock context — review roles all mock without explicit getProvider()", () => {
  it("createMockAggregateContext() routes all three review roles to mock", () => {
    const ctx = createMockAggregateContext();
    for (const role of [
      "counterparty_reviewer",
      "source_consistency_reviewer",
      "legal_style_reviewer",
    ] as AgentRole[]) {
      expect(resolveProvider(ctx, role).mode).toBe("mock");
    }
  });
});
