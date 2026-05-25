/**
 * GET /api/auth/session — return the auth state of the current request
 * (Milestones 3I + 3J).
 *
 * Response shape (both modes):
 *
 *   {
 *     auth_mode:     "demo" | "signed_cookie",
 *     demo_enabled:  boolean,
 *     authenticated: boolean,
 *     actor:         { id, role, display_name } | null,
 *     source:        "demo_cookie" | "demo_default" | "signed_cookie" | null
 *   }
 *
 * Behavior summary:
 *
 *   demo mode:
 *     - valid cookie → 200 { authenticated: true, actor, source: "demo_cookie" }
 *     - no cookie    → 200 { authenticated: false, actor: lawyer_kim, source: "demo_default" }
 *     - bad cookie   → 401 { code: "INVALID_SESSION" } + Set-Cookie clear
 *
 *   signed_cookie mode:
 *     - valid token  → 200 { authenticated: true, actor, source: "signed_cookie" }
 *     - no cookie    → 200 { authenticated: false, actor: null, source: null }
 *     - bad/expired  → 401 { code: "INVALID_SESSION" } + Set-Cookie clear
 *
 * The client uses `auth_mode` + `demo_enabled` to decide whether to
 * render the demo actor dropdown or the login form. `authenticated`
 * tells it which page-level UI (anonymous landing vs. signed-in
 * workspace) to render even before the actor is non-null.
 */
import { NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE_NAME,
  getAuthConfig,
  getAuthSessionResolver,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** See `app/api/auth/session/route.ts` for why we match by code, not instanceof. */
function isInvalidSession(err: unknown): err is { message: string; code: "INVALID_SESSION" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "INVALID_SESSION"
  );
}

export async function GET(request: Request) {
  const config = getAuthConfig();
  const resolver = getAuthSessionResolver();

  // Step 1: probe the resolver. resolveSession returns null on "no
  // credentials at all" and throws InvalidSessionError on "credentials
  // present but bad" — the bad-cookie branch needs to clear the cookie
  // regardless of mode.
  try {
    const session = await resolver.resolveSession(request);
    if (session) {
      return NextResponse.json({
        auth_mode: config.mode,
        demo_enabled: config.demoEnabled,
        authenticated: true,
        actor: session.actor,
        source: session.source,
      });
    }
    // No credentials.
    if (config.mode === "demo") {
      // 3I behavior — demo mode always has a default actor.
      const def = await resolver.resolveActor(request);
      return NextResponse.json({
        auth_mode: "demo",
        demo_enabled: config.demoEnabled,
        // Cookie-less demo requests are technically anonymous, but a
        // demo actor is still provided so existing pages render.
        authenticated: false,
        actor: def.actor,
        source: def.source,
      });
    }
    // signed_cookie + no cookie = anonymous; the UI shows a login form.
    return NextResponse.json({
      auth_mode: "signed_cookie",
      demo_enabled: config.demoEnabled,
      authenticated: false,
      actor: null,
      source: null,
    });
  } catch (err) {
    if (isInvalidSession(err)) {
      const res = NextResponse.json(
        {
          auth_mode: config.mode,
          demo_enabled: config.demoEnabled,
          error: err.message,
          code: err.code,
        },
        { status: 401 },
      );
      // Clear whichever cookie is in use, plus the demo cookie (defensive).
      res.cookies.set(config.cookieName, "", { path: "/", maxAge: 0 });
      if (config.cookieName !== DEMO_SESSION_COOKIE_NAME) {
        res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
      }
      return res;
    }
    throw err;
  }
}
