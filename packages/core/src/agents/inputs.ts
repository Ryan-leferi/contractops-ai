import type {
  ContractVersion,
  IntakeAnswer,
  IntakeQuestion,
  IssueCard,
  Playbook,
  SourceDocument,
  SourceDocumentContent,
} from "@contractops/schemas";

/**
 * Inputs for each role agent. Kept generic — every field is a typed entity
 * from `@contractops/schemas`. Contract-type names never appear in these
 * shapes (they live inside Playbook fields).
 */

export interface DealMemoDrafterInput {
  project_id: string;
  playbook: Playbook;
  source_documents: SourceDocument[];
  source_contents: SourceDocumentContent[];
  intake_questions: IntakeQuestion[];
  intake_answers: IntakeAnswer[];
}

export interface DraftingPlanDrafterInput {
  project_id: string;
  playbook: Playbook;
  intake_questions: IntakeQuestion[];
  intake_answers: IntakeAnswer[];
}

export interface ContractDrafterInput {
  project_id: string;
  playbook: Playbook;
  drafting_plan_content: string;
  source_documents: SourceDocument[];
  source_contents: SourceDocumentContent[];
  intake_answers: IntakeAnswer[];
}

export interface ReviewerInput {
  project_id: string;
  playbook: Playbook;
  draft: ContractVersion;
  source_documents: SourceDocument[];
  source_contents: SourceDocumentContent[];
}

export interface RevisionAgentInput {
  project_id: string;
  playbook: Playbook;
  previous_version: ContractVersion;
  accepted_issue_cards: IssueCard[];
}

export interface FinalQAAssistantInput {
  project_id: string;
  playbook: Playbook;
  version: ContractVersion;
}

/**
 * Pilot P1 — input for the `review_synthesizer` role agent. The role
 * receives:
 *
 *   - the current draft (target of the upcoming revision);
 *   - the pending Issue Cards from this iteration's reviewer round
 *     (cards already decided are NOT passed in — the human-lawyer's
 *     existing decisions are not subject to synthesis);
 *   - the Playbook (so the synthesizer can drop findings that
 *     contradict mandatory clauses);
 *   - a flat 1-line iteration descriptor (so the prompt has stable
 *     framing across iterations).
 *
 * The synthesizer is forbidden from mutating contract content — its
 * output is a structured instruction package consumed by the next
 * `revision_agent` run. This boundary is enforced by the aggregate op
 * (`aggSynthesizeReviews` only appends to `agent_runs` and updates the
 * iteration record; it does not touch `contract_versions`).
 */
export interface ReviewSynthesizerInput {
  project_id: string;
  iteration_number: number;
  playbook: Playbook;
  draft: ContractVersion;
  pending_issue_cards: IssueCard[];
}
