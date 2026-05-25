/**
 * In-memory fake `pg.Pool` for unit-testing the PostgreSQL persistence
 * adapter (Milestone 3H).
 *
 * Implements just enough SQL pattern matching for the queries the
 * adapter actually issues — see
 * `packages/web/lib/persistence/postgres-adapter.ts`:
 *
 *   - `CREATE TABLE … IF NOT EXISTS` / `CREATE INDEX … IF NOT EXISTS`
 *     (bootstrap, no-op).
 *   - `INSERT INTO contractops_projects (…)` [+ `ON CONFLICT (id) DO UPDATE`]
 *   - `INSERT INTO contractops_project_states (…)` [+ `ON CONFLICT DO UPDATE`]
 *   - `INSERT INTO contractops_audit_logs (…)`            ← APPEND-ONLY
 *   - `INSERT INTO contractops_issue_decision_history (…)` ← APPEND-ONLY
 *   - `SELECT …` from each of the four tables.
 *   - `DELETE FROM …` for each of the four tables.
 *   - `BEGIN` / `COMMIT` / `ROLLBACK` (per-client transaction control).
 *
 * Duplicate-key inserts throw a synthetic error shaped like a real pg
 * error: `{ code: "23505" }`. This is the SQLSTATE the adapter
 * catches and maps to `AppendOnlyViolationError`.
 *
 * Transactions: `BEGIN` snapshots the four backing Maps; `ROLLBACK`
 * (or `release()` while still in a transaction) restores the
 * snapshot; `COMMIT` discards it. That's enough fidelity for the
 * adapter's single-statement-then-COMMIT pattern.
 *
 * Concurrency: tests run sequentially so there is no need to model
 * MVCC. Each client owns its own snapshot; the backend store is
 * shared across the pool.
 */
import type {
  PgClientLike,
  PgPoolLike,
  PgQueryResult,
} from "../lib/persistence/types";

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  created_at: Date;
}

interface JournalRow {
  id: string;
  project_id: string;
  entry: unknown;
  created_at: Date;
}

interface Backend {
  projects: Map<string, ProjectRow>;
  projectStates: Map<string, unknown>;
  auditLogs: Map<string, JournalRow>;
  decisionHistory: Map<string, JournalRow>;
  /** Bumped by every CREATE TABLE / CREATE INDEX so tests can assert idempotency. */
  bootstrapCalls: number;
}

function newBackend(): Backend {
  return {
    projects: new Map(),
    projectStates: new Map(),
    auditLogs: new Map(),
    decisionHistory: new Map(),
    bootstrapCalls: 0,
  };
}

function snapshot(b: Backend): Backend {
  return {
    projects: new Map(b.projects),
    projectStates: new Map(b.projectStates),
    auditLogs: new Map(b.auditLogs),
    decisionHistory: new Map(b.decisionHistory),
    bootstrapCalls: b.bootstrapCalls,
  };
}

function restore(target: Backend, src: Backend): void {
  target.projects = src.projects;
  target.projectStates = src.projectStates;
  target.auditLogs = src.auditLogs;
  target.decisionHistory = src.decisionHistory;
  target.bootstrapCalls = src.bootstrapCalls;
}

