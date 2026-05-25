/**
 * DELETE /api/projects/[id]/memberships/[membership_id] — disable a
 * membership (Milestone 3L). Soft-delete: sets `disabled_at` rather
 * than removing the row so the audit trail stays complete.
 *
 *   → 200 { membership, audit }
 *   → 401 INVALID_SESSION
 *   → 403 if caller lacks `manage_memberships`
 *   → 404 PROJECT_NOT_FOUND / MEMBERSHIP_NOT_FOUND
 *   → 422 CANNOT_REMOVE_LAST_OWNER  (refuses to orphan the project)
 *
 * Idempotent: disabling an already-disabled membership is a no-op
 * 200 (server emits the same audit pattern but with
 * `metadata.idempotent: true`).
 */
import { NextResponse } from "next/server";
import {
  CannotRemoveLastOwnerError,
  MembershipNotFoundError,
  ProjectNotFoundError,
  disableMembershipInProject,
  getProjectState,
} from "@/lib/server-store";
import {
  DEMO_SESSION_COOKIE_NAME,
  isProjectAccessDenied,
  isProjectPermissionDenied,
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

export async function DELETE(
  request: Request,
  ctx: { params: { id: string; membership_id: string } },
) {
  const projectId = ctx.params.id;
  const membershipId = ctx.params.membership_id;

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

  const state = await getProjectState(projectId);
  if (!state) {
    return NextResponse.json(
      { error: `project not found: ${projectId}`, code: "PROJECT_NOT_FOUND" },
      { status: 404 },
    );
  }

  try {
    requireProjectPermission(state, actor.id, "manage_memberships");
  } catch (err) {
    if (isProjectAccessDenied(err) || isProjectPermissionDenied(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 403 },
      );
    }
    throw err;
  }

  try {
    const { membership, audit } = await disableMembershipInProject(
      projectId,
      membershipId,
      actor,
    );
    return NextResponse.json({ membership, audit });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 404 },
      );
    }
    if (err instanceof MembershipNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 404 },
      );
    }
    if (err instanceof CannotRemoveLastOwnerError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 422 },
      );
    }
    throw err;
  }
}
