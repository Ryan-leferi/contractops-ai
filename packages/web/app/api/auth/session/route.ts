/**
 * GET /api/auth/session — return the actor the server resolved for
 * this request (Milestone 3I).
 *
 *   200 → { actor: { id, role, display_name }, source: "demo_cookie" | "demo_default" }
 *   401 → { error, code: "INVALID_SESSION" } + Set-Cookie that clears
 *         the bad cookie. Browser typically retries and gets the
 *         default on the next call.
 *
 * Mutations live on `POST /api/auth/demo/actor` and
 * `DELETE /api/auth/demo/actor`. This route is read-only — the demo
 * provider never SETS a cookie here, so a fresh browser hitting
 * /projects sees `source: "demo_default"` and starts as lawyer_kim
 * without any state being written server-side.
 */
import { NextResponse } from "next/server";
import {
  DEMO_SESSION_COOKIE_NAME,
  resolveSessionFromRequest,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Check by code property, not `instanceof`. Next.js dev compiles each
 * route as its own server-side module, which can produce a second
 * copy of `InvalidSessionError` whose `instanceof` check on objects
 * thrown from `@/lib/auth` returns false. The string `code` lives
 * on the prototype and survives the duplication.
 */
function isInvalidSession(err: unknown): err is { message: string; code: "INVALID_SESSION" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "INVALID_SESSION"
  );
}

export async function GET(request: Request) {
  try {
    const session = await resolveSessionFromRequest(request);
    return NextResponse.json({
      actor: session.actor,
      source: session.source,
    });
  } catch (err) {
    if (isInvalidSession(err)) {
      const res = NextResponse.json(
        { error: err.message, code: err.code },
        { status: 401 },
      );
      // Clear the bad cookie so the next request defaults cleanly.
      res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", {
        path: "/",
        maxAge: 0,
      });
      return res;
    }
    throw err;
  }
}