/** Synthetic pg unique-violation. Matches the shape the real driver throws. */
export class FakeUniqueViolationError extends Error {
  readonly code = "23505";
  constructor(message: string) {
    super(message);
  }
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The adapter binds `$N::jsonb` parameters as `JSON.stringify(value)`.
 * pg's JSONB column then returns a parsed object on SELECT. We mirror
 * that so what tests see matches real pg semantics.
 */
function parseJsonbParam(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function execute(
  backend: Backend,
  rawText: string,
  values: unknown[],
): PgQueryResult<unknown> {
  const text = normalizeSql(rawText);
  const upper = text.toUpperCase();

  // ── Bootstrap (idempotent, no-op) ─────────────────────────────
  if (upper.startsWith("CREATE TABLE") || upper.startsWith("CREATE INDEX")) {
    backend.bootstrapCalls += 1;
    return { rows: [] };
  }

  // ── INSERTs ───────────────────────────────────────────────────
  if (/^INSERT INTO contractops_projects/i.test(text)) {
    const [id, name, status, createdAt] = values as [string, string, string, string];
    const isUpsert = /ON CONFLICT/i.test(text);
    const existing = backend.projects.get(id);
    if (existing && !isUpsert) {
      throw new FakeUniqueViolationError(
        `duplicate key value violates unique constraint "contractops_projects_pkey" (id=${id})`,
      );
    }
    backend.projects.set(id, {
      id,
      name,
      status,
      created_at:
        typeof createdAt === "string"
          ? new Date(createdAt)
          : (createdAt as unknown as Date),
    });
    return { rows: [] };
  }

  if (/^INSERT INTO contractops_project_states/i.test(text)) {
    const [projectId, stateRaw] = values as [string, unknown];
    const isUpsert = /ON CONFLICT/i.test(text);
    if (backend.projectStates.has(projectId) && !isUpsert) {
      throw new FakeUniqueViolationError(
        `duplicate key value violates unique constraint "contractops_project_states_pkey" (project_id=${projectId})`,
      );
    }
    backend.projectStates.set(projectId, parseJsonbParam(stateRaw));
    return { rows: [] };
  }

  if (/^INSERT INTO contractops_audit_logs/i.test(text)) {
    const [id, projectId, entryRaw] = values as [string, string, unknown];
    if (backend.auditLogs.has(id)) {
      throw new FakeUniqueViolationError(
        `duplicate key value violates unique constraint "contractops_audit_logs_pkey" (id=${id})`,
      );
    }
    backend.auditLogs.set(id, {
      id,
      project_id: projectId,
      entry: parseJsonbParam(entryRaw),
      created_at: new Date(),
    });
    return { rows: [] };
  }

  if (/^INSERT INTO contractops_issue_decision_history/i.test(text)) {
    const [id, projectId, entryRaw] = values as [string, string, unknown];
    if (backend.decisionHistory.has(id)) {
      throw new FakeUniqueViolationError(
        `duplicate key value violates unique constraint "contractops_issue_decision_history_pkey" (id=${id})`,
      );
    }
    backend.decisionHistory.set(id, {
      id,
      project_id: projectId,
      entry: parseJsonbParam(entryRaw),
      created_at: new Date(),
    });
    return { rows: [] };
  }

  // ── SELECTs ───────────────────────────────────────────────────
  if (/^SELECT id, name, status, created_at FROM contractops_projects/i.test(text)) {
    const sorted = Array.from(backend.projects.values()).sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    return { rows: sorted };
  }

  if (/^SELECT state FROM contractops_project_states/i.test(text)) {
    const [projectId] = values as [string];
    const state = backend.projectStates.get(projectId);
    return { rows: state === undefined ? [] : [{ state }] };
  }

  if (/^SELECT entry FROM contractops_audit_logs/i.test(text)) {
    const [projectId] = values as [string];
    const rows = Array.from(backend.auditLogs.values())
      .filter((r) => r.project_id === projectId)
      .sort(sortByCreatedAtThenId)
      .map((r) => ({ entry: r.entry }));
    return { rows };
  }

  if (/^SELECT entry FROM contractops_issue_decision_history/i.test(text)) {
    const [projectId] = values as [string];
    const rows = Array.from(backend.decisionHistory.values())
      .filter((r) => r.project_id === projectId)
      .sort(sortByCreatedAtThenId)
      .map((r) => ({ entry: r.entry }));
    return { rows };
  }

  // ── DELETEs ───────────────────────────────────────────────────
  if (/^DELETE FROM contractops_issue_decision_history/i.test(text)) {
    backend.decisionHistory.clear();
    return { rows: [] };
  }
  if (/^DELETE FROM contractops_audit_logs/i.test(text)) {
    backend.auditLogs.clear();
    return { rows: [] };
  }
  if (/^DELETE FROM contractops_project_states/i.test(text)) {
    backend.projectStates.clear();
    return { rows: [] };
  }
  if (/^DELETE FROM contractops_projects/i.test(text)) {
    backend.projects.clear();
    return { rows: [] };
  }

  throw new Error(`FakePgPool: unrecognized SQL\n  ${text}`);
}

function sortByCreatedAtThenId(a: JournalRow, b: JournalRow): number {
  const dt = a.created_at.getTime() - b.created_at.getTime();
  return dt !== 0 ? dt : a.id.localeCompare(b.id);
}

export class FakePgPool implements PgPoolLike {
  private readonly backend: Backend;
  /** Number of `pool.query()` calls (no transaction overhead). */
  queryCalls = 0;
  /** Number of `pool.connect()` calls. */
  connectCalls = 0;
  /** Number of times `pool.end()` was awaited. */
  endCalls = 0;

  constructor(backend?: Backend) {
    this.backend = backend ?? newBackend();
  }

  async query<R = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<PgQueryResult<R>> {
    this.queryCalls += 1;
    return execute(this.backend, text, values ?? []) as PgQueryResult<R>;
  }

  async connect(): Promise<PgClientLike> {
    this.connectCalls += 1;
    const backend = this.backend;
    let txnSnapshot: Backend | null = null;
    let released = false;
    const guard = () => {
      if (released) throw new Error("FakePgPool client used after release()");
    };
    return {
      async query<R = unknown>(
        text: string,
        values?: unknown[],
      ): Promise<PgQueryResult<R>> {
        guard();
        const upper = normalizeSql(text).toUpperCase();
        if (upper === "BEGIN") {
          txnSnapshot = snapshot(backend);
          return { rows: [] } as PgQueryResult<R>;
        }
        if (upper === "COMMIT") {
          txnSnapshot = null;
          return { rows: [] } as PgQueryResult<R>;
        }
        if (upper === "ROLLBACK") {
          if (txnSnapshot) {
            restore(backend, txnSnapshot);
            txnSnapshot = null;
          }
          return { rows: [] } as PgQueryResult<R>;
        }
        return execute(backend, text, values ?? []) as PgQueryResult<R>;
      },
      release(): void {
        if (released) return;
        // Mid-transaction release → implicit rollback. Mirrors pg's
        // recommended "always commit or release with err" behavior.
        if (txnSnapshot) {
          restore(backend, txnSnapshot);
          txnSnapshot = null;
        }
        released = true;
      },
    };
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }

  // ── Test-only helpers ───────────────────────────────────────────

  /** Number of times the bootstrap statements have been issued. */
  get bootstrapCalls(): number {
    return this.backend.bootstrapCalls;
  }

  /** Direct backend access for assertions ("did anything change?"). */
  inspect(): Readonly<{
    projects: number;
    projectStates: number;
    auditLogs: number;
    decisionHistory: number;
  }> {
    return {
      projects: this.backend.projects.size,
      projectStates: this.backend.projectStates.size,
      auditLogs: this.backend.auditLogs.size,
      decisionHistory: this.backend.decisionHistory.size,
    };
  }
}
