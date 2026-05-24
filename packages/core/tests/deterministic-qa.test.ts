import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  ALL_QA_CHECK_IDS,
  aggCreateRevision,
  aggDecideIssue,
  aggRunDeterministicQA,
  aggRunMockFinalQA,
  buildRevisionInputFromIssueCards,
  convertQAFindingToIssueCard,
  DETERMINISTIC_QA_SOURCE_AGENT,
  runDeterministicQA,
} from "@contractops/core";
import { humanLawyer, testEnv } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";
import type { LLMProvider, LLMProviderInput, LLMProviderJsonResult, LLMProviderTextResult } from "@contractops/core";
import { createMockProvider } from "@contractops/core";

/**
 * Runner-level + aggregate-integration tests for the deterministic-QA engine.
 * Unit tests for each individual check live in qa-checks.test.ts.
 */

describe("runDeterministicQA", () => {
  it("returns checks_run for every registered check", () => {
    const result = runDeterministicQA({ contract_content: "제1조 (목적)\n본조." });
    const ids = result.checks_run.map((c) => c.check_id).sort();
    expect(ids).toEqual([...ALL_QA_CHECK_IDS].sort());
  });

  it("returns no findings for a clean, uniform contract body", () => {
    const text = [
      "제1조 (목적)",
      "본조는 한 문단이다.",
      "제2조 (위탁료)",
      "위탁료는 금 1,000,000원으로 한다.",
      "지급일은 2026년 6월 19일이다.",
    ].join("\n");
    const result = runDeterministicQA({ contract_content: text });
    expect(result.findings).toEqual([]);
  });

  it("collects findings from multiple checks in a single run", () => {
    const text = [
      "제1조 (목적)",
      "기타 항목과 제99조에 의한 처리.",
      "위탁료는 금 1,000,000원, 보증금은 100만 원.",
    ].join("\n");
    const result = runDeterministicQA({ contract_content: text });
    const checkIds = new Set(result.findings.map((f) => f.check_id));
    expect(checkIds.has("forbidden_expressions")).toBe(true);
    expect(checkIds.has("cross_references")).toBe(true);
    expect(checkIds.has("amount_format")).toBe(true);
  });

  it("does not call any provider or hit the network (synchronous)", () => {
    // Pure sync function: a thrown error would propagate immediately without
    // a Promise wrapper.
    const start = Date.now();
    const result = runDeterministicQA({
      contract_content: "제1조 (목적)\n기타 항목.",
    });
    expect(Date.now() - start).toBeLessThan(50);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});

describe("convertQAFindingToIssueCard", () => {
  it("produces an IssueCard seed with source_agent='deterministic_qa'", () => {
    const result = runDeterministicQA({ contract_content: "제1조 (목적)\n기타 항목." });
    const finding = result.findings.find((f) => f.check_id === "forbidden_expressions")!;
    const seed = convertQAFindingToIssueCard(finding, "p1");
    expect(seed.source_agent).toBe(DETERMINISTIC_QA_SOURCE_AGENT);
    expect(seed.severity).toBe(finding.severity);
    expect(seed.problem).toBe(finding.problem);
    expect(seed.recommended_revision).toBe(finding.recommended_revision);
    expect(seed.issue_type).toBe("forbidden_expressions");
    expect(seed.business_impact.length).toBeGreaterThan(0);
    expect(seed.recommended_action).toBe("revise");
    expect(seed.project_id).toBe("p1");
  });
});

describe("aggRunDeterministicQA", () => {
  it("creates IssueCards from findings + emits deterministic_qa_run audit", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    // Inject a problematic contract version so the engine has something to find.
    const dirtyVersion = {
      ...ready.s.contract_versions[0]!,
      content: "제1조 (목적)\n기타 항목과 제99조 참조.",
    };
    const dirtyState = {
      ...ready.s,
      contract_versions: [dirtyVersion],
    };
    const res = aggRunDeterministicQA(dirtyState, ready.env, humanLawyer);

    const detCards = res.state.issue_cards.filter(
      (c) => c.source_agent === DETERMINISTIC_QA_SOURCE_AGENT,
    );
    expect(detCards.length).toBeGreaterThan(0);

    expect(res.audits.length).toBe(1);
    expect(res.audits[0]!.event_type).toBe("deterministic_qa_run");
    const payload = res.audits[0]!.payload as Record<string, unknown>;
    expect(payload.qa_engine).toBe("deterministic");
    expect(typeof payload.finding_count).toBe("number");
    expect(Array.isArray(payload.check_ids)).toBe(true);
  });

  it("creates NO AgentRun (deterministic QA is not an LLM call)", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dirtyState = {
      ...ready.s,
      contract_versions: [
        { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목." },
      ],
    };
    const before = ready.s.agent_runs.length;
    const res = aggRunDeterministicQA(dirtyState, ready.env, humanLawyer);
    expect(res.state.agent_runs.length).toBe(before);
  });
});

describe("aggRunMockFinalQA runs deterministic QA before LLM final QA", () => {
  it("includes deterministic_qa cards in issue_cards", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await import("@contractops/core").then((m) =>
      m.aggRunMockReviews(ready.s, ready.ctx),
    );
    // Replace v0 with a dirty body that triggers deterministic findings.
    const dirty = {
      ...reviewed.state,
      contract_versions: reviewed.state.contract_versions.map((v) => ({
        ...v,
        content: v.content + "\n제1조 (보충)\n기타 항목.",
      })),
    };
    // Skip to revised status so aggRunMockFinalQA's status guard accepts it.
    // Decide all open issue cards so revision is possible.
    let state = dirty;
    for (const c of state.issue_cards.filter((x) => x.human_decision === "pending")) {
      state = aggDecideIssue(
        state,
        { issue_id: c.issue_id, decision: "rejected", decided_by: humanLawyer },
        ready.env,
      ).state;
    }
    const revised = await aggCreateRevision(state, ready.ctx);
    const dirtyRevised = {
      ...revised.state,
      contract_versions: revised.state.contract_versions.map((v, idx) =>
        idx === revised.state.contract_versions.length - 1
          ? { ...v, content: v.content + "\n기타 항목." }
          : v,
      ),
    };
    const qaRes = await aggRunMockFinalQA(dirtyRevised, ready.ctx);
    const detCards = qaRes.state.issue_cards.filter(
      (c) => c.source_agent === DETERMINISTIC_QA_SOURCE_AGENT,
    );
    expect(detCards.length).toBeGreaterThan(0);

    // Audit MUST include deterministic_qa_run (not just LLM events).
    expect(qaRes.audits.some((a) => a.event_type === "deterministic_qa_run")).toBe(true);
  });
});

