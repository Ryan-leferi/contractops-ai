/**
 * /api/projects — list summaries, create a new project
 * (Milestones 3D + 3I + 3L).
 *
 *   GET  → { projects: ProjectSummary[] }   (filtered by membership)
 *   POST { name: string } → 201 { state, audits }
 *
 *   The POST body MUST NOT carry `actor_id`. The server resolves the
 *   actor from the session cookie (see `lib/auth`). If `actor_id`
 *   appears in the body the request is rejected with HTTP 400 +
 *   `OPERATION_ACTOR_ID_FORBIDDEN`.
 *
 *   3L: GET filters the project list to projects in which the
 *   resolved actor has an active membership — non-member projects
 *   are NOT leaked. POST refuses non-lawyer creators with 403
 *   `NON_LAWYER_CANNOT_CREATE_PROJECT`; the creator is
 *   auto-granted an `owner_lawyer` membership.
 */
import { NextResponse } from "next/server";
import {
  NonLawyerCannotCreateProjectError,
  createProjectInStore,
  getProjectState,
  listProjectSummaries,
} from "@/lib/server-store";
import {
  OperationActorIdNotAllowedError,
  DEMO_SESSION_COOKIE_NAME,
  isProjectVisibleTo,
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

function isNonLawyerCreator(
  err: unknown,
): err is { message: string; code: "NON_LAWYER_CANNOT_CREATE_PROJECT" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "NON_LAWYER_CANNOT_CREATE_PROJECT"
  );
}

export async function GET(request: Request) {
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

  // Visibility filter: load each project's state and keep only those
  // where the actor has an active membership. N+1 reads; acceptable
  // for MVP. A future milestone moves memberships to a normalized
  // index table so this becomes a single join (see ADR-019).
  const all = await listProjectSummaries();
  const visible = [];
  for (const summary of all) {
    const state = await getProjectState(summary.id);
    if (state && isProjectVisibleTo(state, actor.id)) {
      visible.push(summary);
    }
  }
  return NextResponse.json({ projects: visible });
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
  // Reject body.actor_id (Milestone 3I).
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

  try {
    const { state, audits } = await createProjectInStore(name.trim(), actor);
    return NextResponse.json({ state, audits }, { status: 201 });
  } catch (err) {
    if (err instanceof NonLawyerCannotCreateProjectError || isNonLawyerCreator(err)) {
      return NextResponse.json(
        {
          error: (err as Error).message,
          code: "NON_LAWYER_CANNOT_CREATE_PROJECT",
        },
        { status: 403 },
      );
    }
    throw err;
  }
}
