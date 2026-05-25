"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type * as S from "@contractops/schemas";
import type * as core from "@contractops/core";
import { emptyStore, type AppStore } from "@/lib/actions";
import type { Operation } from "@/lib/operations";
import {
  DEFAULT_DEMO_ACTOR_ID,
  DEMO_ACTOR_REGISTRY,
  isKnownDemoActorId,
  type DemoActorId,
} from "@/lib/demo-actors";
import type { Actor } from "@contractops/schemas";

const ACTOR_STORAGE_KEY = "contractops:demo-actor";

/**
 * API-backed application store (Milestone 3D).
 *
 * Replaces the old browser-localStorage-only StoreProvider with one that
 * fetches ProjectState from the server's in-memory store via:
 *
 *   GET  /api/projects                              — project summaries
 *   GET  /api/projects/[id]                         — single ProjectState + audits
 *   POST /api/projects                              — create project
 *   POST /api/projects/[id]/operations              — apply Operation descriptor
 *   POST /api/projects/reset                        — dev/demo reset
 *
 * The browser keeps a React-state cache for synchronous rendering, but the
 * server is the source of truth. Multi-session demo: a second browser
 * context can `refreshProject(id)` (or simply navigate to the page) to see
 * changes made elsewhere.
 *
 * localStorage is no longer used at all — the previous v4 key is left
 * orphaned in users' browsers; that's harmless. The server in-memory
 * store resets on server restart and is documented as non-production in
 * README. Future milestone will swap in PostgreSQL or another durable DB.
 */

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface StoreContextValue {
  hydrated: boolean;
  store: AppStore;
  applyProjectOp: (projectId: string, op: Operation) => Promise<void>;
  /** POST /api/projects → returns the new project's id. */
  createProject: (name: string) => Promise<string>;
  /** POST /api/projects/reset (dev/demo only) and rehydrate. */
  resetStore: () => Promise<void>;
  /** Re-fetch one project's full state + audits (multi-session). */
  refreshProject: (projectId: string) => Promise<void>;
  /** Re-fetch the list of projects (and lazily populate any missing). */
  refreshProjects: () => Promise<void>;
  /**
   * Currently selected demo actor (Milestone 3F). Every API call sends
   * `actor_id` so the server attributes the action correctly. The
   * server validates the id against the demo registry — unknown ids
   * are rejected with HTTP 400.
   *
   * NOT AUTHENTICATION. This is a name-picker for the demo only.
   */
  actorId: DemoActorId;
  setActorId: (id: DemoActorId) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

// ───────────────────────────────────────────────────────────────────────
// HTTP helpers
// ───────────────────────────────────────────────────────────────────────

async function apiList(): Promise<ProjectSummary[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error(`GET /api/projects failed: HTTP ${res.status}`);
  const body = (await res.json()) as { projects: ProjectSummary[] };
  return body.projects;
}

async function apiGet(
  id: string,
): Promise<{ state: core.ProjectState; audits: S.AuditLog[] }> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) throw new Error(`GET /api/projects/${id} failed: HTTP ${res.status}`);
  return (await res.json()) as { state: core.ProjectState; audits: S.AuditLog[] };
}

async function apiCreate(
  name: string,
  actorId: DemoActorId,
): Promise<{ state: core.ProjectState; audits: S.AuditLog[] }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, actor_id: actorId }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(`POST /api/projects failed: ${detail}`);
  }
  return (await res.json()) as { state: core.ProjectState; audits: S.AuditLog[] };
}

