/**
 * Server-side project store façade (Milestones 3D + 3E).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Storage backend is now pluggable via `PersistenceAdapter`.    │
 *   │   - memory  (default; CI + mock-mode dev)                     │
 *   │   - file    (PERSISTENCE_DRIVER=file; durable local dev only) │
 *   │                                                               │
 *   │ Both are NON-PRODUCTION. Real PostgreSQL persistence lands    │
 *   │ in a future milestone behind the same adapter interface.      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * SERVER ONLY. Importing this from a client component is caught by the
 * SDK isolation test in `packages/core/tests/no-sdk-imports.test.ts`.
 */

import { randomUUID } from "node:crypto";
import * as core from "@contractops/core";
import type {
  Actor,
  AuditLog,
  ExportType,
  IssueDecisionHistoryEntry,
  ProjectMembership,
  ProjectRole,
} from "@contractops/schemas";
import { isLawyerProjectRole } from "@contractops/schemas";

import {
  buildServerAggregateContext,
  getDefaultLawyer,
  makeServerEnv,
} from "./server-aggregate-context";
import type { Operation } from "./operations";
import { isKnownOperationName } from "./operations";
// Side-effect import: registers every `prompts/*.md` template with core
// so the server-side aggregate ops can render LLM prompts. Idempotent
// across multiple imports.
import { ensureServerPromptsLoaded } from "./preload-server-prompts";
import {
  selectPersistenceAdapter,
  type PersistenceAdapter,
  type ProjectSummary,
} from "./persistence";

// ─────────────────────────────────────────────────────────────────────
// Adapter resolution — the only place that touches the persistence
// boundary directly. Every other public function here goes through
// `adapter()` so route handlers cannot accidentally bypass it.
// ─────────────────────────────────────────────────────────────────────

function adapter(): PersistenceAdapter {
  return selectPersistenceAdapter();
}

export type { ProjectSummary } from "./persistence";

// ─────────────────────────────────────────────────────────────────────
// Read-side API
// ─────────────────────────────────────────────────────────────────────

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  return adapter().listProjects();
}

export async function getProjectState(id: string): Promise<core.ProjectState | null> {
  return adapter().getProjectState(id);
}

export async function getProjectAudits(id: string): Promise<AuditLog[]> {
  return adapter().listAuditLogs(id);
}

export async function getProjectDecisionHistory(
  id: string,
): Promise<IssueDecisionHistoryEntry[]> {
  return adapter().listDecisionHistory(id);
}

// ─────────────────────────────────────────────────────────────────────
// Write-side API — every mutation goes through an aggregate op so the
// workflow logic (PLATFORM_BRIEF.md §2 / §5) stays in @contractops/core.
// ─────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  state: core.ProjectState;
  audits: AuditLog[];
}

