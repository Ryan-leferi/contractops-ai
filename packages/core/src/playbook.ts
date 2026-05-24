import type { Actor, AuditLog, ContractType, Playbook } from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface SelectPlaybookInput {
  contract_type: ContractType;
  available_playbooks: Playbook[];
  selector: Actor;
  env: Env;
}

export interface SelectPlaybookResult {
  playbook: Playbook;
  audit: AuditLog;
}

export function selectPlaybook(input: SelectPlaybookInput): SelectPlaybookResult {
  if (!input.contract_type.is_confirmed || !input.contract_type.confirmed_type) {
    throw errors.contractTypeNotConfirmed();
  }
  const confirmed = input.contract_type.confirmed_type;

  const direct = input.available_playbooks.find(
    (p) => !p.is_custom_marker && p.contract_type === confirmed,
  );

  let chosen = direct;
  if (!chosen) {
    chosen = input.available_playbooks.find((p) => p.is_custom_marker);
  }
  if (!chosen) {
    throw errors.playbookNotFound(confirmed);
  }

  const audit = createAuditLog({
    project_id: input.contract_type.project_id,
    actor: input.selector,
    event_type: "playbook_confirmed",
    ref_id: chosen.id,
    payload: {
      contract_type: confirmed,
      playbook_id: chosen.id,
      is_custom: chosen.is_custom_marker,
    },
    env: input.env,
  });

  return { playbook: chosen, audit };
}

export interface CreateCustomPlaybookDraftInput {
  contract_type_label: string;
  env: Env;
}

export function createCustomPlaybookDraft(
  input: CreateCustomPlaybookDraftInput,
): Playbook {
  return {
    id: input.env.newId(),
    contract_type: input.contract_type_label,
    contract_family: "custom",
    legal_characterization: "unspecified; to be defined per project by a human lawyer",
    required_intake_questions: [],
    optional_intake_questions: [],
    default_table_of_contents: [],
    mandatory_clauses: [],
    optional_clauses: [],
    common_risks: [],
    red_flags: [],
    source_document_expectations: [],
    drafting_style_notes: [],
    negotiation_positions: [],
    fallback_clauses: [],
    final_qa_checklist: [],
    is_custom_marker: true,
  };
}
