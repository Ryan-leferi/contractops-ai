/**
 * /api/projects/[id]/decision-history — return every IssueDecisionHistoryEntry
 * for the project, oldest → newest (Milestone 3D).
 *
 * The list is sourced from `ProjectState.decision_history` which is itself
 * append-only — `aggDecideIssue` only ever appends.
 *
 * INTERNAL legal workflow data. Per PLATFORM_BRIEF.md §5 rule 7 and §12
 * rule 5, this data MUST NOT be included in any external export (clean
 * DOCX, cover email). The export renderers in
 * `packages/core/src/export-renderer/*` enforce that separately.
 */
import { NextResponse } from "next/server";
import { getProjectDecisionHistory, getProjectState } from "@/lib/server-store";

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
  return NextResponse.json({ history: getProjectDecisionHistory(id) });
}
