/**
 * Demo session actor cookie management (Milestones 3I + 3J + 3K).
 *
 *   POST   { actor_id } → 200 { actor, source: "demo_cookie" }
 *                         + Set-Cookie contractops_demo_actor=<id>
 *   DELETE              → 200 { actor, source: "demo_default" }
 *                         + Set-Cookie contractops_demo_actor=; Max-Age=0
 *
 * Hardening (Milestone 3J):
 *   - In `signed_cookie` mode with `DEMO_AUTH_ENABLED=false` (the
 *     default in signed_cookie mode), BOTH routes return 403
 *     `DEMO_AUTH_DISABLED`. The signed-cookie provider has no use
 *     for the demo cookie, and silently accepting a demo-actor POST
 *     would create a parallel identity channel that bypasses the
 *     signed session.
 *   - In `demo` mode (default) the routes behave exactly as in 3I,
 *     preserving every existing test.
 *
 * Auth event emission (Milestone 3K):
 *   - demo_actor_switch:     emitted on successful POST (200).
 *                             metadata.previous_actor_id records the
 *                             cookie value the request CARRIED, so
 *                             the audit shows the transition.
 *   - demo_auth_forbidden:    emitted whenever the route returns 403
 *                             (either POST or DELETE). metadata
 *                             records the attempted actor_id when
 *                             present.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ DEMO ONLY. Even when enabled, the cookie value is a plain    │
 *   │ actor id — no signing, no password, no rate limit. Anyone    │
 *   │ who can reach this route can become anyone in the registry.  │
 *   │ Production deployment MUST run in signed_cookie mode with    │
 *   │ DEMO_AUTH_ENABLED=false. See ADR-017.                        │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE_MAX_AGE_SECONDS,
  DEMO_SESSION_COOKIE_NAME,
  extractRequestContext,
  getAuthConfig,
  parseCookieHeader,
  recordAuthEvent,
} from "@/lib/auth";
import {
  DEFAULT_DEMO_ACTOR_ID,
  DEMO_ACTOR_REGISTRY,
  UnknownActorError,
  resolveDemoActor,
} from "@/lib/demo-actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function demoDisabledResponse() {
  return NextResponse.json(
    {
      error:
        "demo actor switching is disabled in the current AUTH_MODE. " +
        "Set DEMO_AUTH_ENABLED=true to override (dev only).",
      code: "DEMO_AUTH_DISABLED",
    },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  const requestContext = extractRequestContext(request);

  // Best-effort capture of attempted actor_id (even for the 403 path)
  // so the security log can show "Choi tried to become Kim 5x".
  let attemptedActorId: string | null = null;
  let body: { actor_id?: unknown } | null = null;
  try {
    body = (await request.json()) as { actor_id?: unknown };
    if (typeof body.actor_id === "string") attemptedActorId = body.actor_id;
  } catch {
    body = null;
  }

  if (!config.demoEnabled) {
    await recordAuthEvent({
      event_type: "demo_auth_forbidden",
      actor_id: null,
      user_id: null,
      email: null,
      request_context: requestContext,
      result: "failure",
      reason_code: "DEMO_AUTH_DISABLED",
      metadata: attemptedActorId
        ? { attempted_actor_id: attemptedActorId, method: "POST" }
        : { method: "POST" },
    });
    return demoDisabledResponse();
  }

  if (!body) {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }
  const rawId = body.actor_id;
  if (typeof rawId !== "string" || rawId.length === 0) {
    return NextResponse.json(
      {
        error: "actor_id is required and must be a non-empty string",
        code: "BAD_ACTOR_ID",
      },
      { status: 400 },
    );
  }
  let actor;
  try {
    actor = resolveDemoActor(rawId);
  } catch (err) {
    if (err instanceof UnknownActorError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }

  // Pull the previous cookie value (if any) for the audit trail —
  // useful to chart "this user switched 12x in 5 minutes".
  const previousActorId = parseCookieHeader(
    request.headers.get("cookie"),
    DEMO_SESSION_COOKIE_NAME,
  );

  await recordAuthEvent({
    event_type: "demo_actor_switch",
    actor_id: actor.id,
    user_id: null, // demo mode has no user table
    email: null,
    request_context: requestContext,
    result: "success",
    reason_code: "OK",
    metadata: previousActorId
      ? { previous_actor_id: previousActorId, new_actor_id: actor.id }
      : { new_actor_id: actor.id },
  });

  const res = NextResponse.json({ actor, source: "demo_cookie" });
  res.cookies.set(DEMO_SESSION_COOKIE_NAME, actor.id, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: config.isProduction,
    maxAge: DEMO_SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

export async function DELETE(request: Request) {
  const config = getAuthConfig();
  const requestContext = extractRequestContext(request);

  if (!config.demoEnabled) {
    await recordAuthEvent({
      event_type: "demo_auth_forbidden",
      actor_id: null,
      user_id: null,
      email: null,
      request_context: requestContext,
      result: "failure",
      reason_code: "DEMO_AUTH_DISABLED",
      metadata: { method: "DELETE" },
    });
    return demoDisabledResponse();
  }

  const res = NextResponse.json({
    actor: DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID],
    source: "demo_default",
  });
  res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
