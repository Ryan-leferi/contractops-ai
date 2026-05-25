"use client";

import { useState } from "react";
import { useStore } from "@/components/store-provider";
import {
  DEFAULT_DEMO_ACTOR_ID,
  DEMO_ACTOR_IDS,
  DEMO_ACTOR_REGISTRY,
  type DemoActorId,
} from "@/lib/demo-actors";

/**
 * Demo actor selector (Milestones 3F + 3I).
 *
 * Renders in the global header. Lets a demo user switch which actor
 * the server will resolve from the session cookie for subsequent
 * operations.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NOT AUTHENTICATION — there is no password, no token, no real │
 *   │ RBAC. The picker writes a cookie that the server validates   │
 *   │ against a hardcoded registry, and the role on that record    │
 *   │ is the entirety of authorization. ADR-016 documents the      │
 *   │ migration path to real auth.                                  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Switching is an async server roundtrip (`POST /api/auth/demo/actor`).
 * While in flight the dropdown is disabled — Playwright's
 * `waitForStoreIdle` covers this hand-shake because `setActorId`
 * bumps the in-flight counter in `StoreProvider`.
 */
export function ActorSelector() {
  const { session, setActorId } = useStore();
  // Pre-session fallback: show the demo default so the header doesn't
  // flicker. The actual cookie / server state catches up within a tick.
  const actorId =
    (session?.actor.id as DemoActorId | undefined) ?? DEFAULT_DEMO_ACTOR_ID;
  const actor = session?.actor ?? DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID];
  const [switching, setSwitching] = useState(false);

  async function handleChange(next: DemoActorId) {
    setSwitching(true);
    try {
      await setActorId(next);
    } catch (err) {
      // Surface in dev console; the UI stays on whatever the previous
      // server-confirmed actor was. A future milestone could show a
      // toast.
      // eslint-disable-next-line no-console
      console.error("ActorSelector setActor failed:", err);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div
      className="flex items-center gap-2 border rounded px-2 py-1 bg-muted/40"
      data-testid="actor-selector"
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide bg-warning/20 text-warning px-1.5 py-0.5 rounded"
        title="This is a demo name-picker, not authentication. The server resolves the actor from the contractops_demo_actor cookie against a hardcoded registry; a future milestone replaces it with real auth + RBAC."
      >
        Demo
      </span>
      <label htmlFor="actor-selector-input" className="sr-only">
        Acting as
      </label>
      <span className="text-xs text-muted-foreground">Acting as</span>
      <select
        id="actor-selector-input"
        value={actorId}
        disabled={switching}
        onChange={(e) => {
          void handleChange(e.target.value as DemoActorId);
        }}
        className="text-xs bg-background border rounded px-1 py-0.5 disabled:opacity-60"
        data-testid="actor-selector-input"
      >
        {DEMO_ACTOR_IDS.map((id) => (
          <option key={id} value={id}>
            {DEMO_ACTOR_REGISTRY[id].display_name ?? id}
          </option>
        ))}
      </select>
      <span
        className={
          "text-[10px] px-1.5 py-0.5 rounded font-medium " +
          (actor.role === "human_lawyer"
            ? "bg-success/20 text-success"
            : "bg-muted text-muted-foreground")
        }
        data-testid="actor-selector-role"
      >
        {actor.role === "human_lawyer" ? "Lawyer" : "Business"}
      </span>
    </div>
  );
}
