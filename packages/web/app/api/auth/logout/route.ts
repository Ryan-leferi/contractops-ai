/**
 * POST /api/auth/logout — clear all auth cookies (Milestone 3J).
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
 * No CSRF token required: logout is idempotent and doesn't mutate
 * any persistent server state (the user store is untouched). A future
 * hardening milestone may add CSRF tokens to the form-style routes.
 */
import { NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE_NAME, getAuthConfig } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const config = getAuthConfig();
  const res = NextResponse.json({ ok: true });
  // Always clear the signed-cookie name AND the demo cookie name.
  res.cookies.set(config.cookieName, "", { path: "/", maxAge: 0 });
  if (config.cookieName !== DEMO_SESSION_COOKIE_NAME) {
    res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  }
  return res;
}
