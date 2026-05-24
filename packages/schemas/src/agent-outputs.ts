import { z } from "zod";
import {
  issueLocationSchema,
  issueRecommendedActionSchema,
  issueSeveritySchema,
} from "./issue-card";

/**
 * Structured outputs each agent must produce. These schemas are the contract
 * between any LLM provider (mock or real) and the workflow layer. A provider
 * that fails to produce a matching structure is rejected at validation time.
 */

export const dealMemoDraftOutputSchema = z.object({
  content: z.string().min(1),
  rationale: z.string().nullable().optional(),
  warnings: z.array(z.string()).optional(),
});
export type DealMemoDraftOutput = z.infer<typeof dealMemoDraftOutputSchema>;

export const draftingPlanOutputSchema = z.object({
  content: z.string().min(1),
  table_of_contents: z.array(z.string()),
  is_custom: z.boolean(),
  open_questions: z.array(z.string()).optional(),
});
export type DraftingPlanOutput = z.infer<typeof draftingPlanOutputSchema>;

export const contractDraftOutputSchema = z.object({
  content: z.string().min(1),
  version_number: z.string().optional(),
  notes: z.array(z.string()).optional(),
});
export type ContractDraftOutput = z.infer<typeof contractDraftOutputSchema>;

/**
 * Every review finding must shape as an Issue Card seed. This is the
 * "review findings → Issue Cards" guarantee from PLATFORM_BRIEF.md §2 (step
 * 18) and §8.
 */
export const issueCardFindingSchema = z.object({
  source_agent: z.string().min(1),
  severity: issueSeveritySchema,
  location: issueLocationSchema,
  issue_type: z.string().min(1),
  problem: z.string().min(1),
  why_it_matters: z.string().min(1),
  recommended_revision: z.string().min(1),
  business_impact: z.string().min(1),
  recommended_action: issueRecommendedActionSchema,
});
export type IssueCardFinding = z.infer<typeof issueCardFindingSchema>;

export const issueCardListOutputSchema = z.object({
  findings: z.array(issueCardFindingSchema),
});
export type IssueCardListOutput = z.infer<typeof issueCardListOutputSchema>;

export const revisionOutputSchema = z.object({
  content: z.string().min(1),
  applied_issue_card_ids: z.array(z.string()),
  notes: z.array(z.string()).optional(),
});
export type RevisionOutput = z.infer<typeof revisionOutputSchema>;

export const finalQAFindingSchema = z.object({
  severity: issueSeveritySchema,
  location: issueLocationSchema,
  issue_type: z.string().min(1),
  problem: z.string().min(1),
  recommended_revision: z.string().min(1),
});
export type FinalQAFinding = z.infer<typeof finalQAFindingSchema>;

export const finalQAOutputSchema = z.object({
  findings: z.array(finalQAFindingSchema),
  passes: z.array(z.string()).optional(),
});
export type FinalQAOutput = z.infer<typeof finalQAOutputSchema>;
