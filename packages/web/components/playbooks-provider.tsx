"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Playbook } from "@contractops/schemas";

interface PlaybooksContextValue {
  playbooks: Playbook[] | null;
  loading: boolean;
  error: string | null;
}

const PlaybooksContext = createContext<PlaybooksContextValue>({
  playbooks: null,
  loading: true,
  error: null,
});

export function PlaybooksProvider({ children }: { children: ReactNode }) {
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/playbooks")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        setPlaybooks(Array.isArray(data.playbooks) ? data.playbooks : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setPlaybooks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PlaybooksContext.Provider value={{ playbooks, loading, error }}>
      {children}
    </PlaybooksContext.Provider>
  );
}

export function usePlaybooks(): PlaybooksContextValue {
  return useContext(PlaybooksContext);
}
