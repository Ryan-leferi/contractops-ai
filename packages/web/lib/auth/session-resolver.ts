/**
 * Session resolver façade (Milestone 3I).
 *
 * Route handlers call `resolveActorFromRequest(request)` or
 * `requireAuthenticatedActor(request)` and never touch cookies, the
 * registry, or the provider directly. The cached singleton lives on
 * `globalThis` so Next.js dev HMR doesn't rebuild it on every route
 * module reload.
 *
 * `requireAuthenticatedActor` is a separate function rather than an
 * alias on purpose: in demo mode both behave the same (the demo
 * provider always returns a default), but a future real provider
 * will have `requireAuthenticatedActor` throw `UnauthenticatedError`
 * for missing sessions while `resolveActorFromRequest` keeps the
 * defaulting behavior callers like the demo intent picker need.
 * Picking the right one today is a documentation hook for tomorrow.
 */
import type { Actor } from "@contractops/schemas";
import { DemoSessionAuthProvider } from "./demo-session";
import {
  type AuthSession,
  type AuthSessionResolver,
} from "./types";

const GLOBAL_KEY = "__contractops_auth_session_resolver_v1__";

export function getAuthSessionResolver(): AuthSessionResolver {
  const g = globalThis as Record<string, unknown>;
  const cached = g[GLOBAL_KEY] as AuthSessionResolver | undefined;
  if (cached) return cached;
  const fresh = new DemoSessionAuthProvider();
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

/**
 * Resolve the actor for an inbound request. ALWAYS returns an Actor
 * in demo mode — no cookie ⇒ `DEFAULT_DEMO_ACTOR_ID` (lawyer_kim).
 * An invalid cookie still throws `InvalidSessionError`.
 *
 * Routes that need only "who is this?" (read APIs, the auth probe,
 * project create) use this.
 */
export async function resolveActorFromRequest(request: Request): Promise<Actor> {
  const session = await getAuthSessionResolver().resolveActor(request);
  return session.actor;
}

/**
 * Same as `resolveActorFromRequest` in demo mode. A future real
 * provider would have THIS throw `UnauthenticatedError` for missing
 * sessions; `resolveActorFromRequest` would keep its default.
 *
 * Routes that need "this MUST be a real logged-in user" (every
 * mutation) use this — even though the demo provider behaves
 * identically today, the distinction documents intent for the
 * future swap.
 */
export async function requireAuthenticatedActor(
  request: Request,
): Promise<Actor> {
  const session = await getAuthSessionResolver().resolveActor(request);
  return session.actor;
}

/**
 * Read the full session (actor + source label). Used by the
 * `GET /api/auth/session` route so the browser can show the
 * current actor's display name in the header.
 */
export async function resolveSessionFromRequest(
  request: Request,
): Promise<AuthSession> {
  return getAuthSessionResolver().resolveActor(request);
}

/**
 * Test-only escape hatch. Drops the cached singleton so the next
 * `getAuthSessionResolver()` call rebuilds one. Production code
 * should never need this.
 */
export function __resetAuthSessionResolverForTests(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[GLOBAL_KEY];
}
