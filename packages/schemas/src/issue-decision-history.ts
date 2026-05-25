import { z } from "zod";
import { actorRoleSchema } from "./actors";
import { idSchema, isoDateTimeSchema } from "./ids";
import { issueHumanDecisionSchema } from "./issue-card";

/**
 * Append-only log of every human decision change against an Issue Card
 * (Milestone 3C). The Issue Card itself only carries the LATEST decision;
 * the full audit trail of changes (pending → rejected → accepted, etc.)
 * lives here.
 *
 * `previous_decision` is the decision the card had immediately before this
 * change. For the very first decision on a freshly-seeded card it is
 * `"pending"` (the seed default), so a reader can always reconstruct the
 * chain.
 *
 * `partial_note` mirrors the same field on IssueCard — captured here so the
 * history is self-contained (you can audit a decision change without
 * cross-referencing the current card state, which may have moved on).
 *
 * `reason_note` is an optional short rationale (the lawyer's notes line).
 * Not required by the brief; the schema accepts null/undefined.
 *
 * Internal-only. Per PLATFORM_BRIEF.md §12 rule 5, decision history is
 * confidential — it MUST NOT appear in the external clean DOCX or cover
 * email exports. The commentary DOCX and negotiation matrix DOCX may show
 * it; tests in `packages/core/tests/export-renderer.test.ts` guard the
 * external-side absence.
 */
export const issueDecisionHistoryEntrySchema = z.object({
  id: idSchema,
  project_id: idSchema,
  issue_id: idSchema,
  previous_decision: issueHumanDecisionSchema,
  new_decision: issueHumanDecisionSchema,
  actor_id: idSchema,
  actor_role: actorRoleSchema,
  changed_at: isoDateTimeSchema,
  partial_note: z.string().nullable(),
  reason_note: z.string().nullable(),
});
export type IssueDecisionHistoryEntry = z.infer<typeof issueDecisionHistoryEntrySchema>;
