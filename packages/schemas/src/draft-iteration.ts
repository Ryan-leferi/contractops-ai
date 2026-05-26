import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

/**
 * DraftIteration — one cycle of the Solo Drafting Loop (Pilot P1).
 *
 * A single in-house lawyer drives the loop:
 *   1. `aggCreateDraftIteration` opens an iteration in `planned` status,
 *      pinning the current latest `ContractVersion` as `base_contract_version_id`.
 *   2. The lawyer runs reviews (existing `aggRunMockReviews`) which seed
 *      Issue Cards. The iteration is moved to `reviewed` and the new
 *      Issue Card ids are captured in `review_issue_card_ids`.
 *   3. `aggSynthesizeReviews` runs `review_synthesizer` against the
 *      pending Issue Cards + draft and stores the resulting
 *      `RevisionSynthesisOutput` on the iteration; status → `synthesized`.
 *   4. Optional convenience: `aggBatchAcceptReviewIssues` accepts a
 *      lawyer-chosen subset of Issue Cards (NEVER critical, NEVER
 *      bypasses Issue Cards). Recorded in decision_history per card.
 *   5. `aggCreateRevision` produces the next `ContractVersion`; its id
 *      lands on `resulting_contract_version_id`; status → `revised`.
 *   6. The lawyer presses "Stop loop / mark ready for final review",
 *      which calls `aggStopDraftLoop` → status `stopped`.
 *
 * Stored INSIDE `ProjectState.draft_iterations` (append-only) so
 * memory / file / postgres adapters all work without new methods. The
 * iteration record is a thin pointer / receipt; the heavy data
 * (ContractVersion content, Issue Cards, AgentRuns, decision history)
 * lives in its existing collections.
 */
export const draftIterationStatusSchema = z.enum([
  "planned",
  "drafted",
  "reviewed",
  "synthesized",
  "revised",
  "stopped",
]);
export type DraftIterationStatus = z.infer<typeof draftIterationStatusSchema>;

/**
 * Provider summary captured per iteration so the UI can show, at a
 * glance, which models touched this cycle. Read-only — populated by the
 * aggregate ops, never by clients.
 */
export const draftIterationProviderSummarySchema = z.object({
  /** Most recent contract_drafter / revision_agent run for this iteration. */
  drafter_provider_id: z.string().nullable(),
  drafter_mode: z.enum(["mock", "real"]).nullable(),
  /** Most recent review_synthesizer run for this iteration. */
  synthesizer_provider_id: z.string().nullable(),
  synthesizer_mode: z.enum(["mock", "real"]).nullable(),
  /** Count of reviewer AgentRuns associated with this iteration. */
  reviewer_run_count: z.number().int().nonnegative(),
});
export type DraftIterationProviderSummary = z.infer<
  typeof draftIterationProviderSummarySchema
>;

export const draftIterationSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  /**
   * 1-indexed iteration counter scoped to a single project. The first
   * draft iteration the lawyer opens is `1`; the next is `2`, and so on.
   * Numbers are not reused even if an iteration is `stopped` early.
   */
  iteration_number: z.number().int().positive(),
  /**
   * The `ContractVersion.id` this iteration started from. `null` for the
   * very first iteration (when no draft exists yet — the next step is
   * an initial draft via `contract_drafter`).
   */
  base_contract_version_id: idSchema.nullable(),
  /**
   * The `ContractVersion.id` the revision_agent produced for this
   * iteration. `null` until revision runs.
   */
  resulting_contract_version_id: idSchema.nullable(),
  /**
   * Issue Card ids seeded by the review round driven by this iteration.
   * Used by the comparison view to attribute decisions to the iteration
   * they came from.
   */
  review_issue_card_ids: z.array(idSchema),
  /**
   * AgentRun id of the `review_synthesizer` run that produced the
   * synthesis. `null` until synthesis runs.
   */
  synthesis_agent_run_id: idSchema.nullable(),
  /**
   * The structured synthesis output (kept inline so the UI can render
   * it without re-fetching the AgentRun). The full payload also lives
   * on the corresponding AgentRun's `output_json` field, so this is a
   * convenience cache, not a separate source of truth.
   */
  synthesis_output: z.unknown().nullable(),
  status: draftIterationStatusSchema,
  created_at: isoDateTimeSchema,
  /** `Actor.id` of the human lawyer who opened this iteration. */
  created_by: idSchema,
  stopped_at: isoDateTimeSchema.nullable(),
  /**
   * Optional brief note from the lawyer captured at "stop loop" time,
   * e.g. "ready for partner sign-off".
   */
  stop_note: z.string().nullable(),
  provider_summary: draftIterationProviderSummarySchema.nullable(),
});
export type DraftIteration = z.infer<typeof draftIterationSchema>;
