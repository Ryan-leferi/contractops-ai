/**
 * /api/projects/[id]/audit-logs — return the project's full append-only
 * audit log (Milestone 3D).
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
  if (!getProjectState(id)) {
    return NextResponse.json(
      { error: `project not found: ${id}`, code: "PROJECT_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ audits: getProjectAudits(id) });
}
