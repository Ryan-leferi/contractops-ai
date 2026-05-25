/**
 * Demo session actor cookie management (Milestone 3I).
 *
 *   POST   { actor_id } → 200 { actor, source: "demo_cookie" }
 *                         + Set-Cookie contractops_demo_actor=<id>
 *   DELETE              → 200 { actor, source: "demo_default" }
 *                         + Set-Cookie contractops_demo_actor=; Max-Age=0
 *
 * The actor_id is validated against `DEMO_ACTOR_REGISTRY`; unknown
 * ids return 400 with `UNKNOWN_ACTOR`. This is the ONLY way to
 * change "who am I acting as" in 3I — the workflow operation routes
 * no longer accept actor_id in their body.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ DEMO ONLY. The cookie value is a plain actor id. There is no │
 *   │ signing, no password, no rate limit. Anyone who can reach    │
 *   │ this route can become anyone in the registry. Production     │
 *   │ deployment STILL requires a real identity provider — see     │
 *   │ ADR-016.                                                     │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE_MAX_AGE_SECONDS,
  DEMO_SESSION_COOKIE_NAME,
} from "@/lib/auth";
import {
  DEFAULT_DEMO_ACTOR_ID,
  DEMO_ACTOR_REGISTRY,
  UnknownActorError,
  resolveDemoActor,
} from "@/lib/demo-actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { actor_id?: unknown };
  try {
    body = (await request.json()) as { actor_id?: unknown };
  } catch {
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
  const res = NextResponse.json({ actor, source: "demo_cookie" });
  // path "/" so EVERY route (auth + projects + reset) sees the same
  // cookie. SameSite=Lax keeps cross-site POSTs from spoofing the
  // demo identity. httpOnly: true — the JS in the browser never
  // needs to read this directly, it always asks /api/auth/session.
  res.cookies.set(DEMO_SESSION_COOKIE_NAME, actor.id, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: DEMO_SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}

export async function DELETE() {
  // Clearing the cookie returns the user to the demo default.
  const res = NextResponse.json({
    actor: DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID],
    source: "demo_default",
  });
  res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
