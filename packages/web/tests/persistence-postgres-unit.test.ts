/**
 * PostgreSQL adapter — deep unit tests (Milestone 3H).
 *
 * Runs against `FakePgPool`. The shared contract suite (memory + file +
 * postgres uniform behavior) lives in `persistence-adapter.test.ts`;
 * this file covers postgres-specific concerns:
 *
 *   - Bootstrap is lazy AND idempotent across many adapter calls.
 *   - `createProject` is atomic — a duplicate audit id rolls back the
 *     project + state INSERTs too (no partial writes).
 *   - `appendAuditLog` / `appendDecisionHistory` map pg's SQLSTATE
 *     23505 to `AppendOnlyViolationError` (kind / project_id / entry_id
 *     all populated).
 *   - `close()` calls through to the pool's `end()`.
 *   - `driver` is reported as the string literal "postgres".
 */
import { describe, expect, it } from "vitest";

import {
  AppendOnlyViolationError,
  PostgresPersistenceAdapter,
} from "../lib/persistence";
import { FakePgPool } from "./fake-pg-pool";
import type * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";

function makeState(id = "proj_p1"): core.ProjectState {
  return {
    project: {
      id,
      name: "Postgres Unit Test Project",
      status: "created",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "user_demo",
    },
    source_pack: {
      id: "sp_1",
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

function makeAudit(id: string, project_id = "proj_p1"): AuditLog {
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

function makeHistory(
  id: string,
  project_id = "proj_p1",
): IssueDecisionHistoryEntry {
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
    reason_note: "for test",
  };
}

describe("PostgresPersistenceAdapter — driver identification", () => {
  it("reports driver = \"postgres\"", () => {
    const a = new PostgresPersistenceAdapter(new FakePgPool());
    expect(a.driver).toBe("postgres");
  });
});

describe("PostgresPersistenceAdapter — bootstrap is lazy + idempotent", () => {
  it("CREATE TABLE/INDEX runs only on the first read or write, not on construction", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);
    // Construction alone must not touch the DB. This keeps adapter
    // construction in select-adapter cheap and avoids surprises in HMR.
    expect(pool.bootstrapCalls).toBe(0);
    expect(pool.queryCalls).toBe(0);

    await a.listProjects();
    const afterFirst = pool.bootstrapCalls;
    expect(afterFirst).toBeGreaterThan(0);

    // Subsequent calls must not re-run the bootstrap statements.
    await a.listProjects();
    await a.listAuditLogs("anything");
    await a.listDecisionHistory("anything");
    expect(pool.bootstrapCalls).toBe(afterFirst);
  });

  it("concurrent first-touches dedupe to one bootstrap pass", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);
    // Fire several reads "simultaneously". The bootstrap promise is
    // cached so we see exactly one bootstrap sequence, not N.
    await Promise.all([
      a.listProjects(),
      a.listProjects(),
      a.listAuditLogs("x"),
      a.listDecisionHistory("y"),
    ]);
    const firstPass = pool.bootstrapCalls;
    // Six DDL statements (4 CREATE TABLE + 2 CREATE INDEX) per pass.
    expect(firstPass).toBe(6);
  });
});

describe("PostgresPersistenceAdapter — createProject atomicity", () => {
  it("rolls back project + state when the creation audit collides on PK", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);

    // Pre-seed an audit row to force the createProject INSERT into 23505.
    await a.createProject(makeState("proj_seed"), makeAudit("au_dup", "proj_seed"));

    const before = pool.inspect();
    // Attempt to create a NEW project but reuse the existing audit id.
    await expect(
      a.createProject(makeState("proj_new"), makeAudit("au_dup", "proj_new")),
    ).rejects.toBeInstanceOf(AppendOnlyViolationError);

    const after = pool.inspect();
    // No new rows in any of the three tables — the transaction rolled
    // back. (Project row count is unchanged, state row count is
    // unchanged, audit row count is unchanged.)
    expect(after.projects).toBe(before.projects);
    expect(after.projectStates).toBe(before.projectStates);
    expect(after.auditLogs).toBe(before.auditLogs);

    // And the new project_id never appears in either snapshot or list.
    expect(await a.getProjectState("proj_new")).toBeNull();
    expect((await a.listProjects()).map((p) => p.id)).not.toContain("proj_new");
  });

  it("AppendOnlyViolationError carries kind + project_id + entry_id", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);
    await a.createProject(makeState("proj_1"), makeAudit("au_1"));

    try {
      await a.appendAuditLog("proj_1", makeAudit("au_1"));
      throw new Error("appendAuditLog should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppendOnlyViolationError);
      const v = e as AppendOnlyViolationError;
      expect(v.kind).toBe("audit");
      expect(v.project_id).toBe("proj_1");
      expect(v.entry_id).toBe("au_1");
      expect(v.code).toBe("APPEND_ONLY_VIOLATION");
    }
  });

  it("appendDecisionHistory maps SQLSTATE 23505 to AppendOnlyViolationError(kind=decision_history)", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);
    await a.createProject(makeState("proj_1"), makeAudit("au_1"));
    await a.appendDecisionHistory("proj_1", makeHistory("h1"));

    try {
      await a.appendDecisionHistory("proj_1", makeHistory("h1"));
      throw new Error("appendDecisionHistory should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppendOnlyViolationError);
      const v = e as AppendOnlyViolationError;
      expect(v.kind).toBe("decision_history");
      expect(v.project_id).toBe("proj_1");
      expect(v.entry_id).toBe("h1");
    }
  });
});

describe("PostgresPersistenceAdapter — saveProjectState is upsert", () => {
  it("does NOT throw when called repeatedly on the same project_id", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);
    await a.createProject(makeState(), makeAudit("au_1"));

    const renamed = {
      ...makeState(),
      project: { ...makeState().project, name: "Renamed once" },
    } as core.ProjectState;
    await a.saveProjectState(renamed);

    const renamedTwice = {
      ...makeState(),
      project: { ...makeState().project, name: "Renamed twice" },
    } as core.ProjectState;
    await a.saveProjectState(renamedTwice);

    const fetched = await a.getProjectState("proj_p1");
    expect(fetched!.project.name).toBe("Renamed twice");
  });
});

describe("PostgresPersistenceAdapter — close() releases the pool", () => {
  it("forwards close() to pool.end()", async () => {
    const pool = new FakePgPool();
    const a = new PostgresPersistenceAdapter(pool);
    expect(pool.endCalls).toBe(0);
    await a.close!();
    expect(pool.endCalls).toBe(1);
  });
});
