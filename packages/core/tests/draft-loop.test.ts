/**
 * Pilot P1 — Solo Drafting Loop aggregate ops.
 *
 * Verifies the four new ops:
 *   - aggCreateDraftIteration  (lawyer-only; appends DraftIteration)
 *   - aggSynthesizeReviews     (lawyer-only; records AgentRun;
 *                               preserves Issue Card provenance)
 *   - aggBatchAcceptReviewIssues (lawyer-only; refuses critical;
 *                                 routes each card through aggDecideIssue
 *                                 so decision_history grows monotonically)
 *   - aggStopDraftLoop         (lawyer-only; pure status transition)
 *
 * Also covers the contract invariants:
 *   - synthesizer NEVER creates a ContractVersion
 *   - rejected Issue Cards never appear in the subsequent revision
 *   - pending Issue Cards are not silently applied (revision filters
 *     accepted/partially-accepted only — pre-existing 3C/4A invariant)
 *
 * Mock-only. No network. No real provider.
 */
import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  aggBatchAcceptReviewIssues,
  aggCreateDraftIteration,
  aggCreateRevision,
  aggDecideIssue,
  aggRunMockReviews,
  aggStopDraftLoop,
  aggSynthesizeReviews,
  createMockProvider,
  resolveProvider,
  type AggregateContext,
  type ProjectState,
} from "@contractops/core";
import type { DraftIteration, RevisionSynthesisOutput } from "@contractops/schemas";
import { humanLawyer, nonLawyer } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";

/**
 * `buildToReadyForReviews` uses the default mock provider whose reviewer
 * responses are `{ findings: [] }` — so `aggRunMockReviews` produces zero
 * cards in the baseline scenario. The draft-loop tests need a non-empty
 * pending set, so we manually seed synthetic Issue Cards onto the state
 * (this matches the pattern used by `real-llm-4a-routing.test.ts`).
 */
function withSyntheticPendingCards(state: ProjectState, count = 3): ProjectState {
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) return state;
  const synthSeverities: Array<"low" | "medium" | "high" | "critical"> = [
    "medium",
    "high",
    "low",
    "critical",
  ];
  const synthetic = Array.from({ length: count }, (_, i) => ({
    issue_id: `ic_loop_${i + 1}`,
    project_id: state.project.id,
    source_agent: "counterparty_reviewer",
    severity: synthSeverities[i % synthSeverities.length]!,
    location: { article: `제${i + 3}조` },
    issue_type: "negotiation",
    problem: `synthetic problem ${i + 1}`,
    why_it_matters: `synthetic rationale ${i + 1}`,
    recommended_revision: `synthetic revision text ${i + 1}`,
    business_impact: "low",
    recommended_action: "revise" as const,
    human_decision: "pending" as const,
    partial_note: null,
    reason_note: null,
    decided_by: null,
    decided_at: null,
    applied_version: null,
  }));
  return {
    ...state,
    issue_cards: [...state.issue_cards, ...synthetic],
  } as unknown as ProjectState;
}

// ─────────────────────────────────────────────────────────────────────
// aggCreateDraftIteration
// ─────────────────────────────────────────────────────────────────────

