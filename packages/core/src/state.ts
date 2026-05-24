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
  SourcePack,
} from "@contractops/schemas";

/**
 * ProjectState — aggregate view of all entities for a single project.
 *
 * AuditLog is intentionally NOT a field here. AuditLog is append-only and
 * lives in an `AppendOnlyRepository<AuditLog>` outside this aggregate.
 * Embedding it would invite mutation by callers; keeping it external makes
 * the append-only invariant enforceable at the storage layer.
 */
export interface ProjectState {
  project: Project;
  source_pack: SourcePack;
  source_documents: SourceDocument[];
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
}

export function emptyProjectState(
  project: Project,
  source_pack: SourcePack,
): ProjectState {
  return {
    project,
    source_pack,
    source_documents: [],
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
  };
}
