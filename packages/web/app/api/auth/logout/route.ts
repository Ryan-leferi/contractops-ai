/**
 * POST /api/auth/logout — clear all auth cookies + emit logout event
 * (Milestones 3J + 3K).
 *
 *   POST → 200 { ok: true } + Set-Cookie clear
 *
 * Available in BOTH modes:
 *   - signed_cookie mode: clears `AUTH_COOKIE_NAME` (the signed token).
 *   - demo mode: clears `contractops_demo_actor` (the picker cookie).
 *
 * Both cookies are cleared defensively regardless of mode — a
 * cross-mode redeploy could leave a stale cookie in the browser, and
 * we want logout to be unconditionally complete.
 *
 * Auth event emission (Milestone 3K):
 *   - logout: emitted on every call. `actor_id` is the resolved
 *     actor when the caller had a valid session, `null` otherwise
 *     (logging out without a session is a no-op for the auth state
 *     but the event documents the intent).
 *
 * No CSRF token required: logout is idempotent and doesn't mutate
 * any persistent server state (the user store is untouched). A
 * future hardening milestone may add CSRF tokens to the form-style
 * routes.
 */
import { NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE_NAME,
  extractRequestContext,
  getAuthConfig,
  getAuthSessionResolver,
  recordAuthEvent,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = getAuthConfig();
  const requestContext = extractRequestContext(request);

  // Best-effort: figure out who's logging out so the event has an
  // actor. Failure here is silent — a bad cookie shouldn't break
  // the logout flow.
  let actorId: string | null = null;
  try {
    const sess = await getAuthSessionResolver().resolveSession(request);
    actorId = sess?.actor.id ?? null;
  } catch {
    actorId = null;
  }

  await recordAuthEvent({
    event_type: "logout",
    actor_id: actorId,
    user_id: config.mode === "signed_cookie" ? actorId : null,
    email: null,
    request_context: requestContext,
    result: "success",
    reason_code: "OK",
  });

  const res = NextResponse.json({ ok: true });
  // Always clear the signed-cookie name AND the demo cookie name.
  res.cookies.set(config.cookieName, "", { path: "/", maxAge: 0 });
  if (config.cookieName !== DEMO_SESSION_COOKIE_NAME) {
    res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  }
  return res;
}
