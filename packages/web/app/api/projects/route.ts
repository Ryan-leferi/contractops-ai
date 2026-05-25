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
import { UnknownActorError, resolveDemoActor } from "@/lib/demo-actors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const name = body.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required and must be a non-empty string", code: "BAD_NAME" },
      { status: 400 },
    );
  }
  // Resolve the client-supplied actor_id against the demo registry.
  // Missing → default lawyer; unknown → 400.
  let actor;
  try {
    actor = resolveDemoActor(
      typeof body.actor_id === "string" ? body.actor_id : undefined,
    );
  } catch (err) {
    if (err instanceof UnknownActorError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }
  const { state, audits } = await createProjectInStore(name.trim(), actor);
  return NextResponse.json({ state, audits }, { status: 201 });
}
