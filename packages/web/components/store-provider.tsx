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
  type DemoActorId,
} from "@/lib/demo-actors";
import type { Actor } from "@contractops/schemas";

/**
 * API-backed application store (Milestones 3D + 3I).
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
 * Actor / session (Milestone 3I): the selected demo actor lives in a
 * server-side cookie (`contractops_demo_actor`). The client never sends
 * `actor_id` in the operation body — the server resolves the actor from
 * the cookie via the auth boundary and stamps it on the audit + history
 * entries. The header dropdown calls `POST /api/auth/demo/actor` to
 * switch; the rest of the UI reads `session.actor` from this provider.
 *
 * localStorage is no longer used for project data OR actor selection.
 * Different browser contexts get independent cookie jars naturally, so
 * a multi-actor demo with three browsers requires no special setup.
 */

interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

interface SessionState {
  actor: Actor;
  source: "demo_cookie" | "demo_default";
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
   * Currently authenticated demo actor (Milestone 3I). `null` while
   * the initial `GET /api/auth/session` is still in flight. Once
   * hydrated, every value comes from the server — the client never
   * picks an actor in isolation.
   *
   * NOT AUTHENTICATION. A name-picker for the demo only; documented
   * in `lib/auth/types.ts` and the README "Auth boundary" section.
   */
  session: SessionState | null;
  /** Convenience: id of the current actor, or null pre-hydration. */
  actorId: DemoActorId | null;
  /**
   * Switch the demo actor. Calls `POST /api/auth/demo/actor` which
   * validates the id against the registry and sets the session
   * cookie. The local `session` state then mirrors what the server
   * returned. Throws on a 4xx response.
   */
  setActorId: (id: DemoActorId) => Promise<void>;
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
): Promise<{ state: core.ProjectState; audits: S.AuditLog[] }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Milestone 3I — no actor_id in body. Server reads the cookie.
    body: JSON.stringify({ name }),
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
): Promise<{ state: core.ProjectState; audits: S.AuditLog[] }> {
  const res = await fetch(`/api/projects/${projectId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Milestone 3I — no actor_id in body. Server reads the cookie.
    body: JSON.stringify(op),
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

async function apiGetSession(): Promise<SessionState> {
  const res = await fetch("/api/auth/session", {
    // Defensive: keep the response uncached so a switch in another
    // tab is reflected on the next mount.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GET /api/auth/session failed: HTTP ${res.status}`);
  }
  return (await res.json()) as SessionState;
}

async function apiSetActor(actorId: DemoActorId): Promise<SessionState> {
  const res = await fetch("/api/auth/demo/actor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor_id: actorId }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(`POST /api/auth/demo/actor failed: ${detail}`);
  }
  return (await res.json()) as SessionState;
}

// ───────────────────────────────────────────────────────────────────────
// Provider
// ───────────────────────────────────────────────────────────────────────

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<AppStore>(emptyStore);
  const storeRef = useRef<AppStore>(store);
  storeRef.current = store;
  const [hydrated, setHydrated] = useState(false);

  // Session (Milestone 3I). `null` until the first GET /api/auth/session
  // lands; we render before that so the page shell paints, but
  // `useCurrentActor` returns null in that window and lawyer-only
  // affordances stay disabled.
  const [session, setSession] = useState<SessionState | null>(null);
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

  // Initial hydration on mount — fetch projects AND the session.
  // Both bump in-flight so `waitForStoreIdle` in Playwright covers
  // both hand-shakes. Failures are logged but don't crash; the empty
  // shell stays visible and pages render their own error states.
  useEffect(() => {
    bumpInFlight(1);
    apiGetSession()
      .then((s) => setSession(s))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("StoreProvider session fetch failed:", err);
      })
      .finally(() => bumpInFlight(-1));
    refreshProjects()
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("StoreProvider initial fetch failed:", err);
      })
      .finally(() => setHydrated(true));
  }, [refreshProjects]);

  const applyProjectOp = useCallback<StoreContextValue["applyProjectOp"]>(
    async (projectId, op) => {
      bumpInFlight(1);
      try {
        const { state, audits } = await apiOperation(projectId, op);
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
        const { state, audits } = await apiCreate(name);
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

  const setActorId = useCallback<StoreContextValue["setActorId"]>(
    async (id) => {
      bumpInFlight(1);
      try {
        const next = await apiSetActor(id);
        setSession(next);
      } finally {
        bumpInFlight(-1);
      }
    },
    [],
  );

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
        session,
        actorId: (session?.actor.id as DemoActorId | undefined) ?? null,
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
 * Resolve the currently authenticated demo actor (Milestone 3I).
 * Returns `null` during the brief window before the initial
 * `GET /api/auth/session` lands — pages MUST treat that as "no
 * actor yet" and keep lawyer-only affordances disabled.
 *
 * The server still re-checks the role on every operation; this
 * hook only powers the UX guard. (See `canActAsLawyer` in
 * `lib/demo-actors.ts` for the predicate.)
 */
export function useCurrentActor(): Actor | null {
  const { session } = useStore();
  return session?.actor ?? null;
}

/**
 * The actor object the StoreProvider falls back to before the
 * session lands. Exported so a future SSR / loading state can
 * render the same display name the server would have picked.
 */
export const PRE_HYDRATION_FALLBACK_ACTOR: Actor =
  DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID];

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
