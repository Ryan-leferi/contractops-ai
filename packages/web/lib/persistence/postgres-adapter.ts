/**
 * PostgreSQL persistence adapter (Milestone 3H).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Storage backend behind the same `PersistenceAdapter`         │
 *   │ interface as the memory + file adapters. Opt-in via          │
 *   │ PERSISTENCE_DRIVER=postgres + DATABASE_URL.                  │
 *   │                                                              │
 *   │ Production deployment still requires real authentication +   │
 *   │ project-level authorization — see ADR-013 / ADR-014 /         │
 *   │ ADR-015. PostgreSQL fixes durability and concurrency, not    │
 *   │ identity or RBAC.                                            │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Schema (bootstrapped lazily, idempotent CREATE TABLE IF NOT EXISTS):
 *
 *   contractops_projects (
 *     id          TEXT PRIMARY KEY,
 *     name        TEXT NOT NULL,
 *     status      TEXT NOT NULL,
 *     created_at  TIMESTAMPTZ NOT NULL
 *   )
 *
 *   contractops_project_states (
 *     project_id  TEXT PRIMARY KEY REFERENCES contractops_projects(id) ON DELETE CASCADE,
 *     state       JSONB NOT NULL,
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   )                                  -- upserted on save
 *
 *   contractops_audit_logs (
 *     id          TEXT PRIMARY KEY,    -- duplicate INSERT → 23505 → AppendOnlyViolationError
 *     project_id  TEXT NOT NULL REFERENCES contractops_projects(id) ON DELETE CASCADE,
 *     entry       JSONB NOT NULL,
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   )
 *
 *   contractops_issue_decision_history (
 *     id          TEXT PRIMARY KEY,    -- same append-only contract
 *     project_id  TEXT NOT NULL REFERENCES contractops_projects(id) ON DELETE CASCADE,
 *     entry       JSONB NOT NULL,
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *   )
 *
 * No table stores generated DOCX or Markdown export binaries (PLATFORM_BRIEF.md
 * §10 / Milestone 3A); ExportFile.content is a text summary blurb stored
 * inside the JSONB ProjectState column.
 *
 * No migration framework — the schema lives entirely in this file. When a
 * later milestone needs schema evolution we either add another idempotent
 * `CREATE` here or graduate to a real migration tool. For now: simple is
 * the constraint.
 */
import * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";
// Type-only import — TypeScript erases this at compile time, so `pg` is
// NOT loaded just by importing this module. The runtime `require("pg")`
// happens inside `createPgPool()`, which is only called when
// PERSISTENCE_DRIVER=postgres. Keeps the memory + file paths from
// paying the `pg` module-load cost.
import type { Pool, PoolConfig } from "pg";

import {
  AppendOnlyViolationError,
  type PersistenceAdapter,
  type PgClientLike,
  type PgPoolLike,
  type ProjectSummary,
} from "./types";

/** Postgres unique-violation SQLSTATE — maps to AppendOnlyViolationError. */
const PG_UNIQUE_VIOLATION = "23505";

interface PgError {
  code?: string;
  message?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as PgError).code === PG_UNIQUE_VIOLATION;
}

export class PostgresPersistenceAdapter implements PersistenceAdapter {
  readonly driver = "postgres" as const;
  private readonly pool: PgPoolLike;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(pool: PgPoolLike) {
    this.pool = pool;
  }

  // ─────────────────────────────────────────────────────────────
  // Read side
  // ─────────────────────────────────────────────────────────────

