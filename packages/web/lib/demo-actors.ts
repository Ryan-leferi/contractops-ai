/**
 * Demo actor registry (Milestone 3F).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ DEMO ONLY — NOT AUTHENTICATION.                              │
 *   │   - Pick-a-name dropdown, no password, no SSO, no OAuth.     │
 *   │   - Backend validates the chosen id against THIS hardcoded   │
 *   │     registry — that's the entirety of "authorization".        │
 *   │   - Real auth + RBAC arrives in a future milestone (PR-grade  │
 *   │     identity provider, server-issued session tokens, etc.).   │
 *   │     Until then, do not deploy this app to a public URL.       │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The registry has three demo actors so multi-session / cross-actor
 * workflows have something to demonstrate:
 *
 *   lawyer_kim     — human_lawyer   (defaults to this)
 *   lawyer_park    — human_lawyer   (the second lawyer for hand-offs)
 *   business_choi  — user           (non-lawyer; cannot approve)
 *
 * The `human_lawyer` role is the SAME guard the core uses today
 * (`errors.notHumanLawyer()` checks `actor.role === "human_lawyer"`).
 * Selecting `business_choi` in the UI therefore makes the lawyer-only
 * aggregate ops throw on the server — proving 3F enforces the same
 * invariants as before, just per-actor instead of per-process.
 *
 * Shared between client (ActorSelector + StoreProvider) and server
 * (API routes resolve actor_id against this list). Pure data — no
 * Next.js / React imports — so it loads cleanly in both runtimes.
 */
import type { Actor } from "@contractops/schemas";

export type DemoActorId = "lawyer_kim" | "lawyer_park" | "business_choi";

export const DEMO_ACTOR_REGISTRY: Readonly<Record<DemoActorId, Actor>> = {
  lawyer_kim: {
    id: "lawyer_kim",
    role: "human_lawyer",
    display_name: "Kim 변호사 (Lawyer)",
  },
  lawyer_park: {
    id: "lawyer_park",
    role: "human_lawyer",
    display_name: "Park 변호사 (Lawyer)",
  },
  business_choi: {
    id: "business_choi",
    role: "user",
    display_name: "Choi 사업담당 (Business)",
  },
};

export const DEMO_ACTOR_IDS: readonly DemoActorId[] = [
  "lawyer_kim",
  "lawyer_park",
  "business_choi",
] as const;

/**
 * The default actor used when:
 *   - the client has not yet picked one (cold-start hydration);
 *   - a server-side caller does not pass an actor_id (e.g. the fixture
 *     CLI, vitest unit tests that pre-date this milestone).
 *
 * Defaults to a human_lawyer so existing flows continue to satisfy the
 * lawyer-only role checks.
 */
export const DEFAULT_DEMO_ACTOR_ID: DemoActorId = "lawyer_kim";

export function listDemoActors(): Actor[] {
  return DEMO_ACTOR_IDS.map((id) => DEMO_ACTOR_REGISTRY[id]);
}

/**
 * Resolve a client-supplied actor_id against the registry. Throws
 * `UnknownActorError` if the id is missing from the registry — server
 * routes turn this into a 400 response. We deliberately do NOT accept
 * arbitrary `Actor` objects from the client; the only thing the client
 * sends over the wire is an id, and the server picks the role + display
 * name from this trusted table.
 */
export function resolveDemoActor(actorId: string | null | undefined): Actor {
  if (!actorId) return DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID];
  const actor = (DEMO_ACTOR_REGISTRY as Record<string, Actor>)[actorId];
  if (!actor) throw new UnknownActorError(actorId);
  return actor;
}

export function isKnownDemoActorId(id: unknown): id is DemoActorId {
  return typeof id === "string" && id in DEMO_ACTOR_REGISTRY;
}

/** Thrown when a client-supplied actor_id is not in the registry. */
export class UnknownActorError extends Error {
  readonly code = "UNKNOWN_ACTOR";
  constructor(public readonly actor_id: string) {
    super(
      `unknown actor_id "${actor_id}". Must be one of: ${DEMO_ACTOR_IDS.join(", ")}.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// UI role helpers (Milestone 3G)
//
// `canActAsLawyer` is the same predicate the core role guards use
// (`actor.role === "human_lawyer"`) — exposed here so client pages can
// pre-disable lawyer-only controls before the server rejects them.
//
//   ⚠ CONVENIENCE ONLY. Pages must still send the operation to the
//   server, which re-checks the role and returns 422 if the resolved
//   actor is not a lawyer. The UI disable is a UX nicety, not a
//   security boundary.
// ─────────────────────────────────────────────────────────────────────

/**
 * Bilingual message shown both as a `title` attribute on disabled
 * lawyer-only buttons and as inline help text near guarded sections.
 */
export const REQUIRES_LAWYER_MESSAGE =
  "변호사 권한이 필요한 작업입니다 (Requires human_lawyer)";

/**
 * `true` iff the actor's role is `human_lawyer`. Tolerant of
 * undefined / null so call sites that may not have hydrated the
 * StoreProvider yet can still call this without a runtime crash.
 */
export function canActAsLawyer(
  actor: { role?: string } | null | undefined,
): boolean {
  return actor?.role === "human_lawyer";
}
