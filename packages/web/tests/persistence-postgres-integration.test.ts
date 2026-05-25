/**
 * GATED PostgreSQL integration test (Milestone 3H).
 *
 * Runs ONLY when BOTH of the following env vars are set:
 *
 *   POSTGRES_INTEGRATION=true
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname
 *
 * Optional:
 *
 *   POSTGRES_SSL=true     — wraps the pool with rejectUnauthorized:false
 *
 * CI must NOT set POSTGRES_INTEGRATION. `npm run verify` keeps memory as
 * the default adapter, so the standard pipeline never touches a real DB.
 *
 * Purpose: prove the PostgresPersistenceAdapter + the bootstrap DDL +
 * the AppendOnlyViolationError mapping all work against a real
 * PostgreSQL endpoint, without changing any production code path.
 *
 * The test calls `resetDemoStore()` at the start AND end of its run, so
 * leftover rows from a previous broken run don't poison the next one,
 * and a clean DB is left behind on success. Run only against a
 * disposable dev / staging Postgres — `resetDemoStore` deletes EVERY
 * `contractops_*` row.
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  AppendOnlyViolationError,
  createPgPool,
  PostgresPersistenceAdapter,
  type PgPoolLike,
} from "../lib/persistence";
import type * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";

const ENABLED =
  process.env.POSTGRES_INTEGRATION === "true" && !!process.env.DATABASE_URL;

function makeState(id: string): core.ProjectState {
  return {
    project: {
      id,
      name: "Postgres Integration Project",
      status: "created",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "user_demo",
    },
    source_pack: {
      id: `sp_${id}`,
      project_id: id,
      locked: false,
      locked_at: null,
      document_ids: [],
    },
    source_documents: [],
    source_contents: [],
    contract_type: null,
    playbook: null,
    intake_questions: [],
    intake_answers: [],
    deal_memo: null,
    drafting_plan: null,
    contract_versions: [],
    issue_cards: [],
    agent_runs: [],
    exports: [],
    qa_runs: [],
    decision_history: [],
  } as unknown as core.ProjectState;
}

function makeAudit(id: string, project_id: string): AuditLog {
  return {
    id,
    project_id,
    actor: "user_demo",
    event_type: "project_created",
    ref_id: project_id,
    timestamp: "2026-01-01T00:00:00.000Z",
    payload: { name: "demo" },
  } as unknown as AuditLog;
}

function makeHistory(id: string, project_id: string): IssueDecisionHistoryEntry {
  return {
    id,
    project_id,
    issue_id: "ic_a",
    previous_decision: "pending",
    new_decision: "rejected",
    actor_id: "lawyer_demo",
    actor_role: "human_lawyer",
    changed_at: "2026-01-01T00:00:00.000Z",
    partial_note: null,
    reason_note: "for integration test",
  };
}

describe.skipIf(!ENABLED)(
  "PostgresPersistenceAdapter — real Postgres integration (gated)",
  () => {
    let pool: PgPoolLike | null = null;

    afterAll(async () => {
      // Best-effort pool shutdown. If close() / end() throws we don't
      // want to mask the actual test failure.
      try {
        await pool?.end?.();
      } catch {
        // swallow — see comment above
      }
    });

    it("round-trips create / save / append and survives a fresh adapter instance", async () => {
      // 60s ceiling — most managed providers (Supabase, Neon, RDS) take
      // a few seconds to accept a fresh pool connection on cold start.
      pool = createPgPool({
        connectionString: process.env.DATABASE_URL!,
        ssl: process.env.POSTGRES_SSL === "true",
      });

      const adapter = new PostgresPersistenceAdapter(pool);
      // Start fresh — wipes anything left over from a previous broken
      // run on this DB. Safe because POSTGRES_INTEGRATION must only be
      // set against a disposable dev/staging instance.
      await adapter.resetDemoStore();

      // Use a timestamp-suffixed id so concurrent test runs don't clash
      // (the gate already serializes them, but it doesn't hurt).
      const projectId = `proj_pgtest_${Date.now()}`;
      const state = makeState(projectId);

      // ── createProject (transactional: project + state + first audit) ──
      await adapter.createProject(state, makeAudit("au_pgtest_1", projectId));

      // ── saveProjectState (upsert) ──
      await adapter.saveProjectState({
        ...state,
        project: { ...state.project, name: "Renamed by integration test" },
      } as core.ProjectState);

      // ── appendAuditLog + appendDecisionHistory ──
      await adapter.appendAuditLog(projectId, makeAudit("au_pgtest_2", projectId));
      await adapter.appendDecisionHistory(
        projectId,
        makeHistory("hist_pgtest_1", projectId),
      );

      // ── Reads via the SAME adapter ──
      const projectsA = await adapter.listProjects();
      expect(projectsA.map((p) => p.id)).toContain(projectId);

      const stateA = await adapter.getProjectState(projectId);
      expect(stateA?.project.name).toBe("Renamed by integration test");

      const auditsA = await adapter.listAuditLogs(projectId);
      expect(auditsA.map((a) => a.id)).toEqual(["au_pgtest_1", "au_pgtest_2"]);

      const historyA = await adapter.listDecisionHistory(projectId);
      expect(historyA.map((h) => h.id)).toEqual(["hist_pgtest_1"]);

      // ── Append-only enforcement against the real DB ──
      await expect(
        adapter.appendAuditLog(projectId, makeAudit("au_pgtest_1", projectId)),
      ).rejects.toBeInstanceOf(AppendOnlyViolationError);
      await expect(
        adapter.appendDecisionHistory(
          projectId,
          makeHistory("hist_pgtest_1", projectId),
        ),
      ).rejects.toBeInstanceOf(AppendOnlyViolationError);

      // ── Fresh adapter, same pool — proves there's no in-memory state
      //    we silently rely on. (Equivalent to a process restart hitting
      //    the same DB.) ──
      const reborn = new PostgresPersistenceAdapter(pool);
      const projectsB = await reborn.listProjects();
      expect(projectsB.map((p) => p.id)).toContain(projectId);
      expect((await reborn.getProjectState(projectId))?.project.name).toBe(
        "Renamed by integration test",
      );
      expect((await reborn.listAuditLogs(projectId)).map((a) => a.id)).toEqual([
        "au_pgtest_1",
        "au_pgtest_2",
      ]);
      expect(
        (await reborn.listDecisionHistory(projectId)).map((h) => h.id),
      ).toEqual(["hist_pgtest_1"]);

      // ── Cleanup — leave the DB pristine for the next run ──
      await reborn.resetDemoStore();
      expect(
        (await reborn.listProjects()).filter((p) => p.id === projectId),
      ).toEqual([]);
    }, 60_000);
  },
);
