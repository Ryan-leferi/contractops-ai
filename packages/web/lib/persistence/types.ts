/**
 * Persistence adapter interface (Milestone 3E).
 *
 * Sits BEHIND `lib/server-store.ts` so the rest of the app (API routes,
 * aggregate ops, the UI) never knows which storage engine is in use. The
 * default is the in-memory adapter shipped with 3D; a file-backed
 * durable adapter is the second implementation.
 *
 * Append-only contract — adapters MUST enforce:
 *
 *   - `appendAuditLog(entry)` throws if `entry.id` already exists for the
 *     project. Existing entries cannot be modified or removed.
 *   - `appendDecisionHistory(entry)` throws if `entry.id` already exists
 *     for the project. Existing entries cannot be modified or removed.
 *
 * `saveProjectState` overwrites the ProjectState blob; the workflow code
 * (`@contractops/core`) only ever extends the `decision_history` field on
 * ProjectState, so the JSONL journal stays the canonical append-only
 * proof and the ProjectState blob is the latest-snapshot mirror.
 *
 * No adapter stores binary export artifacts. ExportFile.content is a
 * text summary blurb (PLATFORM_BRIEF.md §10 / Milestone 3A).
 */
import type * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

export interface PersistenceAdapter {
  /** Identifier surfaced in logs and error messages. */
  readonly driver: "memory" | "file";

  /** Return every project the adapter knows about, oldest first. */
  listProjects(): Promise<ProjectSummary[]>;

  /** Return the full ProjectState blob, or null if unknown. */
  getProjectState(id: string): Promise<core.ProjectState | null>;

  /**
   * Persist the latest ProjectState blob, overwriting any previous copy
   * for the same `state.project.id`. Workflow guarantees (no entry ever
   * removed from `decision_history`) are enforced at the aggregate layer.
   */
  saveProjectState(state: core.ProjectState): Promise<void>;

  /**
   * Atomic convenience used by project creation. Equivalent to
   * `saveProjectState(state) + appendAuditLog(creationAudit)` but exposed
   * as a single call so a future SQL-backed adapter can run it in a
   * single transaction.
   */
  createProject(state: core.ProjectState, creationAudit: AuditLog): Promise<void>;

  /**
   * Append a new audit log entry. Throws `AppendOnlyViolationError` if an
   * entry with the same `id` already exists for `projectId`.
   */
  appendAuditLog(projectId: string, entry: AuditLog): Promise<void>;

  /** Return every audit log entry for the project, oldest first. */
  listAuditLogs(projectId: string): Promise<AuditLog[]>;

  /**
   * Append a new decision history entry. Throws `AppendOnlyViolationError`
   * if an entry with the same `id` already exists for `projectId`.
   */
  appendDecisionHistory(projectId: string, entry: IssueDecisionHistoryEntry): Promise<void>;

  /** Return every decision history entry for the project, oldest first. */
  listDecisionHistory(projectId: string): Promise<IssueDecisionHistoryEntry[]>;

  /**
   * Drop every project, audit log and decision history entry. DEV / DEMO
   * only — `/api/projects/reset` gates the production case behind
   * `ALLOW_SERVER_STORE_RESET=true`.
   */
  resetDemoStore(): Promise<void>;

  /** Optional cleanup hook for adapters that hold open handles. */
  close?(): Promise<void>;
}

/** Thrown when an append-only call would overwrite an existing entry. */
export class AppendOnlyViolationError extends Error {
  readonly code = "APPEND_ONLY_VIOLATION";
  constructor(
    public readonly kind: "audit" | "decision_history",
    public readonly project_id: string,
    public readonly entry_id: string,
  ) {
    super(
      `append-only ${kind} entry already exists: project=${project_id} id=${entry_id}`,
    );
  }
}

/** Thrown by the factory when an unknown PERSISTENCE_DRIVER value is set. */
export class UnknownPersistenceDriverError extends Error {
  readonly code = "UNKNOWN_PERSISTENCE_DRIVER";
  constructor(public readonly driver: string) {
    super(
      `Unknown PERSISTENCE_DRIVER "${driver}". Expected one of: "memory" (default), "file".`,
    );
  }
}
