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

// ─────────────────────────────────────────────────────────────────────
// Pilot P1 — review_synthesizer output
// ─────────────────────────────────────────────────────────────────────

/**
 * One prioritized synthesis bucket. Groups Issue Cards across reviewers
 * that point at the same underlying problem so the revision agent
 * doesn't double-apply or contradict itself.
 */
export const revisionSynthesisGroupSchema = z.object({
  /** Short title for the grouped finding (e.g. "Auto-renewal silent acceptance"). */
  title: z.string().min(1),
  /**
   * Highest severity among the cards in this group. The synthesis must
   * preserve the worst-case severity so the lawyer can triage by it.
   */
  severity: issueSeveritySchema,
  /** Issue Card ids that fed this group (provenance — never dropped). */
  source_issue_card_ids: z.array(z.string().min(1)),
  /** Explicit, model-agnostic revision instruction the revision_agent must apply. */
  merged_revision_instruction: z.string().min(1),
});
export type RevisionSynthesisGroup = z.infer<typeof revisionSynthesisGroupSchema>;

/**
 * Synthesizer's output schema. The `priority_ordered_issues` list IS the
 * revision_agent's working memory: groups are applied top-down. Conflicts
 * + excluded items are recorded so the lawyer can audit why a finding
 * did NOT make it into the next revision.
 *
 * NOTE: the synthesizer never directly mutates contract content. It
 * produces this package and an AgentRun; the next revision_agent run
 * consumes both, plus the Playbook + draft + accepted Issue Cards.
 */
export const revisionSynthesisOutputSchema = z.object({
  summary: z.string().min(1),
  priority_ordered_issues: z.array(revisionSynthesisGroupSchema),
  /** Free-text human-readable list of merged instructions, deduplicated. */
  merged_revision_instructions: z.array(z.string().min(1)),
  /**
   * Where two reviewers disagreed (e.g. counterparty says "delete clause",
   * legal-style says "rewrite for clarity"). Each entry names the source
   * cards + a recommended resolution.
   */
  conflicts_between_reviewers: z.array(
    z.object({
      description: z.string().min(1),
      source_issue_card_ids: z.array(z.string().min(1)),
      resolution_recommendation: z.string().min(1),
    }),
  ),
  /**
   * The concrete instruction package to pass to revision_agent for the
   * NEXT iteration's contract draft. Plain Korean/English imperative
   * prose — the revision prompt embeds it verbatim.
   */
  instructions_for_gpt_revision: z.string().min(1),
  /**
   * Items the synthesizer dropped (low confidence, duplicate, contradicted
   * by Playbook). Each carries the source Issue Card ids so the lawyer
   * can override.
   */
  excluded_or_low_confidence_items: z.array(
    z.object({
      reason: z.string().min(1),
      source_issue_card_ids: z.array(z.string().min(1)),
    }),
  ),
  /**
   * Flat list of every Issue Card id the synthesizer saw, regardless of
   * how it categorized it. Used to assert provenance — `aggSynthesizeReviews`
   * checks that every pending Issue Card id is accounted for.
   */
  source_issue_card_ids: z.array(z.string().min(1)),
});
export type RevisionSynthesisOutput = z.infer<typeof revisionSynthesisOutputSchema>;
