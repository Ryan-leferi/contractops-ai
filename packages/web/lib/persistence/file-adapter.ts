/**
 * File-backed durable persistence adapter (Milestone 3E).
 *
 * Layout under `<root>/projects/`:
 *
 *   <project_id>.project.json   — full ProjectState snapshot (overwritten on save)
 *   <project_id>.audits.jsonl   — one AuditLog per line, append-only
 *   <project_id>.history.jsonl  — one IssueDecisionHistoryEntry per line, append-only
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ LOCAL DEV / DEMO ONLY.                                       │
 *   │   - No auth, no row-level permissions, no encryption.        │
 *   │   - Storage path is gitignored (`.contractops-data/`).       │
 *   │   - Generated `.docx` / `.md` binaries are NEVER written     │
 *   │     here — ExportFile.content is a text summary blurb.       │
 *   │   - Real confidential source documents MUST NOT be saved.    │
 *   │   - Future milestone will swap this for PostgreSQL behind    │
 *   │     the same `PersistenceAdapter` interface.                 │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * No new npm dependencies — pure Node `fs`. Append-only is enforced by:
 *   1. Each `appendAuditLog` / `appendDecisionHistory` call reads the
 *      existing JSONL once into a lazy in-memory `Set<string>` of ids.
 *   2. Membership is checked before `appendFile` runs. Duplicate id
 *      throws `AppendOnlyViolationError`.
 *
 * Concurrent multi-process writes are NOT safe (no fs lock). Single
 * Next.js server process per `PERSISTENCE_FILE_PATH` is the only
 * supported deployment.
 */
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";

import {
  AppendOnlyViolationError,
  type PersistenceAdapter,
  type ProjectSummary,
} from "./types";

const PROJECTS_SUBDIR = "projects";

interface SeenIds {
  loaded: boolean;
  ids: Set<string>;
}

export class FilePersistenceAdapter implements PersistenceAdapter {
  readonly driver = "file" as const;
  private readonly rootDir: string;
  private readonly auditSeen = new Map<string, SeenIds>();
  private readonly historySeen = new Map<string, SeenIds>();

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  // ── Read side ───────────────────────────────────────────────────

  async listProjects(): Promise<ProjectSummary[]> {
    const dir = this.projectsDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const summaries: ProjectSummary[] = [];
    for (const f of entries) {
      if (!f.endsWith(".project.json")) continue;
      const raw = await readFile(join(dir, f), "utf-8");
      const state = JSON.parse(raw) as core.ProjectState;
      summaries.push({
        id: state.project.id,
        name: state.project.name,
        status: state.project.status,
        created_at: state.project.created_at,
      });
    }
    summaries.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return summaries;
  }

  async getProjectState(id: string): Promise<core.ProjectState | null> {
    try {
      const raw = await readFile(this.projectStateFile(id), "utf-8");
      return JSON.parse(raw) as core.ProjectState;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async listAuditLogs(projectId: string): Promise<AuditLog[]> {
    return this.readJsonl<AuditLog>(this.auditFile(projectId));
  }

  async listDecisionHistory(projectId: string): Promise<IssueDecisionHistoryEntry[]> {
    return this.readJsonl<IssueDecisionHistoryEntry>(this.historyFile(projectId));
  }

  // ── Write side ──────────────────────────────────────────────────

  async saveProjectState(state: core.ProjectState): Promise<void> {
    const file = this.projectStateFile(state.project.id);
    await ensureDir(dirname(file));
    // Pretty-print so a developer eyeballing the file can read it. The
    // production swap to PostgreSQL replaces this entirely.
    await writeFile(file, JSON.stringify(state, null, 2) + "\n", "utf-8");
  }

  async createProject(state: core.ProjectState, creationAudit: AuditLog): Promise<void> {
    await this.saveProjectState(state);
    await this.appendAuditLog(state.project.id, creationAudit);
  }

  async appendAuditLog(projectId: string, entry: AuditLog): Promise<void> {
    const seen = await this.loadSeen(projectId, "audit");
    if (seen.has(entry.id)) {
      throw new AppendOnlyViolationError("audit", projectId, entry.id);
    }
    const file = this.auditFile(projectId);
    await ensureDir(dirname(file));
    await appendFile(file, JSON.stringify(entry) + "\n", "utf-8");
    seen.add(entry.id);
  }

  async appendDecisionHistory(
    projectId: string,
    entry: IssueDecisionHistoryEntry,
  ): Promise<void> {
    const seen = await this.loadSeen(projectId, "decision_history");
    if (seen.has(entry.id)) {
      throw new AppendOnlyViolationError("decision_history", projectId, entry.id);
    }
    const file = this.historyFile(projectId);
    await ensureDir(dirname(file));
    await appendFile(file, JSON.stringify(entry) + "\n", "utf-8");
    seen.add(entry.id);
  }

  async resetDemoStore(): Promise<void> {
    try {
      await rm(this.projectsDir(), { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.auditSeen.clear();
    this.historySeen.clear();
  }

  // ── Internals ──────────────────────────────────────────────────

  private projectsDir(): string {
    return join(this.rootDir, PROJECTS_SUBDIR);
  }
  private projectStateFile(id: string): string {
    return join(this.projectsDir(), `${safeName(id)}.project.json`);
  }
  private auditFile(id: string): string {
    return join(this.projectsDir(), `${safeName(id)}.audits.jsonl`);
  }
  private historyFile(id: string): string {
    return join(this.projectsDir(), `${safeName(id)}.history.jsonl`);
  }

  private async readJsonl<T>(file: string): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(file, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    if (!raw.trim()) return [];
    const out: T[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      out.push(JSON.parse(trimmed) as T);
    }
    return out;
  }

  private async loadSeen(
    projectId: string,
    kind: "audit" | "decision_history",
  ): Promise<Set<string>> {
    const cache = kind === "audit" ? this.auditSeen : this.historySeen;
    let entry = cache.get(projectId);
    if (!entry) {
      entry = { loaded: false, ids: new Set() };
      cache.set(projectId, entry);
    }
    if (entry.loaded) return entry.ids;
    const file =
      kind === "audit" ? this.auditFile(projectId) : this.historyFile(projectId);
    const list = await this.readJsonl<{ id: string }>(file);
    for (const item of list) entry.ids.add(item.id);
    entry.loaded = true;
    return entry.ids;
  }
}

/**
 * Restrict project-id-derived file names to a safe subset. Project ids
 * are short alphanumerics from `createCounterIdGenerator` or crypto
 * UUIDs; this is belt-and-suspenders against a future id format that
 * could contain path-separator characters.
 */
function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_");
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
