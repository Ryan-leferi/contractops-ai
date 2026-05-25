/**
 * /api/projects/[id]/operations — apply a single workflow operation
 * (Milestones 3D + 3I).
 *
 *   POST { name: OperationName, args: Operation["args"] }
 *     → 200 { state, audits }
 *     → 400 if body / operation name is malformed
 *     → 400 if body.actor_id is present (OPERATION_ACTOR_ID_FORBIDDEN)
 *     → 401 if a session cookie is present but invalid
 *     → 404 if project not found
 *     → 422 if the aggregate refused (invalid transition, missing
 *           prerequisite, pending issues blocking final approval,
 *           role guard fired, etc.)
 *
 *   The request body MUST NOT carry `actor_id`. The actor is resolved
 *   from the session cookie via `resolveActorFromRequest`. Accepting
 *   body.actor_id would let the browser impersonate anyone in the
 *   registry just by hand-editing a single JSON field.
 *
 * The route is a thin pass-through to `applyOperationToStore`. All
 * workflow invariants stay enforced in @contractops/core.
 */
import { NextResponse } from "next/server";
import {
  ProjectNotFoundError,
  UnknownOperationError,
  applyOperationToStore,
  parseOperationOrThrow,
} from "@/lib/server-store";
import {
  DEMO_SESSION_COOKIE_NAME,
  OperationActorIdNotAllowedError,
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

export async function POST(
  request: Request,
  ctx: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }

  // Reject body.actor_id (Milestone 3I). Done BEFORE op parsing so a
  // hostile body can't slip through on the operation-shape error.
  if (
    typeof body === "object" &&
    body !== null &&
    "actor_id" in (body as Record<string, unknown>)
  ) {
    const err = new OperationActorIdNotAllowedError();
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: 400 },
    );
  }

  let op;
  try {
    op = parseOperationOrThrow(body);
  } catch (err) {
    if (err instanceof UnknownOperationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        code: "BAD_OPERATION",
      },
      { status: 400 },
    );
  }

  // Resolve the actor from the session cookie. No fallback to a
  // client-supplied id — the auth boundary is authoritative.
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
    const result = await applyOperationToStore(ctx.params.id, op, actor);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 404 },
      );
    }
    // Aggregate-layer errors (invalid transition, missing prerequisite,
    // pending issues blocking final, role guards, etc.) surface as 422
    // so the browser can distinguish "your input was malformed" (400)
    // from "your input was well-formed but the workflow refused" (422).
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, code: "OPERATION_REJECTED", op: op.name },
      { status: 422 },
    );
  }
}
