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
import {
  createLocalStorageAppendOnlyRepository,
  createLocalStorageRepository,
} from "@/lib/localstorage-repository";
import { emptyStore, type AppStore } from "@/lib/actions";

const PROJECTS_KEY = "contractops:projects:v3";
const AUDITS_KEY = "contractops:audits:v3";

interface StoreContextValue {
  hydrated: boolean;
  store: AppStore;
  /**
   * Apply an aggregate op against a single project. The op may be sync or
   * async (agent-backed). Returns a Promise so callers can await + catch.
   */
  applyProjectOp: (
    projectId: string,
    op: (state: core.ProjectState) => core.AggregateResult | Promise<core.AggregateResult>,
  ) => Promise<void>;
  createProject: (op: () => core.AggregateResult) => string;
  resetStore: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

const projectRepo = createLocalStorageRepository<core.ProjectState>(
  PROJECTS_KEY,
  (p) => p.project.id,
);
const auditRepo = createLocalStorageAppendOnlyRepository<S.AuditLog>(
  AUDITS_KEY,
  (a) => a.id,
);

function loadAppStore(): AppStore {
  const list = projectRepo.list();
  const projects: Record<string, core.ProjectState> = {};
  for (const p of list) projects[p.project.id] = p;
  const audits = auditRepo.list();
  const ids = list
    .slice()
    .sort((a, b) => a.project.created_at.localeCompare(b.project.created_at))
    .map((p) => p.project.id);
  return { projectIds: ids, projects, audits };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<AppStore>(emptyStore);
  const storeRef = useRef<AppStore>(store);
  storeRef.current = store;
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadAppStore();
    storeRef.current = loaded;
    setStore(loaded);
    setHydrated(true);
  }, []);

  const applyProjectOp = useCallback<StoreContextValue["applyProjectOp"]>(
    async (projectId, op) => {
      const current = storeRef.current.projects[projectId];
      if (!current) throw new Error(`Project ${projectId} not found`);

      // op may return sync or Promise. await handles both.
      const { state: next, audits } = await op(current);

      projectRepo.put(next);
      for (const a of audits) auditRepo.append(a);

      const newStore: AppStore = {
        ...storeRef.current,
        projects: { ...storeRef.current.projects, [projectId]: next },
        audits: [...storeRef.current.audits, ...audits],
      };
      storeRef.current = newStore;
      setStore(newStore);
    },
    [],
  );

  const createProject = useCallback<StoreContextValue["createProject"]>((op) => {
    const { state, audits } = op();
    projectRepo.put(state);
    for (const a of audits) auditRepo.append(a);
    const id = state.project.id;
    const newStore: AppStore = {
      projectIds: [...storeRef.current.projectIds, id],
      projects: { ...storeRef.current.projects, [id]: state },
      audits: [...storeRef.current.audits, ...audits],
    };
    storeRef.current = newStore;
    setStore(newStore);
    return id;
  }, []);

  const resetStore = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PROJECTS_KEY);
      window.localStorage.removeItem(AUDITS_KEY);
    }
    const empty = emptyStore();
    storeRef.current = empty;
    setStore(empty);
  }, []);

  return (
    <StoreContext.Provider
      value={{ hydrated, store, applyProjectOp, createProject, resetStore }}
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
