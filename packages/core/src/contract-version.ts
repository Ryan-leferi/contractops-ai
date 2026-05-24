import type {
  Actor,
  AuditLog,
  ContractVersion,
  DealMemo,
  DraftingPlan,
  Playbook,
  SourcePack,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface CreateDraftVersionInput {
  project_id: string;
  source_pack: SourcePack;
  playbook: Playbook;
  deal_memo: DealMemo;
  drafting_plan: DraftingPlan;
  content: string;
  created_by_agent?: string;
  env: Env;
}

export function createDraftVersion(input: CreateDraftVersionInput): ContractVersion {
  if (!input.source_pack.id) {
    throw errors.missingSourcePackId();
  }
  if (!input.playbook.id) {
    throw errors.missingPlaybookId();
  }
  if (!input.deal_memo.approved) {
    throw errors.dealMemoNotApproved();
  }
  if (!input.drafting_plan.approved) {
    if (input.drafting_plan.is_custom) {
      throw errors.customDraftingPlanRequired();
    }
    throw errors.draftingPlanNotApproved();
  }

  return {
    id: input.env.newId(),
    project_id: input.project_id,
    source_pack_id: input.source_pack.id,
    playbook_id: input.playbook.id,
    version_number: "v0",
    content: input.content,
    created_by_agent: input.created_by_agent ?? "mock_drafter",
    created_at: input.env.now(),
    final: false,
    final_approved_by: null,
    final_approved_by_role: null,
    final_approved_at: null,
  };
}

export interface ApproveFinalVersionInput {
  version: ContractVersion;
  approved_by: Actor;
  env: Env;
}

export interface ApproveFinalVersionResult {
  version: ContractVersion;
  audit: AuditLog;
}

export function approveFinalVersion(input: ApproveFinalVersionInput): ApproveFinalVersionResult {
  if (input.approved_by.role !== "human_lawyer") {
    throw errors.notHumanLawyer();
  }
  const now = input.env.now();
  const updated: ContractVersion = {
    ...input.version,
    final: true,
    final_approved_by: input.approved_by.id,
    final_approved_by_role: input.approved_by.role,
    final_approved_at: now,
  };
  const audit = createAuditLog({
    project_id: input.version.project_id,
    actor: input.approved_by,
    event_type: "final_approved",
    ref_id: updated.id,
    payload: { version_number: updated.version_number },
    env: input.env,
  });
  return { version: updated, audit };
}
