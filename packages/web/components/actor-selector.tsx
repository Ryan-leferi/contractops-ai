"use client";

import { useStore } from "@/components/store-provider";
import {
  DEMO_ACTOR_IDS,
  DEMO_ACTOR_REGISTRY,
  type DemoActorId,
} from "@/lib/demo-actors";

/**
 * Demo actor selector (Milestone 3F).
 *
 * Renders in the global header. Lets a demo user switch which actor
 * the next API call will be attributed to. NOT AUTHENTICATION — there
 * is no password, no session, no real RBAC. The server validates the
 * picked id against a hardcoded registry (`lib/demo-actors.ts`) and
 * the role on that record is the entirety of authorization.
 *
 * The selector visually marks itself as demo with a "DEMO" badge and
 * displays the picked actor's role next to their name so the user
 * always knows whether the next click will satisfy the lawyer-only
 * guards in core.
 */
export function ActorSelector() {
  const { actorId, setActorId } = useStore();
  const actor = DEMO_ACTOR_REGISTRY[actorId];

  return (
    <div
      className="flex items-center gap-2 border rounded px-2 py-1 bg-muted/40"
      data-testid="actor-selector"
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide bg-warning/20 text-warning px-1.5 py-0.5 rounded"
        title="This is a demo name-picker, not authentication. Server validates the id against a hardcoded registry; a future milestone replaces it with real auth + RBAC."
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
        onChange={(e) => setActorId(e.target.value as DemoActorId)}
        className="text-xs bg-background border rounded px-1 py-0.5"
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
