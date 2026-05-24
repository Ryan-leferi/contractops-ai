export class WorkflowError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
  }
}

export const errors = {
  contractTypeNotConfirmed: (): WorkflowError =>
    new WorkflowError(
      "Contract type must be confirmed before Playbook selection",
      "CONTRACT_TYPE_NOT_CONFIRMED",
    ),
  playbookNotFound: (type: string): WorkflowError =>
    new WorkflowError(
      `No Playbook found for contract type "${type}" and no Custom Contract fallback available`,
      "PLAYBOOK_NOT_FOUND",
    ),
  customDraftingPlanRequired: (): WorkflowError =>
    new WorkflowError(
      "Custom Contract mode requires a human-approved Drafting Plan before draft generation",
      "CUSTOM_DRAFTING_PLAN_REQUIRED",
    ),
  requiredIntakeMissing: (missingKeys: string[]): WorkflowError =>
    new WorkflowError(
      `Required intake questions not answered: ${missingKeys.join(", ")}`,
      "REQUIRED_INTAKE_MISSING",
    ),
  sourcePackLocked: (): WorkflowError =>
    new WorkflowError(
      "Source Pack is locked; source documents cannot be added or removed",
      "SOURCE_PACK_LOCKED",
    ),
  missingSourcePackId: (): WorkflowError =>
    new WorkflowError(
      "ContractVersion requires source_pack_id",
      "MISSING_SOURCE_PACK_ID",
    ),
  missingPlaybookId: (): WorkflowError =>
    new WorkflowError(
      "ContractVersion requires playbook_id",
      "MISSING_PLAYBOOK_ID",
    ),
  dealMemoNotApproved: (): WorkflowError =>
    new WorkflowError("Deal Memo must be approved", "DEAL_MEMO_NOT_APPROVED"),
  draftingPlanNotApproved: (): WorkflowError =>
    new WorkflowError("Drafting Plan must be approved", "DRAFTING_PLAN_NOT_APPROVED"),
  notHumanLawyer: (): WorkflowError =>
    new WorkflowError("Action requires a human lawyer", "NOT_HUMAN_LAWYER"),
  finalNotApproved: (): WorkflowError =>
    new WorkflowError("Final approval is required before export", "FINAL_NOT_APPROVED"),
  commentaryInCleanExport: (): WorkflowError =>
    new WorkflowError(
      "Internal commentary must not be included in clean export",
      "COMMENTARY_IN_CLEAN_EXPORT",
    ),
  invalidTransition: (from: string, to: string): WorkflowError =>
    new WorkflowError(
      `Invalid workflow transition: ${from} -> ${to}`,
      "INVALID_TRANSITION",
    ),
  partialNoteRequired: (): WorkflowError =>
    new WorkflowError(
      "partial_note is required when decision is partially_accepted",
      "PARTIAL_NOTE_REQUIRED",
    ),
};
