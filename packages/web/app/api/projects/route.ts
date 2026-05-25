/**
 * /api/projects — list summaries, create a new project (Milestone 3D).
 *
 *   GET  → { projects: ProjectSummary[] }
 *   POST { name: string } → { state, audits }
 *
 * The backing store is the process-wide in-memory `server-store`. State
 * is lost on server restart. Documented in README.
 */
import { NextResponse } from "next/server";
import { createProjectInStore, listProjectSummaries } from "@/lib/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: listProjectSummaries() });
}

export async function POST(request: Request) {
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }
  const name = body.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required and must be a non-empty string", code: "BAD_NAME" },
      { status: 400 },
    );
  }
  const { state, audits } = createProjectInStore(name.trim());
  return NextResponse.json({ state, audits }, { status: 201 });
}
