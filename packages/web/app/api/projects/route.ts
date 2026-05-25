/**
 * /api/projects — list summaries, create a new project
 * (Milestones 3D + 3I).
 *
 *   GET  → { projects: ProjectSummary[] }
 *   POST { name: string } → 201 { state, audits }
 *
 *   The POST body MUST NOT carry `actor_id`. The server resolves the
 *   actor from the session cookie (see `lib/auth`). If `actor_id`
 *   appears in the body the request is rejected with HTTP 400 +
 *   `OPERATION_ACTOR_ID_FORBIDDEN` so accidental regressions in
 *   client code surface immediately rather than silently
 *   impersonating someone.
 *
 * The backing store is the process-wide `server-store` (default:
 * in-memory; opt-in file / Postgres). State is lost on server restart
 * for the memory adapter; documented in README.
 */
import { NextResponse } from "next/server";
import { createProjectInStore, listProjectSummaries } from "@/lib/server-store";
import {
  OperationActorIdNotAllowedError,
  DEMO_SESSION_COOKIE_NAME,
  resolveActorFromRequest,
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

export async function GET() {
  return NextResponse.json({ projects: await listProjectSummaries() });
}

export async function POST(request: Request) {
  let body: { name?: unknown; actor_id?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; actor_id?: unknown };
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }
  // Reject body.actor_id (Milestone 3I). The session boundary is the
  // single source of "who"; accepting a client-provided actor_id
  // would let any caller impersonate anyone in the registry.
  if ("actor_id" in body) {
    const err = new OperationActorIdNotAllowedError();
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
  }
  const name = body.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required and must be a non-empty string", code: "BAD_NAME" },
      { status: 400 },
    );
  }

  let actor;
  try {
    actor = await resolveActorFromRequest(request);
  } catch (err) {
    if (isInvalidSession(err)) {
      const res = NextResponse.json(
        { error: err.message, code: err.code },
        { status: 401 },
      );
      res.cookies.set(DEMO_SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
      return res;
    }
    throw err;
  }

  const { state, audits } = await createProjectInStore(name.trim(), actor);
  return NextResponse.json({ state, audits }, { status: 201 });
}
