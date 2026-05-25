/**
 * Project-level authorization helpers (Milestone 3L).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Every route that touches a single project calls one of:      │
 *   │                                                              │
 *   │   loadActiveMembership(state, actorId)                       │
 *   │     → ProjectMembership | null                               │
 *   │   requireProjectMembership(state, actorId)                   │
 *   │     → ProjectMembership   (throws ProjectAccessDeniedError)  │
 *   │   requireProjectPermission(state, actorId, perm)             │
 *   │     → ProjectMembership   (throws on either deny path)       │
 *   │                                                              │
 *   │ The route handlers turn `ProjectAccessDeniedError` into 403  │
 *   │ — never silently downgrade to 200 / empty. The boundary is   │
 *   │ symmetrical with `InvalidSessionError` from 3I/3J.           │
 *   │                                                              │
 *   │ NOT a substitute for the core role guard. Core's             │
 *   │ `actor.role === "human_lawyer"` check is STILL the           │
 *   │ authoritative defense for lawyer-only aggregate ops; the     │
 *   │ membership layer adds project-scoped specificity on top.     │
 *   └──────────────────────────────────────────────────────────────┘
 */
import type * as core from "@contractops/core";
import type { ProjectMembership } from "@contractops/schemas";
import { can, type Permission } from "./permissions";

/**
 * Thrown when an actor has NO active membership in a project. The
 * routes map it to HTTP 403 — distinct from 404 (project doesn't
 * exist), 401 (no session), and 422 (operation forbidden by
 * workflow rules).
 *
 * Routes that need to hide existence (e.g. don't leak "this project
 * exists, you just can't see it" to an unauthenticated user) should
 * use the same 403 response shape used here; that's a deliberate
 * uniform-error policy, not an oversight.
 */
export class ProjectAccessDeniedError extends Error {
  readonly code = "PROJECT_ACCESS_DENIED";
  constructor(
    public readonly project_id: string,
    public readonly actor_id: string,
    public readonly reason: "no_membership" | "membership_disabled",
  ) {
    super(
      `actor "${actor_id}" cannot access project "${project_id}" (${reason})`,
    );
  }
}

/**
 * Thrown when an actor HAS membership but the role lacks the
 * permission required by the route / operation. HTTP 403 with a
 * different `code` so dashboards can distinguish "outsider" from
 * "insider, but not allowed".
 */
export class ProjectPermissionDeniedError extends Error {
  readonly code = "PROJECT_PERMISSION_DENIED";
  constructor(
    public readonly project_id: string,
    public readonly actor_id: string,
    public readonly project_role: string,
    public readonly required_permission: Permission,
  ) {
    super(
      `actor "${actor_id}" (project_role=${project_role}) lacks permission ` +
        `"${required_permission}" in project "${project_id}"`,
    );
  }
}

/**
 * Return the single ACTIVE membership for `actorId` in `state`, or
 * `null` if the actor has no active membership.
 *
 * The "single membership per actor per project" invariant is
 * enforced at write time by `addMembershipToProject` (3L Phase C);
 * here we defensively pick the most recent active entry if duplicates
 * somehow exist.
 */
export function loadActiveMembership(
  state: core.ProjectState,
  actorId: string,
): ProjectMembership | null {
  const active = (state.memberships ?? []).filter(
    (m) => m.actor_id === actorId && m.disabled_at === null,
  );
  if (active.length === 0) return null;
  // Most recent wins if multiple — should not normally happen.
  return active.reduce((latest, m) =>
    m.created_at > latest.created_at ? m : latest,
  );
}

/**
 * Like `loadActiveMembership` but throws `ProjectAccessDeniedError`
 * instead of returning null. Use this in routes that ALWAYS require
 * membership (the common case).
 */
export function requireProjectMembership(
  state: core.ProjectState,
  actorId: string,
): ProjectMembership {
  const m = loadActiveMembership(state, actorId);
  if (m) return m;
  // Distinguish "never a member" from "was a member but disabled" so
  // ops dashboards can spot revoked actors that keep trying.
  const everMember = (state.memberships ?? []).some((x) => x.actor_id === actorId);
  throw new ProjectAccessDeniedError(
    state.project.id,
    actorId,
    everMember ? "membership_disabled" : "no_membership",
  );
}

/**
 * Membership lookup + permission check in one call. Returns the
 * membership on success; throws `ProjectAccessDeniedError` (no
 * membership) or `ProjectPermissionDeniedError` (membership lacks
 * the permission) on failure.
 *
 * The membership is returned so the caller can stamp it into the
 * audit log or response without a second lookup.
 */
export function requireProjectPermission(
  state: core.ProjectState,
  actorId: string,
  perm: Permission,
): ProjectMembership {
  const m = requireProjectMembership(state, actorId);
  if (!can(m.project_role, perm)) {
    throw new ProjectPermissionDeniedError(
      state.project.id,
      actorId,
      m.project_role,
      perm,
    );
  }
  return m;
}

/**
 * True iff `actorId` has any active membership in `state`. Cheap
 * predicate for `GET /api/projects` list filtering — avoids the
 * "throw + catch" overhead for the read path.
 */
export function isProjectVisibleTo(
  state: core.ProjectState,
  actorId: string,
): boolean {
  return loadActiveMembership(state, actorId) !== null;
}

/**
 * Predicate helpers for typed error matching in routes. Match by
 * `code` rather than `instanceof` for the same Next-dev module-
 * duplication reason documented in 3I (each route compiles its own
 * copy of the error class).
 */
export function isProjectAccessDenied(
  err: unknown,
): err is { message: string; code: "PROJECT_ACCESS_DENIED" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "PROJECT_ACCESS_DENIED"
  );
}

export function isProjectPermissionDenied(
  err: unknown,
): err is { message: string; code: "PROJECT_PERMISSION_DENIED" } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "PROJECT_PERMISSION_DENIED"
  );
}