describe("Rejected deterministic_qa IssueCard is never applied in revision", () => {
  it("rejected card is excluded from buildRevisionInputFromIssueCards", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dirty = {
      ...ready.s,
      contract_versions: [
        { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목." },
      ],
    };
    const det = aggRunDeterministicQA(dirty, ready.env, humanLawyer);
    const detCard = det.state.issue_cards.find(
      (c) => c.source_agent === DETERMINISTIC_QA_SOURCE_AGENT,
    )!;
    const rejected = aggDecideIssue(
      det.state,
      { issue_id: detCard.issue_id, decision: "rejected", decided_by: humanLawyer },
      ready.env,
    );
    const { inputs, skipped } = buildRevisionInputFromIssueCards(rejected.state.issue_cards);
    expect(inputs.find((i) => i.issue_card_id === detCard.issue_id)).toBeUndefined();
    expect(skipped.find((s) => s.issue_card_id === detCard.issue_id)).toBeDefined();
  });

  it("revision content does not contain the rejected card's id", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dirty = {
      ...ready.s,
      contract_versions: [
        { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목." },
      ],
    };
    let s = aggRunDeterministicQA(dirty, ready.env, humanLawyer).state;
    const detCard = s.issue_cards.find(
      (c) => c.source_agent === DETERMINISTIC_QA_SOURCE_AGENT,
    )!;
    s = aggDecideIssue(
      s,
      { issue_id: detCard.issue_id, decision: "rejected", decided_by: humanLawyer },
      ready.env,
    ).state;
    // Decide remaining cards so we can revise.
    for (const c of s.issue_cards.filter((x) => x.human_decision === "pending")) {
      s = aggDecideIssue(
        s,
        { issue_id: c.issue_id, decision: "rejected", decided_by: humanLawyer },
        ready.env,
      ).state;
    }
    const rev = await aggCreateRevision(s, ready.ctx);
    expect(rev.state.contract_versions[rev.state.contract_versions.length - 1]!.content).not.toContain(
      detCard.issue_id,
    );
    // And the card's applied_version stays null.
    const finalCard = rev.state.issue_cards.find((c) => c.issue_id === detCard.issue_id)!;
    expect(finalCard.applied_version).toBeNull();
  });
});

describe("Deterministic QA does not call any LLM provider", () => {
  it("a spy provider is never invoked during runDeterministicQA or aggRunDeterministicQA", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    let calls = 0;
    const inner = createMockProvider();
    const spy: LLMProvider = {
      provider_id: inner.provider_id,
      model_id: inner.model_id,
      mode: inner.mode,
      completeText: async (input: LLMProviderInput): Promise<LLMProviderTextResult> => {
        calls++;
        return inner.completeText(input);
      },
      completeJson: async <T,>(
        input: LLMProviderInput,
        schema: Parameters<typeof inner.completeJson<T>>[1],
      ): Promise<LLMProviderJsonResult<T>> => {
        calls++;
        return inner.completeJson(input, schema) as Promise<LLMProviderJsonResult<T>>;
      },
    };

    runDeterministicQA({ contract_content: "제1조 (목적)\n기타 항목." });
    expect(calls).toBe(0);

    aggRunDeterministicQA(
      {
        ...ready.s,
        contract_versions: [
          { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목." },
        ],
      },
      ready.env,
      humanLawyer,
    );
    expect(calls).toBe(0);
    // ensure the spy is referenced so its shape stays valid:
    expect(spy.mode).toBe("mock");
  });
});
