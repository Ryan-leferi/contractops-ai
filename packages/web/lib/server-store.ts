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

import * as core from "@contractops/core";
import type {
  Actor,
  AuditLog,
  ExportType,
  IssueDecisionHistoryEntry,
} from "@contractops/schemas";

import {
  buildServerAggregateContext,
  getDemoLawyer,
  getDemoUser,
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

export async function createProjectInStore(name: string): Promise<ApplyResult> {
  ensureServerPromptsLoaded();
  const env = makeServerEnv();
  const res = core.aggCreateProject({ name, created_by: getDemoUser() }, env);
  const creationAudit = res.audits[0]!;
  await adapter().createProject(res.state, creationAudit);
  return { state: res.state, audits: res.audits };
}

/**
 * Apply a single named operation. The dispatcher below is exhaustive
 * over the `Operation` discriminated union — if a new op is added to
 * `operations.ts`, TypeScript fails to compile this file until wired.
 */
export async function applyOperationToStore(
  projectId: string,
  op: Operation,
): Promise<ApplyResult> {
  ensureServerPromptsLoaded();
  const a = adapter();
  const current = await a.getProjectState(projectId);
  if (!current) {
    throw new ProjectNotFoundError(projectId);
  }

  const env = makeServerEnv();
  const lawyer = getDemoLawyer();
  const user = getDemoUser();
  const ctx = buildServerAggregateContext(current);

  const result = await dispatch(current, op, env, lawyer, user, ctx);

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
  lawyer: Actor,
  user: Actor,
  ctx: core.AggregateContext,
): Promise<core.AggregateResult> {
  switch (op.name) {
    case "add_source":
      return core.aggAddSource(state, { ...op.args, uploaded_by: user }, env);
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
      return core.aggLockSourcePack(state, lawyer, env);
    case "classify_and_confirm":
      return core.aggClassifyAndConfirm(
        state,
        { ...op.args, confirmed_by: lawyer },
        env,
      );
    case "select_playbook":
      return core.aggSelectPlaybook(
        state,
        { available_playbooks: loadPlaybooks(), selector: lawyer },
        env,
      );
    case "answer_intake":
      return core.aggAnswerIntake(
        state,
        { ...op.args, answered_by: user },
        env,
      );
    case "draft_deal_memo":
      return core.aggDraftDealMemo(state, ctx);
    case "approve_deal_memo":
      return core.aggApproveDealMemo(state, lawyer, env);
    case "draft_drafting_plan":
      return core.aggDraftDraftingPlan(state, ctx);
    case "approve_drafting_plan":
      return core.aggApproveDraftingPlan(state, lawyer, env);
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
          decided_by: lawyer,
        },
        env,
      );
    case "run_mock_final_qa":
      return core.aggRunMockFinalQA(state, ctx);
    case "create_revision":
      return core.aggCreateRevision(state, ctx);
    case "approve_final":
      return core.aggApproveFinal(state, lawyer, env);
    case "create_export":
      return core.aggCreateExport(
        state,
        { ...op.args, created_by: lawyer },
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
