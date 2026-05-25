import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AppendOnlyViolationError,
  FilePersistenceAdapter,
  MemoryPersistenceAdapter,
  UnknownPersistenceDriverError,
  createPersistenceAdapter,
  type PersistenceAdapter,
} from "../lib/persistence";
import type * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";

// ─────────────────────────────────────────────────────────────────────
// Fixtures — minimal ProjectState shape; the adapter is shape-agnostic.
// ─────────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<core.ProjectState> = {}): core.ProjectState {
  const base = {
    project: {
      id: "proj_p1",
      name: "Adapter Test Project",
      status: "created",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "user_demo",
    },
    source_pack: {
      id: "sp_1",
      project_id: "proj_p1",
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
  return { ...base, ...overrides } as core.ProjectState;
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
  issue_id = "ic_a",
): IssueDecisionHistoryEntry {
  return {
    id,
    project_id,
    issue_id,
    previous_decision: "pending",
    new_decision: "rejected",
    actor_id: "lawyer_demo",
    actor_role: "human_lawyer",
    changed_at: "2026-01-01T00:00:00.000Z",
    partial_note: null,
    reason_note: "for test",
  };
}

// Shared contract assertions — every adapter must satisfy them. Each
// describe.each call instantiates the suite for both Memory and File.

interface AdapterFactory {
  name: string;
  build: () => Promise<PersistenceAdapter>;
  rebuild?: () => Promise<PersistenceAdapter>; // for "survives re-instantiation"
  teardown?: () => Promise<void>;
}

function memoryFactory(): AdapterFactory {
  return {
    name: "MemoryPersistenceAdapter",
    build: async () => new MemoryPersistenceAdapter(),
    // Memory cannot survive process restart — but the globalThis-pinned
    // singleton survives a fresh `new MemoryPersistenceAdapter()` call
    // within the same process, so re-instantiation still finds the data.
    rebuild: async () => new MemoryPersistenceAdapter(),
  };
}

async function fileFactory(): Promise<AdapterFactory & { dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "contractops-persist-"));
  return {
    name: "FilePersistenceAdapter",
    dir,
    build: async () => new FilePersistenceAdapter(dir),
    rebuild: async () => new FilePersistenceAdapter(dir),
    teardown: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Shared adapter contract
// ─────────────────────────────────────────────────────────────────────

function runContract(makeFactory: () => Promise<AdapterFactory>) {
  describe("PersistenceAdapter contract", () => {
    let factory: AdapterFactory;
    let adapter: PersistenceAdapter;

    beforeEach(async () => {
      factory = await makeFactory();
      adapter = await factory.build();
      // Memory adapter shares globalThis state across tests — reset to
      // start from a clean slate.
      await adapter.resetDemoStore();
    });

    afterEach(async () => {
      await adapter.resetDemoStore();
      await factory.teardown?.();
    });

    it("list/get returns empty when nothing has been created", async () => {
      expect(await adapter.listProjects()).toEqual([]);
      expect(await adapter.getProjectState("missing")).toBeNull();
      expect(await adapter.listAuditLogs("missing")).toEqual([]);
      expect(await adapter.listDecisionHistory("missing")).toEqual([]);
    });

    it("createProject persists state and the creation audit atomically", async () => {
      const state = makeState();
      const audit = makeAudit("au_1");
      await adapter.createProject(state, audit);

      const summaries = await adapter.listProjects();
      expect(summaries).toEqual([
        {
          id: "proj_p1",
          name: "Adapter Test Project",
          status: "created",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]);
      expect((await adapter.getProjectState("proj_p1"))!.project.name).toBe(
        "Adapter Test Project",
      );
      const audits = await adapter.listAuditLogs("proj_p1");
      expect(audits).toHaveLength(1);
      expect(audits[0]!.id).toBe("au_1");
    });

    it("saveProjectState overwrites the snapshot in place", async () => {
      await adapter.createProject(makeState(), makeAudit("au_1"));
      const updated = makeState({
        project: {
          id: "proj_p1",
          name: "Renamed",
          status: "sources_uploaded",
          created_at: "2026-01-01T00:00:00.000Z",
          created_by: "user_demo",
        },
      } as Partial<core.ProjectState>);
      await adapter.saveProjectState(updated);
      const fetched = await adapter.getProjectState("proj_p1");
      expect(fetched!.project.name).toBe("Renamed");
      expect(fetched!.project.status).toBe("sources_uploaded");
    });

    it("appendAuditLog refuses duplicate ids (APPEND-ONLY)", async () => {
      await adapter.createProject(makeState(), makeAudit("au_1"));
      await expect(
        adapter.appendAuditLog("proj_p1", makeAudit("au_1")),
      ).rejects.toBeInstanceOf(AppendOnlyViolationError);
      // After the rejection the original entry is unchanged + the only one.
      const audits = await adapter.listAuditLogs("proj_p1");
      expect(audits).toHaveLength(1);
      expect(audits[0]!.id).toBe("au_1");
    });

    it("appendAuditLog with unique id appends to the end, preserving order", async () => {
      await adapter.createProject(makeState(), makeAudit("au_1"));
      await adapter.appendAuditLog("proj_p1", makeAudit("au_2"));
      await adapter.appendAuditLog("proj_p1", makeAudit("au_3"));
      const audits = await adapter.listAuditLogs("proj_p1");
      expect(audits.map((a) => a.id)).toEqual(["au_1", "au_2", "au_3"]);
    });

    it("appendDecisionHistory refuses duplicate ids (APPEND-ONLY)", async () => {
      await adapter.createProject(makeState(), makeAudit("au_1"));
      const entry = makeHistory("hist_1");
      await adapter.appendDecisionHistory("proj_p1", entry);
      await expect(
        adapter.appendDecisionHistory("proj_p1", makeHistory("hist_1")),
      ).rejects.toBeInstanceOf(AppendOnlyViolationError);
      const list = await adapter.listDecisionHistory("proj_p1");
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe("hist_1");
    });

    it("appendDecisionHistory preserves insertion order across multiple appends", async () => {
      await adapter.createProject(makeState(), makeAudit("au_1"));
      await adapter.appendDecisionHistory("proj_p1", makeHistory("h1"));
      await adapter.appendDecisionHistory("proj_p1", makeHistory("h2", "proj_p1", "ic_b"));
      await adapter.appendDecisionHistory("proj_p1", makeHistory("h3"));
      const list = await adapter.listDecisionHistory("proj_p1");
      expect(list.map((h) => h.id)).toEqual(["h1", "h2", "h3"]);
    });

    it("resetDemoStore drops every project, audit, and history entry", async () => {
      await adapter.createProject(makeState(), makeAudit("au_1"));
      await adapter.appendDecisionHistory("proj_p1", makeHistory("h1"));
      expect((await adapter.listProjects()).length).toBe(1);
      await adapter.resetDemoStore();
      expect(await adapter.listProjects()).toEqual([]);
      expect(await adapter.getProjectState("proj_p1")).toBeNull();
      expect(await adapter.listAuditLogs("proj_p1")).toEqual([]);
      expect(await adapter.listDecisionHistory("proj_p1")).toEqual([]);
    });

    it("survives a fresh adapter instance pointed at the same storage", async () => {
      if (!factory.rebuild) return;
      await adapter.createProject(makeState(), makeAudit("au_1"));
      await adapter.appendAuditLog("proj_p1", makeAudit("au_2"));
      await adapter.appendDecisionHistory("proj_p1", makeHistory("h1"));

      const reborn = await factory.rebuild();
      const summaries = await reborn.listProjects();
      expect(summaries.map((s) => s.id)).toEqual(["proj_p1"]);
      const state = await reborn.getProjectState("proj_p1");
      expect(state!.project.name).toBe("Adapter Test Project");
      const audits = await reborn.listAuditLogs("proj_p1");
      expect(audits.map((a) => a.id)).toEqual(["au_1", "au_2"]);
      const history = await reborn.listDecisionHistory("proj_p1");
      expect(history.map((h) => h.id)).toEqual(["h1"]);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Run the contract suite against each adapter implementation.
// ─────────────────────────────────────────────────────────────────────

describe("MemoryPersistenceAdapter", () => {
  runContract(async () => memoryFactory());
});

describe("FilePersistenceAdapter", () => {
  runContract(async () => fileFactory());

  // ── File-adapter-specific assertions ──────────────────────────

  it("appendAuditLog rebuild reads existing JSONL so duplicate detection works across instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contractops-persist-"));
    try {
      const first = new FilePersistenceAdapter(dir);
      await first.createProject(makeState(), makeAudit("au_1"));
      await first.appendAuditLog("proj_p1", makeAudit("au_2"));

      const second = new FilePersistenceAdapter(dir);
      // Same id MUST be rejected on the new instance — the in-memory id
      // set is populated from disk on first use.
      await expect(
        second.appendAuditLog("proj_p1", makeAudit("au_1")),
      ).rejects.toBeInstanceOf(AppendOnlyViolationError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never writes anything that looks like a DOCX binary (PK\\x03\\x04 magic)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contractops-persist-"));
    try {
      const a = new FilePersistenceAdapter(dir);
      const state = makeState({
        // Simulate an ExportFile being recorded into ProjectState. The
        // workflow stores TEXT only — never the binary. We add a textual
        // ExportFile.content with the literal string "[CLEAN_DOCX]" to
        // make sure the JSON file is text and never contains the PK
        // magic bytes that would indicate raw DOCX bytes.
        exports: [
          {
            id: "ef_1",
            project_id: "proj_p1",
            contract_version_id: "cv_1",
            export_type: "clean_docx",
            content: "[CLEAN_DOCX] summary only — no binary here",
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "lawyer_demo",
            file_name: "demo_v1_clean.docx",
          },
        ],
      } as Partial<core.ProjectState>);
      await a.createProject(state, makeAudit("au_1"));

      const file = join(dir, "projects", "proj_p1.project.json");
      const bytes = await readFile(file);
      // PKZip magic = 0x50 0x4B 0x03 0x04. Search the raw bytes — the
      // JSON file is text so this 4-byte sequence must never appear.
      let found = false;
      for (let i = 0; i + 3 < bytes.length; i++) {
        if (
          bytes[i] === 0x50 &&
          bytes[i + 1] === 0x4b &&
          bytes[i + 2] === 0x03 &&
          bytes[i + 3] === 0x04
        ) {
          found = true;
          break;
        }
      }
      expect(found).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// createPersistenceAdapter — env validation
// ─────────────────────────────────────────────────────────────────────

describe("createPersistenceAdapter (factory + env config)", () => {
  it("returns the memory adapter when no PERSISTENCE_DRIVER is set", () => {
    const a = createPersistenceAdapter({});
    expect(a.driver).toBe("memory");
  });

  it("returns the memory adapter for an explicit empty value", () => {
    const a = createPersistenceAdapter({ driver: "" });
    expect(a.driver).toBe("memory");
  });

  it("returns the memory adapter for the explicit string 'memory'", () => {
    const a = createPersistenceAdapter({ driver: "memory" });
    expect(a.driver).toBe("memory");
    const aUpper = createPersistenceAdapter({ driver: "MEMORY" });
    expect(aUpper.driver).toBe("memory");
  });

  it("returns the file adapter when PERSISTENCE_DRIVER=file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contractops-persist-"));
    try {
      const a = createPersistenceAdapter({ driver: "file", filePath: dir });
      expect(a.driver).toBe("file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("THROWS for an unknown driver (do not silently fall back)", () => {
    expect(() => createPersistenceAdapter({ driver: "redis" })).toThrow(
      UnknownPersistenceDriverError,
    );
    expect(() => createPersistenceAdapter({ driver: "mysql" })).toThrow(
      UnknownPersistenceDriverError,
    );
  });

  it("THROWS for 'sqlite' (reserved for a future adapter)", () => {
    expect(() => createPersistenceAdapter({ driver: "sqlite" })).toThrow(
      UnknownPersistenceDriverError,
    );
  });
});
