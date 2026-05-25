import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const issueSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;

export const issueRecommendedActionSchema = z.enum(["accept", "revise", "reject", "defer"]);
export type IssueRecommendedAction = z.infer<typeof issueRecommendedActionSchema>;

export const issueHumanDecisionSchema = z.enum([
  "pending",
  "accepted",
  "partially_accepted",
  "rejected",
  "deferred",
]);
export type IssueHumanDecision = z.infer<typeof issueHumanDecisionSchema>;

export const issueLocationSchema = z.object({
  article: z.string().optional(),
  paragraph: z.string().optional(),
  item: z.string().optional(),
});
export type IssueLocation = z.infer<typeof issueLocationSchema>;

export const issueCardSchema = z.object({
  issue_id: idSchema,
  project_id: idSchema,
  source_agent: z.string().min(1),
  severity: issueSeveritySchema,
  location: issueLocationSchema,
  issue_type: z.string().min(1),
  problem: z.string().min(1),
  why_it_matters: z.string().min(1),
  recommended_revision: z.string().min(1),
  business_impact: z.string().min(1),
  recommended_action: issueRecommendedActionSchema,
  human_decision: issueHumanDecisionSchema,
  partial_note: z.string().nullable(),
  /**
   * Optional short rationale captured at decision time (Milestone 3C).
   * Mirrors `partial_note` but applies to any decision outcome. Never
   * required — the brief does not mandate it. Full change trail lives in
   * `ProjectState.decision_history`; this field holds the LATEST note.
   */
  reason_note: z.string().nullable().optional(),
  decided_by: idSchema.nullable(),
  decided_at: isoDateTimeSchema.nullable(),
  applied_version: idSchema.nullable(),
});
export type IssueCard = z.infer<typeof issueCardSchema>;
