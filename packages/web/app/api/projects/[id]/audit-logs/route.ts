/**
 * /api/projects/[id]/audit-logs — return the project's append-only
 * audit log (Milestones 3D + 3L).
 *
 *   GET → 200 { audits }                        (lawyer role required)
 *       → 401 INVALID_SESSION
 *       → 403 PROJECT_ACCESS_DENIED              (non-member)
 *       → 403 PROJECT_PERMISSION_DENIED          (non-lawyer member)
 *       → 404 PROJECT_NOT_FOUND
 *
 *   3L: audit logs are internal workflow telemetry — non-lawyer
 *   members cannot read them (PLATFORM_BRIEF.md §5 rule 7).
 */
import { NextResponse } from "next/server";
import { getProjectAudits, getProjectState } from "@/lib/server-store";
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

export async function GET(request: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;

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

  const state = await getProjectState(id);
  if (!state) {
    return NextResponse.json(
      { error: `project not found: ${id}`, code: "PROJECT_NOT_FOUND" },
      { status: 404 },
    );
  }

  try {
    requireProjectPermission(state, actor.id, "view_audit_log");
  } catch (err) {
    if (isProjectAccessDenied(err) || isProjectPermissionDenied(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 403 },
      );
    }
    throw err;
  }

  return NextResponse.json({ audits: await getProjectAudits(id) });
}
