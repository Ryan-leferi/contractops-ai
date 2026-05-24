import type {
  AgentRun,
  ContractType,
  ContractVersion,
  DealMemo,
  DraftingPlan,
  ExportFile,
  IntakeAnswer,
  IntakeQuestion,
  IssueCard,
  Playbook,
  Project,
  SourceDocument,
  SourceDocumentContent,
  SourcePack,
} from "@contractops/schemas";
import type { DeterministicQAResult } from "./qa/types";

/**
 * ProjectState — aggregate view of all entities for a single project.
 *
 * `source_contents` is keyed by `source_document_id`. The list is data
 * only — the canonical SourceDocument metadata lives in `source_documents`.
 * Two separate fields, two separate concerns. (PLATFORM_BRIEF.md §9, §10.)
 *
 * AuditLog is intentionally NOT a field here — it is append-only and lives
 * in a separate AppendOnlyRepository.
 */
export interface ProjectState {
  project: Project;
  source_pack: SourcePack;
  source_documents: SourceDocument[];
  source_contents: SourceDocumentContent[];
  contract_type: ContractType | null;
  playbook: Playbook | null;
  intake_questions: IntakeQuestion[];
  intake_answers: IntakeAnswer[];
  deal_memo: DealMemo | null;
  drafting_plan: DraftingPlan | null;
  contract_versions: ContractVersion[];
  issue_cards: IssueCard[];
  agent_runs: AgentRun[];
  exports: ExportFile[];
  /**
   * History of deterministic-QA runs (Milestone 2E). Each entry corresponds
   * to one `aggRunDeterministicQA` invocation. Persists with the rest of
   * ProjectState (localStorage round-trip safe — pure JSON).
   */
  qa_runs: DeterministicQAResult[];
}

export function emptyProjectState(
  project: Project,
  source_pack: SourcePack,
): ProjectState {
  return {
    project,
    source_pack,
    source_documents: [],
    source_contents: [],
    contract_type: null,
    playbook: null,
    intake_questions: [],
    intake_answers: [],
    deal_memo: null,
    drafting_plan: null,
    contract_versions: [],
    issue_cards: [],
    agent_runs: [],
    exports: [],
    qa_runs: [],
  };
}
