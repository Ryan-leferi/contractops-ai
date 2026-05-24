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