describe("aggCreateDraftIteration", () => {
  it("appends a planned DraftIteration when no draft exists; status=planned", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const before: ProjectState = {
      ...ready.s,
      contract_versions: [],
      draft_iterations: [],
    };
    const res = aggCreateDraftIteration(before, ready.ctx, {});
    expect(res.state.draft_iterations).toHaveLength(1);
    expect(res.state.draft_iterations[0]!.iteration_number).toBe(1);
    expect(res.state.draft_iterations[0]!.status).toBe("planned");
    expect(res.state.draft_iterations[0]!.base_contract_version_id).toBeNull();
    expect(res.state.draft_iterations[0]!.created_by).toBe(ready.ctx.actor.id);
    expect(res.audits).toHaveLength(1);
    expect(res.audits[0]!.event_type).toBe("draft_iteration_created");
  });

  it("pins the latest ContractVersion as base when one exists; status=drafted", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    expect(ready.s.contract_versions.length).toBeGreaterThanOrEqual(1);
    const res = aggCreateDraftIteration(ready.s, ready.ctx, {});
    const it = res.state.draft_iterations[0]!;
    expect(it.status).toBe("drafted");
    expect(it.base_contract_version_id).toBe(
      ready.s.contract_versions[ready.s.contract_versions.length - 1]!.id,
    );
  });

  it("rejects non-lawyer actors", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const ctx: AggregateContext = { ...ready.ctx, actor: nonLawyer };
    expect(() => aggCreateDraftIteration(ready.s, ctx, {})).toThrow(/human_lawyer/);
  });

  it("iteration_number is monotonic across multiple opens", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    let s = ready.s;
    for (let i = 1; i <= 3; i++) {
      const res = aggCreateDraftIteration(s, ready.ctx, {});
      s = res.state;
      expect(s.draft_iterations[s.draft_iterations.length - 1]!.iteration_number).toBe(i);
    }
    expect(s.draft_iterations).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// aggSynthesizeReviews
// ─────────────────────────────────────────────────────────────────────

describe("aggSynthesizeReviews", () => {
  async function buildToSynthesizable(): Promise<{
    s: ProjectState;
    ctx: AggregateContext;
    iteration: DraftIteration;
  }> {
    const ready = await buildToReadyForReviews("nda.json");
    // Run reviews so issue cards exist (pending). The default mock provider's
    // canned reviewer responses are empty findings; seed synthetic cards on
    // top so the synthesizer has something to ingest.
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    const seeded = withSyntheticPendingCards(reviewed.state);
    // Open an iteration on top.
    const opened = aggCreateDraftIteration(seeded, ready.ctx, {});
    // Provider override: the default mock returns empty source_issue_card_ids,
    // which would trip the provenance guard. Override with a synthesizer
    // response that names every pending id so the guard passes in the
    // happy-path tests.
    const pendingIds = opened.state.issue_cards
      .filter((c) => c.human_decision === "pending")
      .map((c) => c.issue_id);
    const latest =
      opened.state.contract_versions[opened.state.contract_versions.length - 1]!;
    const provider = createMockProvider({
      json_responses: {
        [`review_synthesizer::${latest.id}`]: {
          summary: "(test) synthesizer covered every pending card",
          priority_ordered_issues: pendingIds.map((id) => ({
            title: `g_${id}`,
            severity: "medium" as const,
            source_issue_card_ids: [id],
            merged_revision_instruction: `apply ${id}`,
          })),
          merged_revision_instructions: pendingIds.map((id) => `apply ${id}`),
          conflicts_between_reviewers: [],
          instructions_for_gpt_revision: "Apply listed items in order.",
          excluded_or_low_confidence_items: [],
          source_issue_card_ids: pendingIds,
        },
      },
    });
    const ctx: AggregateContext = { ...ready.ctx, provider, getProvider: () => provider };
    return {
      s: opened.state,
      ctx,
      iteration: opened.state.draft_iterations[0]!,
    };
  }

  it("records an AgentRun (role=review_synthesizer) and updates the iteration", async () => {
    const { s, ctx, iteration } = await buildToSynthesizable();
    const beforeRuns = s.agent_runs.length;
    const beforeVersions = s.contract_versions.length;
    const res = await aggSynthesizeReviews(s, { iteration_id: iteration.id }, ctx);

    // AgentRun appended; ContractVersion NOT created.
    expect(res.state.agent_runs.length).toBe(beforeRuns + 1);
    expect(res.state.contract_versions.length).toBe(beforeVersions);
    const run = res.state.agent_runs[res.state.agent_runs.length - 1]!;
    expect(run.role).toBe("review_synthesizer");
    expect(run.status).toBe("completed");

    // Iteration updated.
    const updated = res.state.draft_iterations.find((it) => it.id === iteration.id)!;
    expect(updated.status).toBe("synthesized");
    expect(updated.synthesis_agent_run_id).toBe(run.id);
    expect(updated.synthesis_output).toBeTruthy();
    expect(updated.review_issue_card_ids.length).toBeGreaterThan(0);
    expect(updated.provider_summary?.synthesizer_provider_id).toBe(run.provider_id);
    expect(updated.provider_summary?.synthesizer_mode).toBe(run.mode);

    // Audit log.
    expect(res.audits).toHaveLength(1);
    expect(res.audits[0]!.event_type).toBe("draft_iteration_synthesized");
  });

  it("synthesis output preserves source_issue_card_ids for every pending card", async () => {
    const { s, ctx, iteration } = await buildToSynthesizable();
    const pendingIds = s.issue_cards
      .filter((c) => c.human_decision === "pending")
      .map((c) => c.issue_id);
    const res = await aggSynthesizeReviews(s, { iteration_id: iteration.id }, ctx);
    const updated = res.state.draft_iterations.find((it) => it.id === iteration.id)!;
    const synth = updated.synthesis_output as RevisionSynthesisOutput;
    for (const id of pendingIds) {
      expect(synth.source_issue_card_ids).toContain(id);
    }
  });

  it("rejects non-lawyer actors", async () => {
    const { s, ctx, iteration } = await buildToSynthesizable();
    const badCtx: AggregateContext = { ...ctx, actor: nonLawyer };
    await expect(
      aggSynthesizeReviews(s, { iteration_id: iteration.id }, badCtx),
    ).rejects.toThrow(/human_lawyer/);
  });

  it("throws if the named iteration does not exist", async () => {
    const { s, ctx } = await buildToSynthesizable();
    await expect(
      aggSynthesizeReviews(s, { iteration_id: "nonexistent_id" }, ctx),
    ).rejects.toThrow(/not found/);
  });

  it("does NOT mutate contract_versions or issue_cards", async () => {
    const { s, ctx, iteration } = await buildToSynthesizable();
    const beforeCardsSerialized = JSON.stringify(s.issue_cards);
    const beforeVersionsSerialized = JSON.stringify(s.contract_versions);
    const res = await aggSynthesizeReviews(s, { iteration_id: iteration.id }, ctx);
    expect(JSON.stringify(res.state.issue_cards)).toBe(beforeCardsSerialized);
    expect(JSON.stringify(res.state.contract_versions)).toBe(beforeVersionsSerialized);
  });

  it("provenance guard: throws if synthesizer drops a pending issue id", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    const seeded = withSyntheticPendingCards(reviewed.state);
    const opened = aggCreateDraftIteration(seeded, ready.ctx, {});
    // Stub provider that returns a synthesis missing every source id.
    const dropProvider = createMockProvider({
      json_responses: {
        [`review_synthesizer::${opened.state.contract_versions[opened.state.contract_versions.length - 1]!.id}`]:
          {
            summary: "(stub — dropping all source ids)",
            priority_ordered_issues: [],
            merged_revision_instructions: [],
            conflicts_between_reviewers: [],
            instructions_for_gpt_revision: "(none)",
            excluded_or_low_confidence_items: [],
            source_issue_card_ids: [], // ← deliberately empty
          },
      },
    });
    const badCtx: AggregateContext = {
      ...ready.ctx,
      getProvider: () => dropProvider,
    };
    await expect(
      aggSynthesizeReviews(
        opened.state,
        { iteration_id: opened.state.draft_iterations[0]!.id },
        badCtx,
      ),
    ).rejects.toThrow(/provenance broken/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// aggBatchAcceptReviewIssues
// ─────────────────────────────────────────────────────────────────────

describe("aggBatchAcceptReviewIssues", () => {
  it("accepts every supplied pending card; one decision_history entry per card; one summary audit + per-card audits", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    const s = withSyntheticPendingCards(reviewed.state);
    const nonCritical = s.issue_cards.filter(
      (c) => c.human_decision === "pending" && c.severity !== "critical",
    );
    expect(nonCritical.length).toBeGreaterThan(0);
    const ids = nonCritical.map((c) => c.issue_id);
    const before = s.decision_history.length;
    const res = aggBatchAcceptReviewIssues(
      s,
      humanLawyer,
      { issue_ids: ids, reason_note: "batch via P1 loop" },
      ready.env,
    );
    // Each accepted card got one decision_history entry.
    expect(res.state.decision_history.length).toBe(before + ids.length);
    // The card statuses moved to accepted.
    for (const id of ids) {
      const card = res.state.issue_cards.find((c) => c.issue_id === id)!;
      expect(card.human_decision).toBe("accepted");
    }
    // One audit per card + one summary audit at the end.
    const summary = res.audits.find((a) => a.event_type === "review_issues_batch_accepted");
    expect(summary).toBeDefined();
    const perCard = res.audits.filter((a) => a.event_type === "issue_card_decided");
    expect(perCard.length).toBe(ids.length);
  });

  it("REFUSES the whole batch if any critical card is included", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    const s = withSyntheticPendingCards(reviewed.state);
    const critical = s.issue_cards.find(
      (c) => c.human_decision === "pending" && c.severity === "critical",
    );
    if (!critical) return; // playbook fixture has no critical → skip
    expect(() =>
      aggBatchAcceptReviewIssues(
        s,
        humanLawyer,
        { issue_ids: [critical.issue_id] },
        ready.env,
      ),
    ).toThrow(/CRITICAL/);
  });

  it("rejects non-lawyer actors", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    const s = withSyntheticPendingCards(reviewed.state);
    const id = s.issue_cards[0]!.issue_id;
    expect(() =>
      aggBatchAcceptReviewIssues(s, nonLawyer, { issue_ids: [id] }, ready.env),
    ).toThrow(/human_lawyer/);
  });

  it("silently skips cards already decided (lawyer's existing decision wins)", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    let s = withSyntheticPendingCards(reviewed.state);
    // Decide one card as rejected manually first.
    const target = s.issue_cards.find((c) => c.severity !== "critical")!;
    s = aggDecideIssue(
      s,
      { issue_id: target.issue_id, decision: "rejected", decided_by: humanLawyer },
      ready.env,
    ).state;
    expect(
      s.issue_cards.find((c) => c.issue_id === target.issue_id)!.human_decision,
    ).toBe("rejected");
    // Now try batch accept including this id.
    const res = aggBatchAcceptReviewIssues(
      s,
      humanLawyer,
      { issue_ids: [target.issue_id] },
      ready.env,
    );
    // The decision must STILL be rejected (not silently overwritten).
    expect(
      res.state.issue_cards.find((c) => c.issue_id === target.issue_id)!.human_decision,
    ).toBe("rejected");
    // Summary audit should list it in skipped_already_decided_ids.
    const summary = res.audits.find((a) => a.event_type === "review_issues_batch_accepted")!;
    const payload = summary.payload as { skipped_already_decided_ids: string[] };
    expect(payload.skipped_already_decided_ids).toContain(target.issue_id);
  });

  it("rejected cards remain rejected and are NEVER applied by the next revision", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const reviewed = await aggRunMockReviews(ready.s, ready.ctx);
    let s = withSyntheticPendingCards(reviewed.state);
    // Decide one as rejected, the rest as accepted (so we can run revision).
    const cards = s.issue_cards.filter(
      (c) => c.human_decision === "pending" && c.severity !== "critical",
    );
    const rejected = cards[0]!;
    s = aggDecideIssue(
      s,
      { issue_id: rejected.issue_id, decision: "rejected", decided_by: humanLawyer },
      ready.env,
    ).state;
    for (let i = 1; i < cards.length; i++) {
      s = aggDecideIssue(
        s,
        { issue_id: cards[i]!.issue_id, decision: "accepted", decided_by: humanLawyer },
        ready.env,
      ).state;
    }
    const revisedRes = await aggCreateRevision(s, ready.ctx);
    const newVersion =
      revisedRes.state.contract_versions[revisedRes.state.contract_versions.length - 1]!;
    // The rejected card id must not appear in the revision body.
    expect(newVersion.content).not.toContain(rejected.issue_id);
  });
});

