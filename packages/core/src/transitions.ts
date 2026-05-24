import type { WorkflowStatus } from "@contractops/schemas";
import { errors } from "./errors";

const ALLOWED: Record<WorkflowStatus, WorkflowStatus[]> = {
  created: ["sources_uploaded"],
  sources_uploaded: ["source_pack_locked", "sources_uploaded"],
  source_pack_locked: ["type_suggested"],
  type_suggested: ["type_confirmed"],
  type_confirmed: ["playbook_selected"],
  playbook_selected: ["intake_in_progress"],
  intake_in_progress: ["deal_memo_drafted", "intake_in_progress"],
  deal_memo_drafted: ["deal_memo_approved"],
  deal_memo_approved: ["drafting_plan_drafted"],
  drafting_plan_drafted: ["drafting_plan_approved"],
  drafting_plan_approved: ["draft_v0_created"],
  draft_v0_created: ["reviews_in_progress"],
  reviews_in_progress: ["issues_open"],
  issues_open: ["revised", "issues_open"],
  revised: ["final_approved", "reviews_in_progress"],
  final_approved: ["exported"],
  exported: ["exported"],
};

export function assertTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  const next = ALLOWED[from];
  if (!next.includes(to)) {
    throw errors.invalidTransition(from, to);
  }
}

export function isValidTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function advanceStatus(from: WorkflowStatus, to: WorkflowStatus): WorkflowStatus {
  assertTransition(from, to);
  return to;
}