export async function createProjectInStore(
  name: string,
  actor?: Actor,
): Promise<ApplyResult> {
  ensureServerPromptsLoaded();
  const env = makeServerEnv();
  const createdBy = actor ?? getDefaultLawyer();

  // 3L: project creation requires a human_lawyer actor so the
  // creator can be auto-granted an `owner_lawyer` membership. A
  // non-lawyer creator is refused at boot rather than silently
  // creating an unmanageable project (no one could ever approve
  // anything). The few server-side test callers that pass a
  // business actor are expected to fail; they are updated to use
  // a lawyer explicitly.
  if (createdBy.role !== "human_lawyer") {
    throw new NonLawyerCannotCreateProjectError(createdBy.id);
  }

  const res = core.aggCreateProject({ name, created_by: createdBy }, env);
  const creationAudit = res.audits[0]!;

  // Auto-grant the creator an owner_lawyer membership. The membership
  // lives INSIDE ProjectState (ADR-019) so the persistence adapter's
  // existing `createProject(state, creationAudit)` call covers it
  // atomically — no second write needed.
  const ownerMembership: ProjectMembership = {
    id: `mem_${randomUUID()}`,
    project_id: res.state.project.id,
    actor_id: createdBy.id,
    project_role: "owner_lawyer",
    created_at: res.state.project.created_at,
    created_by: createdBy.id,
    disabled_at: null,
  };
  const stateWithOwner: core.ProjectState = {
    ...res.state,
    memberships: [...(res.state.memberships ?? []), ownerMembership],
  };

  // Membership grant is its own audit row so the audit trail shows
  // "project_created → membership_created" for every project.
  const membershipAudit: AuditLog = {
    id: `au_${randomUUID()}`,
    project_id: stateWithOwner.project.id,
    actor: createdBy.id,
    event_type: "membership_created",
    ref_id: ownerMembership.id,
    timestamp: stateWithOwner.project.created_at,
    payload: {
      actor_id: createdBy.id,
      project_role: "owner_lawyer",
      auto_granted: true,
    },
  };

  await adapter().createProject(stateWithOwner, creationAudit);
  await adapter().appendAuditLog(stateWithOwner.project.id, membershipAudit);

  return {
    state: stateWithOwner,
    audits: [...res.audits, membershipAudit],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Project membership management (Milestone 3L)
// ─────────────────────────────────────────────────────────────────────

export interface AddMembershipInput {
  readonly actor: Actor; // target actor (id + role + display_name)
  readonly project_role: ProjectRole;
}

/**
 * Append a new membership to a project. The route handler has
 * already verified the CALLER's `manage_memberships` permission;
 * this helper enforces the global-role↔project-role invariant
 * (lawyer roles require human_lawyer actors) and rejects duplicate
 * active memberships.
 *
 * Returns the persisted membership + the audit entry, so the route
 * can echo both to the client.
 */
export async function addMembershipToProject(
  projectId: string,
  input: AddMembershipInput,
  grantedBy: Actor,
): Promise<{ membership: ProjectMembership; audit: AuditLog }> {
  const a = adapter();
  const current = await a.getProjectState(projectId);
  if (!current) throw new ProjectNotFoundError(projectId);

  // Lawyer project_roles require a human_lawyer global role.
  if (isLawyerProjectRole(input.project_role) && input.actor.role !== "human_lawyer") {
    throw new ProjectRoleRequiresLawyerError(input.actor.id, input.project_role);
  }

  // Reject duplicate active membership for the same actor.
  const existing = (current.memberships ?? []).find(
    (m) => m.actor_id === input.actor.id && m.disabled_at === null,
  );
  if (existing) {
    throw new ActorAlreadyMemberError(projectId, input.actor.id);
  }

  const now = new Date().toISOString();
  const membership: ProjectMembership = {
    id: `mem_${randomUUID()}`,
    project_id: projectId,
    actor_id: input.actor.id,
    project_role: input.project_role,
    created_at: now,
    created_by: grantedBy.id,
    disabled_at: null,
  };
  const next: core.ProjectState = {
    ...current,
    memberships: [...(current.memberships ?? []), membership],
  };

  const audit: AuditLog = {
    id: `au_${randomUUID()}`,
    project_id: projectId,
    actor: grantedBy.id,
    event_type: "membership_created",
    ref_id: membership.id,
    timestamp: now,
    payload: {
      actor_id: input.actor.id,
      project_role: input.project_role,
      auto_granted: false,
    },
  };

  await a.saveProjectState(next);
  await a.appendAuditLog(projectId, audit);
  return { membership, audit };
}

/**
 * Mark a membership as disabled (soft-delete). The route handler
 * has already verified the CALLER's `manage_memberships` permission;
 * this helper additionally REFUSES to disable the LAST active
 * `owner_lawyer` of a project — that would leave it unmanageable.
 *
 * Returns the now-disabled membership + audit row.
 */
export async function disableMembershipInProject(
  projectId: string,
  membershipId: string,
  disabledBy: Actor,
): Promise<{ membership: ProjectMembership; audit: AuditLog }> {
  const a = adapter();
  const current = await a.getProjectState(projectId);
  if (!current) throw new ProjectNotFoundError(projectId);

  const target = (current.memberships ?? []).find((m) => m.id === membershipId);
  if (!target) throw new MembershipNotFoundError(projectId, membershipId);
  if (target.disabled_at !== null) {
    // Idempotent — return the same row.
    return {
      membership: target,
      audit: {
        id: `au_${randomUUID()}`,
        project_id: projectId,
        actor: disabledBy.id,
        event_type: "membership_disabled",
        ref_id: target.id,
        timestamp: new Date().toISOString(),
        payload: { actor_id: target.actor_id, idempotent: true },
      },
    };
  }

  // Refuse to remove the last active owner_lawyer.
  if (target.project_role === "owner_lawyer") {
    const remainingOwners = (current.memberships ?? []).filter(
      (m) =>
        m.project_role === "owner_lawyer" &&
        m.disabled_at === null &&
        m.id !== membershipId,
    );
    if (remainingOwners.length === 0) {
      throw new CannotRemoveLastOwnerError(projectId, membershipId);
    }
  }

  const now = new Date().toISOString();
  const disabled: ProjectMembership = { ...target, disabled_at: now };
  const next: core.ProjectState = {
    ...current,
    memberships: (current.memberships ?? []).map((m) =>
      m.id === membershipId ? disabled : m,
    ),
  };
  const audit: AuditLog = {
    id: `au_${randomUUID()}`,
    project_id: projectId,
    actor: disabledBy.id,
    event_type: "membership_disabled",
    ref_id: disabled.id,
    timestamp: now,
    payload: {
      actor_id: disabled.actor_id,
      project_role: disabled.project_role,
    },
  };

  await a.saveProjectState(next);
  await a.appendAuditLog(projectId, audit);
  return { membership: disabled, audit };
}

/**
 * Apply a single named operation. The dispatcher below is exhaustive
 * over the `Operation` discriminated union — if a new op is added to
 * `operations.ts`, TypeScript fails to compile this file until wired.
 */
export async function applyOperationToStore(
  projectId: string,
  op: Operation,
  actor?: Actor,
): Promise<ApplyResult> {
  ensureServerPromptsLoaded();
  const a = adapter();
  const current = await a.getProjectState(projectId);
  if (!current) {
    throw new ProjectNotFoundError(projectId);
  }

  const env = makeServerEnv();
  // Single resolved actor flows into both the dispatcher and the
  // AggregateContext. Lawyer-only ops still throw inside core when the
  // resolved actor is not a human_lawyer (e.g. `business_choi` trying
  // to approve a Deal Memo).
  const effectiveActor: Actor = actor ?? getDefaultLawyer();
  const ctx = buildServerAggregateContext(current, effectiveActor);

  const result = await dispatch(current, op, env, effectiveActor, ctx);

  // Persist the new ProjectState snapshot first so a subsequent read
  // sees the latest state even if an append below fails. The append-only
  // journals are the formal audit trail; the snapshot is convenience.
  await a.saveProjectState(result.state);

  // Then append the new audit rows emitted by this op (zero or more).
  for (const audit of result.audits) {
    await a.appendAuditLog(projectId, audit);
  }

  // And append the new decision_history rows. Today only
  // `aggDecideIssue` appends to `state.decision_history`, so the diff is
  // at most one row, but compute it generically to stay forward-compatible.
  const previousLen = current.decision_history.length;
  const newHistory = result.state.decision_history.slice(previousLen);
  for (const entry of newHistory) {
    await a.appendDecisionHistory(projectId, entry);
  }

  return { state: result.state, audits: result.audits };
}

async function dispatch(
  state: core.ProjectState,
  op: Operation,
  env: core.Env,
  actor: Actor,
  ctx: core.AggregateContext,
): Promise<core.AggregateResult> {
  // The single resolved actor flows into every op. Ops that need a
  // human_lawyer enforce it inside @contractops/core; ops that accept
  // any role (add_source, add_source_content, answer_intake, create_export)
  // happily take a non-lawyer actor.
  switch (op.name) {
    case "add_source":
      return core.aggAddSource(state, { ...op.args, uploaded_by: actor }, env);
    case "add_source_content":
      return core.aggAddSourceContent(
        state,
        {
          source_document_id: op.args.source_document_id,
          text_content: op.args.text_content,
          language: op.args.language ?? null,
          is_synthetic: true,
        },
        env,
      );
    case "lock_source_pack":
      return core.aggLockSourcePack(state, actor, env);
    case "classify_and_confirm":
      return core.aggClassifyAndConfirm(
        state,
        { ...op.args, confirmed_by: actor },
        env,
      );
    case "select_playbook":
      return core.aggSelectPlaybook(
        state,
        { available_playbooks: loadPlaybooks(), selector: actor },
        env,
      );
    case "answer_intake":
      return core.aggAnswerIntake(
        state,
        { ...op.args, answered_by: actor },
        env,
      );
    case "draft_deal_memo":
      return core.aggDraftDealMemo(state, ctx);
    case "approve_deal_memo":
      return core.aggApproveDealMemo(state, actor, env);
    case "draft_drafting_plan":
      return core.aggDraftDraftingPlan(state, ctx);
    case "approve_drafting_plan":
      return core.aggApproveDraftingPlan(state, actor, env);
    case "create_v0":
      return core.aggCreateV0(state, ctx);
    case "run_mock_reviews":
      return core.aggRunMockReviews(state, ctx);
    case "decide_issue":
      return core.aggDecideIssue(
        state,
        {
          issue_id: op.args.issue_id,
          decision: op.args.decision,
          partial_note: op.args.partial_note,
          reason_note: op.args.reason_note,
          decided_by: actor,
        },
        env,
      );
    case "run_mock_final_qa":
      return core.aggRunMockFinalQA(state, ctx);
    case "create_revision":
      return core.aggCreateRevision(state, ctx);
    case "approve_final":
      return core.aggApproveFinal(state, actor, env);
    case "create_export":
      return core.aggCreateExport(
        state,
        { ...op.args, created_by: actor },
        env,
      );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Playbook loader (cached for the process lifetime).
// ─────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Playbook, playbookSchema } from "@contractops/schemas";

let cachedPlaybooks: Playbook[] | null = null;
function loadPlaybooks(): Playbook[] {
  if (cachedPlaybooks) return cachedPlaybooks;
  const dir = findPlaybooksDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const list = files.map((f) =>
    playbookSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf-8"))),
  );
  cachedPlaybooks = list;
  return list;
}

function findPlaybooksDir(): string {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "playbooks"),
    join(cwd, "..", "..", "playbooks"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "playbooks");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    `playbooks/ directory not found. Tried cwd=${cwd} and ${candidates.length} fallback paths.`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dev-only utilities
// ─────────────────────────────────────────────────────────────────────

export async function resetStore(): Promise<void> {
  await adapter().resetDemoStore();
}

/** Debug-only: project count + total audits. Used by tests. */
export async function debugStoreSizes(): Promise<{
  projects: number;
  totalAudits: number;
  totalHistory: number;
}> {
  const list = await adapter().listProjects();
  let totalAudits = 0;
  let totalHistory = 0;
  for (const p of list) {
    totalAudits += (await adapter().listAuditLogs(p.id)).length;
    totalHistory += (await adapter().listDecisionHistory(p.id)).length;
  }
  return { projects: list.length, totalAudits, totalHistory };
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

export class ProjectNotFoundError extends Error {
  readonly code = "PROJECT_NOT_FOUND";
  constructor(id: string) {
    super(`project not found: ${id}`);
  }
}

export class UnknownOperationError extends Error {
  readonly code = "UNKNOWN_OPERATION";
  constructor(name: unknown) {
    super(`unknown operation name: ${JSON.stringify(name)}`);
  }
}

// ── Milestone 3L errors ───────────────────────────────────────────────

export class NonLawyerCannotCreateProjectError extends Error {
  readonly code = "NON_LAWYER_CANNOT_CREATE_PROJECT";
  constructor(public readonly actor_id: string) {
    super(
      `actor "${actor_id}" cannot create a project: only human_lawyer actors ` +
        `may create projects (the creator becomes owner_lawyer). Business ` +
        `actors should be added to an existing project by an owner.`,
    );
  }
}

export class ActorAlreadyMemberError extends Error {
  readonly code = "ACTOR_ALREADY_MEMBER";
  constructor(public readonly project_id: string, public readonly actor_id: string) {
    super(
      `actor "${actor_id}" already has an active membership in project "${project_id}"`,
    );
  }
}

export class ProjectRoleRequiresLawyerError extends Error {
  readonly code = "PROJECT_ROLE_REQUIRES_LAWYER";
  constructor(
    public readonly actor_id: string,
    public readonly project_role: string,
  ) {
    super(
      `actor "${actor_id}" cannot be granted project_role "${project_role}": ` +
        `that role requires Actor.role === "human_lawyer".`,
    );
  }
}

export class MembershipNotFoundError extends Error {
  readonly code = "MEMBERSHIP_NOT_FOUND";
  constructor(public readonly project_id: string, public readonly membership_id: string) {
    super(`membership "${membership_id}" not found in project "${project_id}"`);
  }
}

export class CannotRemoveLastOwnerError extends Error {
  readonly code = "CANNOT_REMOVE_LAST_OWNER";
  constructor(public readonly project_id: string, public readonly membership_id: string) {
    super(
      `cannot disable membership "${membership_id}": it is the last active ` +
        `owner_lawyer of project "${project_id}". Add another owner first.`,
    );
  }
}

/**
 * Helper used by the operations route to validate the posted body
 * before handing it to `applyOperationToStore`.
 */
export function parseOperationOrThrow(raw: unknown): Operation {
  if (typeof raw !== "object" || raw === null) {
    throw new UnknownOperationError(raw);
  }
  const name = (raw as { name?: unknown }).name;
  const args = (raw as { args?: unknown }).args ?? {};
  if (!isKnownOperationName(name)) {
    throw new UnknownOperationError(name);
  }
  if (typeof args !== "object" || args === null) {
    throw new Error(`operation '${name}' args must be an object`);
  }
  return { name, args } as Operation;
}

// Re-export ExportType so route handlers can validate without a deep import.
export type { ExportType };
