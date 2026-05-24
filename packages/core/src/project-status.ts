import type { Project, WorkflowStatus } from "@contractops/schemas";
import { errors } from "./errors";
import { assertTransition } from "./transitions";

/**
 * Linear ordering used by `assertStatusAtLeast`. The actual transition graph
 * (which can have repeats and small back-edges) lives in `transitions.ts`.
 * This array reflects the canonical forward progression and is the basis for
 * "must be at or past stage X" guards.
 */
export const STATUS_ORDER: readonly WorkflowStatus[] = [
  "created",
  "sources_uploaded",
  "source_pack_locked",
  "type_suggested",
  "type_confirmed",
  "playbook_selected",
  "intake_in_progress",
  "deal_memo_drafted",
  "deal_memo_approved",
  "drafting_plan_drafted",
  "drafting_plan_approved",
  "draft_v0_created",
  "reviews_in_progress",
  "issues_open",
  "revised",
  "final_approved",
  "exported",
] as const;

const STATUS_INDEX: Record<WorkflowStatus, number> = (() => {
  const map = {} as Record<WorkflowStatus, number>;
  STATUS_ORDER.forEach((s, i) => {
    map[s] = i;
  });
  return map;
})();

export function statusRank(status: WorkflowStatus): number {
  return STATUS_INDEX[status];
}

export function assertStatusAtLeast(
  actual: WorkflowStatus,
  required: WorkflowStatus,
): void {
  if (STATUS_INDEX[actual] < STATUS_INDEX[required]) {
    throw errors.invalidTransition(actual, `>= ${required}`);
  }
}

export function assertStatusOneOf(
  actual: WorkflowStatus,
  allowed: readonly WorkflowStatus[],
): void {
  if (!allowed.includes(actual)) {
    throw errors.invalidTransition(actual, allowed.join(" | "));
  }
}

/**
 * Advance the project's status to `target` if it is not already at or past it.
 * Idempotent — if the project is already at `target` or beyond, returns the
 * project unchanged. Otherwise asserts the transition is legal and bumps it.
 */
export function withStatus(project: Project, target: WorkflowStatus): Project {
  if (STATUS_INDEX[project.status] >= STATUS_INDEX[target]) {
    return project;
  }
  assertTransition(project.status, target);
  return { ...project, status: target };
}
