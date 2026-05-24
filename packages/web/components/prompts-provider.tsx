"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setPromptTemplate } from "@contractops/core";

/**
 * Loads prompt templates from /api/prompts at startup and injects them into
 * core's prompt cache via `setPromptTemplate`. The role agents call
 * `loadPromptTemplate(id)` which finds the cached text rather than touching
 * the filesystem (which would be browser-incompatible).
 */

interface PromptsContextValue {
  loaded: boolean;
  error: string | null;
}

const PromptsContext = createContext<PromptsContextValue>({ loaded: false, error: null });

export function PromptsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/prompts")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        }
        const prompts: Record<string, string> = data.prompts ?? {};
        for (const [id, text] of Object.entries(prompts)) {
          setPromptTemplate(id, text);
        }
        setLoaded(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Gate child rendering until prompts are populated, so any agent-backed
  // action a user clicks finds the cache primed. The window is small (~100ms
  // on dev) and aligned with the StoreProvider's hydration gap.
  if (!loaded) {
    return (
      <div className="max-w-7xl mx-auto p-6 text-sm text-muted-foreground">
        Loading prompts…
      </div>
    );
  }

  return (
    <PromptsContext.Provider value={{ loaded, error }}>{children}</PromptsContext.Provider>
  );
}

export function usePrompts(): PromptsContextValue {
  return useContext(PromptsContext);
}
