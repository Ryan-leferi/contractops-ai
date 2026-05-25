/**
 * Server-side in-memory project store (Milestone 3D).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NOT FOR PRODUCTION.                                           │
 *   │   - Resets on every server restart.                            │
 *   │   - No durability, no replication, no auth.                    │
 *   │   - Holds whatever a developer / demo session POSTs into it.   │
 *   │   - Real persistence (PostgreSQL or another durable database)  │
 *   │     is out of scope for this milestone and explicitly forbidden│
 *   │     by the prompt; it will arrive in a later milestone.         │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The store lives on `globalThis` so it survives Next.js dev HMR rebuilds
 * (which re-execute module bodies). It is intentionally not exported as
 * an object — only via the function API below — so client components
 * cannot grab a reference and mutate it accidentally.
 *
 * SERVER ONLY. The SDK isolation test in
 * `packages/core/tests/no-sdk-imports.test.ts` fails the build if any
 * file inside `packages/web/app/projects/**` or `packages/web/components/**`
 * imports this module. Only files under `packages/web/app/api/**` may
 * pull it in.
 */

import * as core from "@contractops/core";
import type {
  Actor,
  AuditLog,
  ExportType,
  IssueDecisionHistoryEntry,
  Playbook,
} from "@contractops/schemas";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { playbookSchema } from "@contractops/schemas";

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

// ─────────────────────────────────────────────────────────────────────
// Singleton state pinned on globalThis so HMR (dev only) does not
// recreate the maps each time a route handler module is re-evaluated.
// In production this is the same as a plain module-level singleton.
// ─────────────────────────────────────────────────────────────────────

interface ServerStoreState {
  projects: Map<string, core.ProjectState>;
  /** Audit log per project — append-only, in insertion order. */
  audits: Map<string, AuditLog[]>;
}

const GLOBAL_KEY = "__contractops_server_store__";

function loadOrCreate(): ServerStoreState {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as ServerStoreState | undefined;
  if (existing) return existing;
  const fresh: ServerStoreState = {
    projects: new Map(),
    audits: new Map(),
  };
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

function store(): ServerStoreState {
  return loadOrCreate();
}

// ─────────────────────────────────────────────────────────────────────
// Playbook loader (cached for the process lifetime).
// ─────────────────────────────────────────────────────────────────────

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

/**
 * Locate the repo's `playbooks/` directory regardless of who invoked us.
 * Tries (in order):
 *   1. cwd/playbooks       — repo-root invocations (vitest, fixture)
 *   2. cwd/../../playbooks — packages/web invocations (`npm run dev -w @contractops/web`)
 *   3. walking up from this source file until we find one
 *
 * Throws a clear error if none works so configuration mistakes surface
 * early instead of crashing inside the JSON parser.
 */
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
// Read-side API
// ─────────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export function listProjectSummaries(): ProjectSummary[] {
  return Array.from(store().projects.values())
    .sort((a, b) => a.project.created_at.localeCompare(b.project.created_at))
    .map((p) => ({
      id: p.project.id,
      name: p.project.name,
      status: p.project.status,
      created_at: p.project.created_at,
    }));
}

export function getProjectState(id: string): core.ProjectState | null {
  return store().projects.get(id) ?? null;
}

export function getProjectAudits(id: string): AuditLog[] {
  return (store().audits.get(id) ?? []).slice();
}

export function getProjectDecisionHistory(id: string): IssueDecisionHistoryEntry[] {
  const p = store().projects.get(id);
  return (p?.decision_history ?? []).slice();
}

// ─────────────────────────────────────────────────────────────────────
// Write-side API — every mutation goes through an aggregate op.
// ─────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  state: core.ProjectState;
  audits: AuditLog[];
}

export function createProjectInStore(name: string): ApplyResult {
  ensureServerPromptsLoaded();
  const env = makeServerEnv();
  const res = core.aggCreateProject(
    { name, created_by: getDemoUser() },
    env,
  );
  store().projects.set(res.state.project.id, res.state);
  store().audits.set(res.state.project.id, res.audits.slice());
  return { state: res.state, audits: res.audits };
}

/**
 * Apply a single named operation to a project. The dispatcher below is
 * exhaustive over the `Operation` discriminated union — if a new
 * operation is added to `operations.ts`, TypeScript will fail to
 * compile this function until the new case is wired up.
 */
export async function applyOperationToStore(
  projectId: string,
  op: Operation,
): Promise<ApplyResult> {
  ensureServerPromptsLoaded();
  const current = store().projects.get(projectId);
  if (!current) {
    throw new ProjectNotFoundError(projectId);
  }

  const env = makeServerEnv();
  const lawyer = getDemoLawyer();
  const user = getDemoUser();
  const ctx = buildServerAggregateContext(current);

  const result = await dispatch(current, op, env, lawyer, user, ctx);

  // Persist new state and append audits.
  store().projects.set(projectId, result.state);
  const existingAudits = store().audits.get(projectId) ?? [];
  store().audits.set(projectId, [...existingAudits, ...result.audits]);

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
// Dev-only utilities
// ─────────────────────────────────────────────────────────────────────

/**
 * Drop every project and every audit log. Used by the dev/demo
 * `/api/projects/reset` route. Production callers should be blocked at
 * the route layer — see `app/api/projects/reset/route.ts`.
 */
export function resetStore(): void {
  store().projects.clear();
  store().audits.clear();
}

// Exported for tests that want to introspect store size.
export function debugStoreSizes(): { projects: number; auditedProjects: number; totalAudits: number } {
  const s = store();
  return {
    projects: s.projects.size,
    auditedProjects: s.audits.size,
    totalAudits: Array.from(s.audits.values()).reduce((n, arr) => n + arr.length, 0),
  };
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
 * before handing it to `applyOperationToStore`. Returns the typed
 * operation or throws.
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
  // Args validation happens inside the core aggregate calls, which
  // already throw clear errors. We only need to ensure args is an
  // object here.
  if (typeof args !== "object" || args === null) {
    throw new Error(`operation '${name}' args must be an object`);
  }
  return { name, args } as Operation;
}

// Type-export the loadPlaybooks shape so the operations route can
// inspect cache state in tests without re-implementing the loader.
export { loadPlaybooks as __loadPlaybooks_for_tests };

// Re-export ExportType so route handlers can validate without a deep import.
export type { ExportType };
