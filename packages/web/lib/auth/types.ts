/**
 * Authentication boundary types (Milestone 3I).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ DEMO ONLY — NOT PRODUCTION AUTHENTICATION.                   │
 *   │                                                              │
 *   │ This module defines the interface server routes use to       │
 *   │ resolve "the current actor" — the person whose id will be    │
 *   │ stamped on the AuditLog and IssueDecisionHistory entries     │
 *   │ produced by the next workflow operation.                     │
 *   │                                                              │
 *   │ In 3I the only implementation is `DemoSessionAuthProvider`   │
 *   │ (cookie-backed, hardcoded registry, no password / no token   │
 *   │ verification). The boundary exists so a future milestone can │
 *   │ drop in a real provider (OAuth / SSO / signed JWT / DB-      │
 *   │ backed sessions) without touching any of the operation       │
 *   │ routes or the core aggregate functions.                      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Where this fits in the request lifecycle:
 *
 *   browser  ─►  POST /api/projects/[id]/operations  { name, args }
 *                                                       (no actor_id!)
 *                              │
 *                              ▼
 *                AuthSessionResolver.resolveActor(request)
 *                              │  reads `contractops_demo_actor` cookie,
 *                              │  validates against DEMO_ACTOR_REGISTRY
 *                              ▼
 *                       AuthSession { actor }
 *                              │
 *                              ▼
 *                  applyOperationToStore(id, op, actor)
 *                              │
 *                              ▼
 *                core.aggDecideIssue(state, { decided_by: actor })
 *
 * The browser no longer sends `actor_id` in the operation body — the
 * server's session boundary is the single source of truth for "who did
 * this". `/api/projects/[id]/operations` actively REJECTS any
 * `body.actor_id` with `OPERATION_ACTOR_ID_FORBIDDEN` so future
 * client code can't accidentally regress this.
 */
import type { Actor } from "@contractops/schemas";

/**
 * The Actor object returned by the auth boundary. Same shape as the
 * `Actor` used by `@contractops/core`; aliased here so call sites
 * communicate "this came from the auth/session layer", not "the
 * caller passed it in".
 */
export type AuthActor = Actor;

/**
 * The session resolved for a single inbound HTTP request. Holds only
 * the actor + the source label — no tokens, no expiry, no permissions.
 * Permissions still live in `core` and are checked per-operation via
 * `actor.role`.
 */
export interface AuthSession {
  readonly actor: AuthActor;
  /**
   * Where the actor came from.
   *
   *   demo_cookie    — 3I demo provider, valid `contractops_demo_actor`
   *                     cookie.
   *   demo_default   — 3I demo provider, no cookie present, fell back
   *                     to `DEFAULT_DEMO_ACTOR_ID`.
   *   signed_cookie  — 3J signed-cookie provider, HMAC-verified
   *                     session token resolved against the user store.
   *
   * A future OAuth / SSO milestone adds new variants (`oauth_jwt`,
   * `magic_link`, …) without changing this field's purpose: the
   * server tells the client which authentication path produced the
   * actor so the UI can render the right session affordances.
   */
  readonly source: "demo_cookie" | "demo_default" | "signed_cookie";
}

/**
 * The single seam every route uses to authenticate. Routes never read
 * cookies / headers directly — they call `resolveActor(request)` and
 * trust the returned actor.
 */
export interface AuthSessionResolver {
  /**
   * Return the session that the request carries explicit credentials
   * for, or `null` if it carries none. In demo mode, `null` means
   * "no cookie present" — the caller can decide whether to default
   * (via `resolveActor`) or reject (via `requireAuthenticatedActor`).
   */
  resolveSession(request: Request): Promise<AuthSession | null>;

  /**
   * Always return a session. In demo mode this means: a valid cookie
   * → that actor; no cookie → the demo default (lawyer_kim). An
   * invalid cookie (unknown actor_id) still throws — silently
   * "downgrading" a bad cookie to the default would mask bugs.
   *
   * A future real provider would either return a real session or
   * throw — there would be no "default" branch.
   */
  resolveActor(request: Request): Promise<AuthSession>;
}

/**
 * Thrown when a session cookie is present but its value doesn't map
 * to a known actor. Routes turn this into a 401 + a `Set-Cookie`
 * that clears the bad cookie. Distinct from `UnknownActorError`
 * (raised by the demo registry on an out-of-band lookup) so callers
 * can tell "client sent us junk" apart from "operator typo'd a CLI
 * arg".
 */
export class InvalidSessionError extends Error {
  readonly code = "INVALID_SESSION";
  constructor(public readonly reason: string) {
    super(`invalid session: ${reason}`);
  }
}

/**
 * Thrown by `requireAuthenticatedActor` when no session is present
 * AND the resolver refuses to fall back to a default. The demo
 * provider currently never throws this (it always defaults), but the
 * type exists so future real providers slot in without changing
 * call-site error handling.
 */
export class UnauthenticatedError extends Error {
  readonly code = "UNAUTHENTICATED";
  constructor(message = "request has no authenticated session") {
    super(message);
  }
}

/**
 * Thrown when a workflow operation route receives `actor_id` in the
 * request body. The session boundary is now the single source of
 * "who" — accepting `body.actor_id` would let a logged-in user
 * impersonate anyone in the registry just by editing one JSON field
 * in the browser devtools. Rejecting is preferred over silently
 * ignoring so a future client regression can't slip past unnoticed.
 */
export class OperationActorIdNotAllowedError extends Error {
  readonly code = "OPERATION_ACTOR_ID_FORBIDDEN";
  constructor() {
    super(
      "actor_id is not accepted in operation request bodies. " +
        "The server resolves the actor from the session cookie. " +
        "Set the cookie via POST /api/auth/demo/actor in demo mode.",
    );
  }
}