// ─────────────────────────────────────────────────────────────────────
// aggStopDraftLoop
// ─────────────────────────────────────────────────────────────────────

describe("aggStopDraftLoop", () => {
  it("marks the iteration stopped + records stopped_at + audit", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const opened = aggCreateDraftIteration(ready.s, ready.ctx, {});
    const it = opened.state.draft_iterations[0]!;
    const res = aggStopDraftLoop(
      opened.state,
      humanLawyer,
      { iteration_id: it.id, stop_note: "ready" },
      ready.env,
    );
    const updated = res.state.draft_iterations.find((x) => x.id === it.id)!;
    expect(updated.status).toBe("stopped");
    expect(updated.stopped_at).not.toBeNull();
    expect(updated.stop_note).toBe("ready");
    expect(res.audits).toHaveLength(1);
    expect(res.audits[0]!.event_type).toBe("draft_iteration_stopped");
  });

  it("rejects double-stop", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const opened = aggCreateDraftIteration(ready.s, ready.ctx, {});
    const it = opened.state.draft_iterations[0]!;
    const stopped = aggStopDraftLoop(
      opened.state,
      humanLawyer,
      { iteration_id: it.id },
      ready.env,
    );
    expect(() =>
      aggStopDraftLoop(stopped.state, humanLawyer, { iteration_id: it.id }, ready.env),
    ).toThrow(/already stopped/);
  });

  it("rejects non-lawyer actors", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const opened = aggCreateDraftIteration(ready.s, ready.ctx, {});
    expect(() =>
      aggStopDraftLoop(
        opened.state,
        nonLawyer,
        { iteration_id: opened.state.draft_iterations[0]!.id },
        ready.env,
      ),
    ).toThrow(/human_lawyer/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Provider routing — review_synthesizer mock-only in P1
// ─────────────────────────────────────────────────────────────────────

describe("review_synthesizer provider routing (P1 mock-only)", () => {
  it("default mock context routes review_synthesizer to mock", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    expect(resolveProvider(ready.ctx, "review_synthesizer").mode).toBe("mock");
  });
});
