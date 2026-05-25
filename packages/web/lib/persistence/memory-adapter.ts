/**
 * In-memory persistence adapter (Milestone 3E).
 *
 * The Milestone 3D server-store's `Map<projectId, ProjectState>` lives
 * here now, behind the PersistenceAdapter interface. The Map is pinned
 * on `globalThis` so Next.js dev HMR rebuilds do not lose state between
 * route module re-evaluations — same trick as 3D.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NOT FOR PRODUCTION.                                          │
 *   │   - Resets on every server restart.                          │
 *   │   - No durability, no replication, no auth.                  │
 *   │   - Used by CI and by default `npm run dev`. Switch to       │
 *   │     PERSISTENCE_DRIVER=file for a durable local dev run.     │
 *   └──────────────────────────────────────────────────────────────┘
 */
import type * as core from "@contractops/core";
import type { AuditLog, IssueDecisionHistoryEntry } from "@contractops/schemas";

import {
  AppendOnlyViolationError,
  type PersistenceAdapter,
  type ProjectSummary,
} from "./types";

interface MemoryState {
  projects: Map<string, core.ProjectState>;
  audits: Map<string, AuditLog[]>;
  /**
   * Independent decision history journal. ProjectState also carries the
   * full history (the workflow keeps `state.decision_history` populated)
   * but storing it separately lets `appendDecisionHistory` enforce the
   * append-only contract without inspecting the blob.
   */
  history: Map<string, IssueDecisionHistoryEntry[]>;
}

const GLOBAL_KEY = "__contractops_persistence_memory_v1__";

function loadOrCreate(): MemoryState {
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as MemoryState | undefined;
  if (existing) return existing;
  const fresh: MemoryState = {
    projects: new Map(),
    audits: new Map(),
    history: new Map(),
  };
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

export class MemoryPersistenceAdapter implements PersistenceAdapter {
  readonly driver = "memory" as const;
  private state: MemoryState;

  constructor() {
    this.state = loadOrCreate();
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return Array.from(this.state.projects.values())
      .sort((a, b) => a.project.created_at.localeCompare(b.project.created_at))
      .map((p) => ({
        id: p.project.id,
        name: p.project.name,
        status: p.project.status,
        created_at: p.project.created_at,
      }));
  }

  async getProjectState(id: string): Promise<core.ProjectState | null> {
    return this.state.projects.get(id) ?? null;
  }

  async saveProjectState(state: core.ProjectState): Promise<void> {
    this.state.projects.set(state.project.id, state);
  }

  async createProject(state: core.ProjectState, creationAudit: AuditLog): Promise<void> {
    this.state.projects.set(state.project.id, state);
    this.state.audits.set(state.project.id, [creationAudit]);
  }

  async appendAuditLog(projectId: string, entry: AuditLog): Promise<void> {
    const existing = this.state.audits.get(projectId) ?? [];
    if (existing.some((a) => a.id === entry.id)) {
      throw new AppendOnlyViolationError("audit", projectId, entry.id);
    }
    this.state.audits.set(projectId, [...existing, entry]);
  }

  async listAuditLogs(projectId: string): Promise<AuditLog[]> {
    return (this.state.audits.get(projectId) ?? []).slice();
  }

  async appendDecisionHistory(
    projectId: string,
    entry: IssueDecisionHistoryEntry,
  ): Promise<void> {
    const existing = this.state.history.get(projectId) ?? [];
    if (existing.some((h) => h.id === entry.id)) {
      throw new AppendOnlyViolationError("decision_history", projectId, entry.id);
    }
    this.state.history.set(projectId, [...existing, entry]);
  }

  async listDecisionHistory(projectId: string): Promise<IssueDecisionHistoryEntry[]> {
    return (this.state.history.get(projectId) ?? []).slice();
  }

  async resetDemoStore(): Promise<void> {
    this.state.projects.clear();
    this.state.audits.clear();
    this.state.history.clear();
  }
}
