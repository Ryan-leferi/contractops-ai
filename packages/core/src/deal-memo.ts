import type {
  Actor,
  AuditLog,
  DealMemo,
  IntakeAnswer,
  IntakeQuestion,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";
import { validateRequiredIntakeAnswers } from "./intake";

export interface CreateDealMemoInput {
  project_id: string;
  content: string;
  env: Env;
}

export function createDealMemo(input: CreateDealMemoInput): DealMemo {
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    content: input.content,
    approved: false,
    approved_by: null,
    approved_by_role: null,
    approved_at: null,
  };
}

export interface ApproveDealMemoInput {
  deal_memo: DealMemo;
  approved_by: Actor;
  required_questions: IntakeQuestion[];
  answers: IntakeAnswer[];
  env: Env;
}

export interface ApproveDealMemoResult {
  deal_memo: DealMemo;
  audit: AuditLog;
}

export function approveDealMemo(input: ApproveDealMemoInput): ApproveDealMemoResult {
  if (input.approved_by.role !== "human_lawyer") {
    throw errors.notHumanLawyer();
  }
  const check = validateRequiredIntakeAnswers({
    required_questions: input.required_questions,
    answers: input.answers,
  });
  if (!check.ok) {
    throw errors.requiredIntakeMissing(check.missing_keys);
  }
  const now = input.env.now();
  const updated: DealMemo = {
    ...input.deal_memo,
    approved: true,
    approved_by: input.approved_by.id,
    approved_by_role: input.approved_by.role,
    approved_at: now,
  };
  const audit = createAuditLog({
    project_id: input.deal_memo.project_id,
    actor: input.approved_by,
    event_type: "deal_memo_approved",
    ref_id: updated.id,
    payload: {},
    env: input.env,
  });
  return { deal_memo: updated, audit };
}
