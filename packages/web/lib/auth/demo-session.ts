/**
 * DemoSessionAuthProvider (Milestone 3I).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ DEMO ONLY — NOT PRODUCTION AUTHENTICATION.                   │
 *   │   - No password, no token, no SSO, no signing key.           │
 *   │   - The cookie value is a plain actor id from a hardcoded    │
 *   │     in-process registry (`lib/demo-actors.ts`).              │
 *   │   - Anyone who can reach the Next.js process can set the     │
 *   │     cookie via POST /api/auth/demo/actor and pretend to be   │
 *   │     anyone in the registry.                                  │
 *   │   - Production deployment STILL requires real auth + RBAC.   │
 *   │     See ADR-016 for the migration path.                      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * This is the FIRST and ONLY `AuthSessionResolver` implementation in
 * 3I. The boundary it lives behind (`AuthSessionResolver` interface
 * in `./types.ts`) is what lets a future milestone swap in a real
 * provider without touching the route handlers or the core
 * aggregate functions.
 *
 * Behavior summary:
 *
 *   request has cookie + valid id  → AuthSession { actor, source: demo_cookie }
 *   request has cookie + bad id    → InvalidSessionError (route → 401)
 *   request has no cookie          → resolveSession() returns null
 *                                    resolveActor()   returns the default
 *                                                     (lawyer_kim)
 */
import { DEFAULT_DEMO_ACTOR_ID, DEMO_ACTOR_REGISTRY } from "../demo-actors";
import { parseCookieHeader } from "./cookie";
import {
  type AuthSession,
  type AuthSessionResolver,
  InvalidSessionError,
} from "./types";

/**
 * Cookie name used by the demo provider. Exposed so route handlers
 * (set / clear) and Playwright helpers (inject for multi-context
 * tests) reference one source of truth instead of stringly typing
 * the name in three places.
 */
export const DEMO_SESSION_COOKIE_NAME = "contractops_demo_actor";

/**
 * Cookie max-age, in seconds. 30 days keeps a demo user's "Acting
 * as" choice stable across browser restarts. Session cookies
 * (`maxAge` omitted) would also be fine; long-lived is friendlier
 * for the demo while staying obviously demo-grade.
 */
export const DEMO_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export class DemoSessionAuthProvider implements AuthSessionResolver {
  async resolveSession(request: Request): Promise<AuthSession | null> {
    const cookieHeader = request.headers.get("cookie");
    const rawActorId = parseCookieHeader(cookieHeader, DEMO_SESSION_COOKIE_NAME);
    if (rawActorId === null) return null;
    const actor = (DEMO_ACTOR_REGISTRY as Record<string, AuthSession["actor"]>)[
      rawActorId
    ];
    if (!actor) {
      // Refuse to silently default — a junk cookie is almost always a
      // bug (stale value, wrong env, hand-edited devtools value) and
      // the route turns this into a 401 + clears the cookie.
      throw new InvalidSessionError(
        `cookie ${DEMO_SESSION_COOKIE_NAME}="${rawActorId}" does not name a known actor`,
        "UNKNOWN_ACTOR_COOKIE",
      );
    }
    return { actor, source: "demo_cookie" };
  }

  async resolveActor(request: Request): Promise<AuthSession> {
    const existing = await this.resolveSession(request);
    if (existing) return existing;
    // No cookie at all — demo default. (NB: an INVALID cookie threw
    // above; we never silently fall back from bad to good.)
    return {
      actor: DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID],
      source: "demo_default",
    };
  }
}
