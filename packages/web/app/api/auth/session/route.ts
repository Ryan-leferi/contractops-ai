/**
 * GET /api/auth/session — return the auth state of the current request
 * (Milestones 3I + 3J + 3K).
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
 * Auth event emission (Milestone 3K):
 *   - 200 success paths emit NO event — too noisy (every page mount
 *     hits this route).
 *   - 401 INVALID_SESSION paths emit one of:
 *       session_expired   — cause_code === "EXPIRED"
 *       session_tampered  — cause_code === "INVALID_SIGNATURE"
 *       session_invalid   — everything else (malformed payload,
 *                            unknown user, disabled user, junk demo
 *                            cookie, missing secret)
 *     None of these events carry the cookie value or the signing
 *     secret — just the `cause_code` from `InvalidSessionError`.
 */
import { NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE_NAME,
  extractRequestContext,
  getAuthConfig,
  getAuthSessionResolver,
  recordAuthEvent,
  type AuthEventType,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InvalidSessionShape {
  message: string;
  code: "INVALID_SESSION";
  cause_code?: string;
}

function isInvalidSession(err: unknown): err is InvalidSessionShape {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "INVALID_SESSION"
  );
}

/** Map InvalidSessionError.cause_code → AuthEventType. */
function eventTypeFromCause(causeCode: string | undefined): AuthEventType {
  if (causeCode === "EXPIRED") return "session_expired";
  if (causeCode === "INVALID_SIGNATURE") return "session_tampered";
  return "session_invalid";
}

export async function GET(request: Request) {
  const config = getAuthConfig();
  const resolver = getAuthSessionResolver();
  const requestContext = extractRequestContext(request);

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
      const def = await resolver.resolveActor(request);
      return NextResponse.json({
        auth_mode: "demo",
        demo_enabled: config.demoEnabled,
        authenticated: false,
        actor: def.actor,
        source: def.source,
      });
    }
    return NextResponse.json({
      auth_mode: "signed_cookie",
      demo_enabled: config.demoEnabled,
      authenticated: false,
      actor: null,
      source: null,
    });
  } catch (err) {
    if (isInvalidSession(err)) {
      const causeCode = err.cause_code ?? "UNKNOWN";
      await recordAuthEvent({
        event_type: eventTypeFromCause(err.cause_code),
        actor_id: null,
        user_id: null,
        email: null,
        request_context: requestContext,
        result: "failure",
        reason_code: causeCode,
      });
      const res = NextResponse.json(
        {
          auth_mode: config.mode,
          demo_enabled: config.demoEnabled,
          error: err.message,
          code: err.code,
        },
        { status: 401 },
      );
      res.cookies.set(config.cookieName, "", { path: "/", maxAge: 0 });
      if (config.cookieName !== DEMO_SESSION_COOKIE_NAME) {
        res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
      }
      return res;
    }
    throw err;
  }
}
