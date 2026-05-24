import type {
  Actor,
  AuditLog,
  DealMemo,
  DraftingPlan,
  Playbook,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface CreateDraftingPlanInput {
  project_id: string;
  content: string;
  playbook: Playbook;
  env: Env;
}

export function createDraftingPlan(input: CreateDraftingPlanInput): DraftingPlan {
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    content: input.content,
    is_custom: input.playbook.is_custom_marker,
    approved: false,
    approved_by: null,
    approved_by_role: null,
    approved_at: null,
  };
}

export interface ApproveDraftingPlanInput {
  plan: DraftingPlan;
  deal_memo: DealMemo;
  approved_by: Actor;
  env: Env;
}

export interface ApproveDraftingPlanResult {
  plan: DraftingPlan;
  audit: AuditLog;
}

export function approveDraftingPlan(input: ApproveDraftingPlanInput): ApproveDraftingPlanResult {
  if (input.approved_by.role !== "human_lawyer") {
    throw errors.notHumanLawyer();
  }
  if (!input.deal_memo.approved) {
    throw errors.dealMemoNotApproved();
  }
  const now = input.env.now();
  const updated: DraftingPlan = {
    ...input.plan,
    approved: true,
    approved_by: input.approved_by.id,
    approved_by_role: input.approved_by.role,
    approved_at: now,
  };
  const audit = createAuditLog({
    project_id: input.plan.project_id,
    actor: input.approved_by,
    event_type: "drafting_plan_approved",
    ref_id: updated.id,
    payload: { is_custom: input.plan.is_custom },
    env: input.env,
  });
  return { plan: updated, audit };
}