  async listProjects(): Promise<ProjectSummary[]> {
    await this.ensureBootstrapped();
    const res = await this.pool.query<{
      id: string;
      name: string;
      status: string;
      created_at: Date | string;
    }>(
      `SELECT id, name, status, created_at
         FROM contractops_projects
        ORDER BY created_at ASC`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      created_at:
        typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
    }));
  }

  async getProjectState(id: string): Promise<core.ProjectState | null> {
    await this.ensureBootstrapped();
    const res = await this.pool.query<{ state: unknown }>(
      `SELECT state FROM contractops_project_states WHERE project_id = $1`,
      [id],
    );
    if (res.rows.length === 0) return null;
    // pg returns JSONB columns already parsed to JS values; fakes do the same.
    return res.rows[0]!.state as core.ProjectState;
  }

  async listAuditLogs(projectId: string): Promise<AuditLog[]> {
    await this.ensureBootstrapped();
    const res = await this.pool.query<{ entry: unknown }>(
      `SELECT entry
         FROM contractops_audit_logs
        WHERE project_id = $1
        ORDER BY created_at ASC, id ASC`,
      [projectId],
    );
    return res.rows.map((r) => r.entry as AuditLog);
  }

  async listDecisionHistory(projectId: string): Promise<IssueDecisionHistoryEntry[]> {
    await this.ensureBootstrapped();
    const res = await this.pool.query<{ entry: unknown }>(
      `SELECT entry
         FROM contractops_issue_decision_history
        WHERE project_id = $1
        ORDER BY created_at ASC, id ASC`,
      [projectId],
    );
    return res.rows.map((r) => r.entry as IssueDecisionHistoryEntry);
  }

  // ─────────────────────────────────────────────────────────────
  // Write side
  // ─────────────────────────────────────────────────────────────

  async saveProjectState(state: core.ProjectState): Promise<void> {
    await this.ensureBootstrapped();
    // Two-row upsert: keep contractops_projects.{name,status,created_at}
    // in sync with the latest snapshot, and replace the JSONB blob in
    // contractops_project_states. Both rows belong to the same logical
    // project, so we wrap them in a transaction.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO contractops_projects (id, name, status, created_at)
              VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name,
                status = EXCLUDED.status`,
        [state.project.id, state.project.name, state.project.status, state.project.created_at],
      );
      await client.query(
        `INSERT INTO contractops_project_states (project_id, state)
              VALUES ($1, $2::jsonb)
         ON CONFLICT (project_id) DO UPDATE
            SET state = EXCLUDED.state,
                updated_at = now()`,
        [state.project.id, JSON.stringify(state)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async createProject(
    state: core.ProjectState,
    creationAudit: AuditLog,
  ): Promise<void> {
    await this.ensureBootstrapped();
    // Atomic: project row + state row + first audit row in a single
    // transaction. A future SQL-backed adapter could expose this
    // exact contract; here we do the same so memory/file/postgres all
    // behave identically.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO contractops_projects (id, name, status, created_at)
              VALUES ($1, $2, $3, $4)`,
        [state.project.id, state.project.name, state.project.status, state.project.created_at],
      );
      await client.query(
        `INSERT INTO contractops_project_states (project_id, state)
              VALUES ($1, $2::jsonb)`,
        [state.project.id, JSON.stringify(state)],
      );
      await client.query(
        `INSERT INTO contractops_audit_logs (id, project_id, entry)
              VALUES ($1, $2, $3::jsonb)`,
        [creationAudit.id, state.project.id, JSON.stringify(creationAudit)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await safeRollback(client);
      if (isUniqueViolation(err)) {
        throw new AppendOnlyViolationError("audit", state.project.id, creationAudit.id);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async appendAuditLog(projectId: string, entry: AuditLog): Promise<void> {
    await this.ensureBootstrapped();
    try {
      await this.pool.query(
        `INSERT INTO contractops_audit_logs (id, project_id, entry)
              VALUES ($1, $2, $3::jsonb)`,
        [entry.id, projectId, JSON.stringify(entry)],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppendOnlyViolationError("audit", projectId, entry.id);
      }
      throw err;
    }
  }

  async appendDecisionHistory(
    projectId: string,
    entry: IssueDecisionHistoryEntry,
  ): Promise<void> {
    await this.ensureBootstrapped();
    try {
      await this.pool.query(
        `INSERT INTO contractops_issue_decision_history (id, project_id, entry)
              VALUES ($1, $2, $3::jsonb)`,
        [entry.id, projectId, JSON.stringify(entry)],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppendOnlyViolationError("decision_history", projectId, entry.id);
      }
      throw err;
    }
  }

  async resetDemoStore(): Promise<void> {
    await this.ensureBootstrapped();
    // DELETE rather than TRUNCATE — the latter can require additional
    // privileges and won't fire CASCADE the same way under some
    // mocked-pg-client implementations. The audit log + history tables
    // CASCADE on project delete, so wiping the projects table is
    // enough; we explicitly delete the others first to be defensive
    // in case the FK was disabled on a developer's local instance.
    await this.pool.query(`DELETE FROM contractops_issue_decision_history`);
    await this.pool.query(`DELETE FROM contractops_audit_logs`);
    await this.pool.query(`DELETE FROM contractops_project_states`);
    await this.pool.query(`DELETE FROM contractops_projects`);
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }

  // ─────────────────────────────────────────────────────────────
  // Internals — lazy idempotent bootstrap
  // ─────────────────────────────────────────────────────────────

  private async ensureBootstrapped(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrap();
    }
    await this.bootstrapPromise;
  }

  private async bootstrap(): Promise<void> {
    // Each statement is idempotent. The bootstrap runs once per adapter
    // instance (cached via this.bootstrapPromise). On a clean DB this
    // creates the four tables + the two project_id indexes; on a
    // populated DB it is a no-op.
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS contractops_projects (
         id          TEXT PRIMARY KEY,
         name        TEXT NOT NULL,
         status      TEXT NOT NULL,
         created_at  TIMESTAMPTZ NOT NULL
       )`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS contractops_project_states (
         project_id  TEXT PRIMARY KEY REFERENCES contractops_projects(id) ON DELETE CASCADE,
         state       JSONB NOT NULL,
         updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS contractops_audit_logs (
         id          TEXT PRIMARY KEY,
         project_id  TEXT NOT NULL REFERENCES contractops_projects(id) ON DELETE CASCADE,
         entry       JSONB NOT NULL,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS contractops_audit_logs_project_idx
         ON contractops_audit_logs(project_id, created_at)`,
    );
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS contractops_issue_decision_history (
         id          TEXT PRIMARY KEY,
         project_id  TEXT NOT NULL REFERENCES contractops_projects(id) ON DELETE CASCADE,
         entry       JSONB NOT NULL,
         created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS contractops_issue_decision_history_project_idx
         ON contractops_issue_decision_history(project_id, created_at)`,
    );
  }
}

async function safeRollback(client: PgClientLike): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Best effort. If ROLLBACK itself fails the connection is
    // probably broken — the caller will surface the original error.
  }
}

/**
 * Build a real `pg.Pool` wrapped to look like our minimal `PgPoolLike`
 * interface. Lives in the same file as `PostgresPersistenceAdapter` so
 * the `pg` import stays scoped to a single source file (enforced by
 * `packages/core/tests/no-sdk-imports.test.ts`).
 *
 * When `ssl` is true we pass `{ rejectUnauthorized: false }` — the
 * minimum useful default for managed Postgres endpoints (Supabase,
 * Neon, RDS) that present a chain the local trust store doesn't
 * carry. For hardened deployments, swap this factory for one that
 * passes a real CA bundle.
 *
 * Tests inject their own `PgPoolLike` directly into the
 * `PostgresPersistenceAdapter` constructor and never call this
 * factory; production paths go through `selectPersistenceAdapter`,
 * which calls this factory once and caches the resulting adapter on
 * `globalThis`.
 */
export function createPgPool(opts: {
  connectionString: string;
  ssl: boolean;
}): PgPoolLike {
  // Lazy require — `pg` is a heavy Node-only module (libpq fallback,
  // SSL machinery). Loading it eagerly at module-init would slow down
  // every Next.js cold start, including memory + file driver runs that
  // never touch Postgres. Doing the require here means the module is
  // pulled in once on first connection, never if the operator stays on
  // a different driver.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("pg") as { Pool: typeof Pool };
  const config: PoolConfig = {
    connectionString: opts.connectionString,
    ssl: opts.ssl ? { rejectUnauthorized: false } : false,
  };
  // `pg.Pool` matches `PgPoolLike` structurally (query / connect / end)
  // but its overloaded query signatures aren't trivially assignable to
  // our trimmed shape — hence the double cast.
  return new pg.Pool(config) as unknown as PgPoolLike;
}