async function apiOperation(
  projectId: string,
  op: Operation,
  actorId: DemoActorId,
): Promise<{ state: core.ProjectState; audits: S.AuditLog[] }> {
  const res = await fetch(`/api/projects/${projectId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...op, actor_id: actorId }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(`operation '${op.name}' failed: ${detail}`);
  }
  return (await res.json()) as { state: core.ProjectState; audits: S.AuditLog[] };
}

async function apiReset(): Promise<void> {
  const res = await fetch("/api/projects/reset", { method: "POST" });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(`reset failed: ${detail}`);
  }
}

// ───────────────────────────────────────────────────────────────────────
// Provider
// ───────────────────────────────────────────────────────────────────────

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<AppStore>(emptyStore);
  const storeRef = useRef<AppStore>(store);
  storeRef.current = store;
  const [hydrated, setHydrated] = useState(false);

  // Selected demo actor (Milestone 3F). Hydrates from localStorage on
  // mount; falls back to the registry default. NEVER trusted by the
  // server — every request re-validates the id against the registry.
  const [actorId, setActorIdState] = useState<DemoActorId>(DEFAULT_DEMO_ACTOR_ID);
  const actorIdRef = useRef<DemoActorId>(actorId);
  actorIdRef.current = actorId;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACTOR_STORAGE_KEY);
    if (stored && isKnownDemoActorId(stored)) {
      setActorIdState(stored);
      actorIdRef.current = stored;
    }
  }, []);
  const setActorId = useCallback((id: DemoActorId) => {
    setActorIdState(id);
    actorIdRef.current = id;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTOR_STORAGE_KEY, id);
    }
  }, []);
  // Track the number of in-flight API operations and mirror it onto a DOM
  // attribute on <html>. Playwright tests use this to wait deterministically
  // for asynchronous mutations to land — `data-ops-in-flight="0"` means the
  // UI has settled and is safe to interact with again.
  const inFlightRef = useRef(0);
  function bumpInFlight(delta: number) {
    inFlightRef.current = Math.max(0, inFlightRef.current + delta);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.opsInFlight = String(inFlightRef.current);
    }
  }

  function commit(next: AppStore) {
    storeRef.current = next;
    setStore(next);
  }

  /**
   * Merge a fetched project + its audits into the local cache, replacing
   * any previous copy of the same project. Audit list is filtered to
   * remove old entries for this project before appending the new ones —
   * the server-returned list is the authoritative copy.
   */
  function upsertProject(
    state: core.ProjectState,
    audits: S.AuditLog[],
  ): AppStore {
    const current = storeRef.current;
    const id = state.project.id;
    const projectIds = current.projectIds.includes(id)
      ? current.projectIds
      : [...current.projectIds, id];
    const otherAudits = current.audits.filter((a) => a.project_id !== id);
    return {
      projectIds,
      projects: { ...current.projects, [id]: state },
      audits: [...otherAudits, ...audits],
    };
  }

  const refreshProject = useCallback<StoreContextValue["refreshProject"]>(
    async (projectId) => {
      bumpInFlight(1);
      try {
        const { state, audits } = await apiGet(projectId);
        commit(upsertProject(state, audits));
      } finally {
        bumpInFlight(-1);
      }
    },
    [],
  );

  const refreshProjects = useCallback<StoreContextValue["refreshProjects"]>(
    async () => {
      bumpInFlight(1);
      try {
        const summaries = await apiList();
        // Fetch full state for each summary that we don't already have, in
        // parallel. Tiny MVP set so this is OK; future milestone may move
        // to lazy per-page fetch.
        const idsToFetch = summaries
          .map((s) => s.id)
          .filter((id) => !storeRef.current.projects[id]);
        const fetched = await Promise.all(idsToFetch.map((id) => apiGet(id)));
        let next: AppStore = {
          projectIds: summaries.map((s) => s.id),
          projects: { ...storeRef.current.projects },
          audits: storeRef.current.audits.slice(),
        };
        for (const { state, audits } of fetched) {
          next = mergeInto(next, state, audits);
        }
        commit(next);
      } finally {
        bumpInFlight(-1);
      }
    },
    [],
  );

  // Initial hydration on mount.
  useEffect(() => {
    refreshProjects()
      .catch((err) => {
        // Surface in dev console but don't crash. Empty store stays
        // visible; the UI shows "no projects" or per-page errors.
        // eslint-disable-next-line no-console
        console.error("StoreProvider initial fetch failed:", err);
      })
      .finally(() => setHydrated(true));
  }, [refreshProjects]);

  const applyProjectOp = useCallback<StoreContextValue["applyProjectOp"]>(
    async (projectId, op) => {
      bumpInFlight(1);
      try {
        const { state, audits } = await apiOperation(
          projectId,
          op,
          actorIdRef.current,
        );
        commit(upsertProject(state, audits));
        // Server returns ONLY the audits emitted by this operation. We
        // already wiped this project's audits and re-appended them — see
        // upsertProject. To preserve the full audit log we re-fetch the
        // project so the local cache holds every historical entry too.
        await refreshProject(projectId);
      } finally {
        bumpInFlight(-1);
      }
    },
    [refreshProject],
  );

  const createProject = useCallback<StoreContextValue["createProject"]>(
    async (name) => {
      bumpInFlight(1);
      try {
        const { state, audits } = await apiCreate(name, actorIdRef.current);
        commit(upsertProject(state, audits));
        return state.project.id;
      } finally {
        bumpInFlight(-1);
      }
    },
    [],
  );

  const resetStore = useCallback<StoreContextValue["resetStore"]>(async () => {
    bumpInFlight(1);
    try {
      await apiReset();
      commit(emptyStore());
      await refreshProjects();
    } finally {
      bumpInFlight(-1);
    }
  }, [refreshProjects]);

  return (
    <StoreContext.Provider
      value={{
        hydrated,
        store,
        applyProjectOp,
        createProject,
        resetStore,
        refreshProject,
        refreshProjects,
        actorId,
        setActorId,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

/** Convenience selector for the audit logs of a single project. */
export function useProjectAudits(projectId: string): S.AuditLog[] {
  const { store } = useStore();
  return store.audits.filter((a) => a.project_id === projectId);
}

/**
 * Resolve the currently selected demo actor id to the full Actor object
 * from the registry (Milestone 3G). Pages use this to make role-aware
 * decisions in the UI — e.g. disabling lawyer-only buttons when the
 * selected actor is not a `human_lawyer`. The server still re-checks
 * the role on every operation; this hook only powers the UX guard.
 */
export function useCurrentActor(): Actor {
  const { actorId } = useStore();
  return DEMO_ACTOR_REGISTRY[actorId];
}

// ───────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────

function mergeInto(
  next: AppStore,
  state: core.ProjectState,
  audits: S.AuditLog[],
): AppStore {
  const id = state.project.id;
  return {
    projectIds: next.projectIds.includes(id)
      ? next.projectIds
      : [...next.projectIds, id],
    projects: { ...next.projects, [id]: state },
    audits: [...next.audits.filter((a) => a.project_id !== id), ...audits],
  };
}
