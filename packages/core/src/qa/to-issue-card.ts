import type { IssueCardSeed } from "../issue-card";
import type { QAFinding } from "./types";

/**
 * Lift a deterministic-QA finding into the shape expected by
 * `createIssueCards`. `source_agent` is fixed to `"deterministic_qa"` so the
 * UI / audit layer can distinguish these from LLM-driven cards.
 *
 * `business_impact` is populated with a short fixed label rather than being
 * left blank — `createIssueCards` validates against a non-empty string
 * (issueCardSchema field is `z.string().min(1)`).
 */
export const DETERMINISTIC_QA_SOURCE_AGENT = "deterministic_qa";

export function convertQAFindingToIssueCard(
  finding: QAFinding,
  project_id: string,
): IssueCardSeed {
  return {
    project_id,
    source_agent: DETERMINISTIC_QA_SOURCE_AGENT,
    severity: finding.severity,
    location: finding.location,
    issue_type: finding.check_id,
    problem: finding.problem,
    why_it_matters: finding.why_it_matters,
    recommended_revision: finding.recommended_revision,
    business_impact: "deterministic check (code-based, no LLM)",
    recommended_action: "revise",
  };
}
