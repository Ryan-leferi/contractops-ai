/**
 * /api/projects/[id] — fetch a single project's full ProjectState and
 * audit log (Milestone 3D).
 *
 *   GET → { state: ProjectState, audits: AuditLog[] }
 *   404 if project is not in the in-memory store.
 */
import { NextResponse } from "next/server";
import { getProjectAudits, getProjectState } from "@/lib/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: { id: string } },
) {
  const id = ctx.params.id;
  const state = await getProjectState(id);
  if (!state) {
    return NextResponse.json(
      { error: `project not found: ${id}`, code: "PROJECT_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ state, audits: await getProjectAudits(id) });
}
