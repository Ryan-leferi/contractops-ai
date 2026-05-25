/**
 * /api/projects/[id]/operations — apply a single workflow operation
 * (Milestones 3D + 3I + 3L).
 *
 *   POST { name: OperationName, args: Operation["args"] }
 *     → 200 { state, audits }
 *     → 400 if body / operation name is malformed
 *     → 400 if body.actor_id is present (OPERATION_ACTOR_ID_FORBIDDEN)
 *     → 401 if a session cookie is present but invalid
 *     → 403 if actor lacks project membership (3L) or permission (3L)
 *     → 404 if project not found
 *     → 422 if the aggregate refused (invalid transition, missing
 *           prerequisite, pending issues blocking final approval,
 *           core role guard fired, etc.)
 *
 *   3L: BEFORE invoking the aggregate dispatcher, the route loads the
 *   project state, looks up the actor's membership, and checks the
 *   permission mapped from the operation name (see
 *   `mapOperationToPermission`). The membership check fires before
 *   the existing core role guard — so an attempt by a non-member
 *   lawyer gets HTTP 403 (`PROJECT_ACCESS_DENIED`) instead of
 *   reaching `core.aggApproveDealMemo`.
 */
import { NextResponse } from "next/server";
import {
  ProjectNotFoundError,
  UnknownOperationError,
  applyOperationToStore,
  getProjectState,
  parseOperationOrThrow,
} from "@/lib/server-store";
import {
  DEMO_SESSION_COOKIE_NAME,
  OperationActorIdNotAllowedError,
  isProjectAccessDenied,
  isProjectPermissionDenied,
  mapOperationToPermission,
  requireProjectPermission,
  resolveActorFromRequest,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // ── 3L: project-level authorization ─────────────────────────────
  // Loaded BEFORE applyOperationToStore so we never persist state
  // mutations for a denied request. The dispatcher's own core role
  // guard (e.g. `aggApproveDealMemo` checks `actor.role === "human_lawyer"`)
  // remains as a defense-in-depth second line.
  const state = await getProjectState(ctx.params.id);
  if (!state) {
    return NextResponse.json(
      { error: `project not found: ${ctx.params.id}`, code: "PROJECT_NOT_FOUND" },
      { status: 404 },
    );
  }
  const requiredPermission = mapOperationToPermission(op);
  if (requiredPermission === null) {
    // Operation isn't covered by the matrix — fail closed.
    return NextResponse.json(
      {
        error: `operation '${op.name}' is not mapped to a permission; denied by default`,
        code: "OPERATION_PERMISSION_UNMAPPED",
        op: op.name,
      },
      { status: 403 },
    );
  }
  try {
    requireProjectPermission(state, actor.id, requiredPermission);
  } catch (err) {
    if (isProjectAccessDenied(err) || isProjectPermissionDenied(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code, op: op.name },
        { status: 403 },
      );
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
    // pending issues blocking final, core role guards, etc.) surface
    // as 422.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, code: "OPERATION_REJECTED", op: op.name },
      { status: 422 },
    );
  }
}
