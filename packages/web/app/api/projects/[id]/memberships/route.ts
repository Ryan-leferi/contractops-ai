/**
 * /api/projects/[id]/memberships — list + add project memberships
 * (Milestone 3L).
 *
 *   GET → 200 { memberships, my_membership } (any active member can view)
 *       → 401 INVALID_SESSION
 *       → 403 PROJECT_ACCESS_DENIED
 *       → 404 PROJECT_NOT_FOUND
 *
 *   POST { actor_id, project_role } → 201 { membership, audit }
 *       → 400 BAD_BODY / BAD_ACTOR_ID / BAD_PROJECT_ROLE / UNKNOWN_ACTOR
 *       → 401 INVALID_SESSION
 *       → 403 if caller lacks `manage_memberships` (i.e. not owner)
 *       → 403 PROJECT_ROLE_REQUIRES_LAWYER if target actor's global
 *             role isn't human_lawyer but the project_role demands it
 *       → 404 PROJECT_NOT_FOUND
 *       → 409 ACTOR_ALREADY_MEMBER
 *
 * The set of valid target actors comes from the existing demo
 * registry today; a future real-auth milestone will replace it with
 * the user store. The validation surface is intentionally narrow:
 * unknown actor_id rejected up front, not silently re-mapped.
 */
import { NextResponse } from "next/server";
import {
  ActorAlreadyMemberError,
  ProjectNotFoundError,
  ProjectRoleRequiresLawyerError,
  addMembershipToProject,
  getProjectState,
} from "@/lib/server-store";
import {
  DEMO_SESSION_COOKIE_NAME,
  isProjectAccessDenied,
  isProjectPermissionDenied,
  loadActiveMembership,
  requireProjectMembership,
  requireProjectPermission,
  resolveActorFromRequest,
} from "@/lib/auth";
import {
  DEMO_ACTOR_REGISTRY,
  UnknownActorError,
  resolveDemoActor,
} from "@/lib/demo-actors";
import { projectRoleSchema, type ProjectRole } from "@contractops/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInvalidSession(err: unknown): err is { message: string; code: "INVALID_SESSION" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "INVALID_SESSION"
  );
}

// ─────────────────────────────────────────────────────────────────────
// GET — any active member can list the memberships
// ─────────────────────────────────────────────────────────────────────

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

  let myMembership;
  try {
    myMembership = requireProjectMembership(state, actor.id);
  } catch (err) {
    if (isProjectAccessDenied(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 403 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    memberships: state.memberships ?? [],
    my_membership: myMembership,
  });
}

// ─────────────────────────────────────────────────────────────────────
// POST — owner_lawyer adds a new membership
// ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request, ctx: { params: { id: string } }) {
  const id = ctx.params.id;

  let body: { actor_id?: unknown; project_role?: unknown };
  try {
    body = (await request.json()) as { actor_id?: unknown; project_role?: unknown };
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }
  const rawId = body.actor_id;
  if (typeof rawId !== "string" || rawId.length === 0) {
    return NextResponse.json(
      {
        error: "actor_id is required and must be a non-empty string",
        code: "BAD_ACTOR_ID",
      },
      { status: 400 },
    );
  }
  const rawRole = body.project_role;
  const parsed = projectRoleSchema.safeParse(rawRole);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "project_role must be one of: owner_lawyer, reviewer_lawyer, business_contributor, business_viewer",
        code: "BAD_PROJECT_ROLE",
      },
      { status: 400 },
    );
  }
  const targetRole: ProjectRole = parsed.data;

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

  // Caller must have manage_memberships (owner_lawyer only today).
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

  // Resolve the TARGET actor via the demo registry. The membership
  // helper performs the lawyer-role↔project-role consistency check.
  let target;
  try {
    target = resolveDemoActor(rawId);
  } catch (err) {
    if (err instanceof UnknownActorError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    const { membership, audit } = await addMembershipToProject(
      id,
      { actor: target, project_role: targetRole },
      actor,
    );
    return NextResponse.json({ membership, audit }, { status: 201 });
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 404 },
      );
    }
    if (err instanceof ActorAlreadyMemberError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 },
      );
    }
    if (err instanceof ProjectRoleRequiresLawyerError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 403 },
      );
    }
    throw err;
  }
}

// Suppress unused-import warning — registry imported for future use
// (e.g. listing addable actors). Not strictly required today.
void DEMO_ACTOR_REGISTRY;
void loadActiveMembership;
