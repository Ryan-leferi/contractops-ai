/**
 * Project membership + minimal RBAC schema (Milestone 3L).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Membership is per-PROJECT (an actor can be a member of many  │
 *   │ projects with different roles in each). Membership is        │
 *   │ separate from `Actor.role` — the global role (`human_lawyer` │
 *   │ vs `user`) gates which project_roles an actor may HOLD; the  │
 *   │ project_role gates what they may DO in this project.         │
 *   │                                                              │
 *   │ Lawyer-typed roles (`owner_lawyer`, `reviewer_lawyer`) MUST  │
 *   │ only be granted to actors whose global `Actor.role` is       │
 *   │ `human_lawyer`. Enforced server-side by                      │
 *   │ `addMembershipToProject` (3L Phase C) and tested.            │
 *   │                                                              │
 *   │ NOT an enterprise identity model — no group sync, no         │
 *   │ org-level multi-tenancy, no per-resource ACLs. Production    │
 *   │ deployment must layer real SSO + group-derived membership    │
 *   │ on top (post-Alpha). See ADR-019.                            │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

/**
 * Closed set of project roles. Adding a new variant requires
 * (a) extending this enum, (b) adding a row to the PROJECT_ROLE_MATRIX
 * in `packages/web/lib/auth/permissions.ts`, (c) covering it in
 * `tests/permissions.test.ts`.
 *
 *   owner_lawyer          — full access (creator role; can manage memberships).
 *   reviewer_lawyer       — full LAWYER access EXCEPT approvals + membership
 *                            management. Decides Issue Cards, runs reviews/QA.
 *   business_contributor  — adds source documents + content (pre-lock) and
 *                            answers intake. Cannot approve, decide, or
 *                            access internal exports.
 *   business_viewer       — read-only project view + clean exports. Cannot
 *                            mutate any workflow state.
 */
export const projectRoleSchema = z.enum([
  "owner_lawyer",
  "reviewer_lawyer",
  "business_contributor",
  "business_viewer",
]);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

export const PROJECT_ROLES: readonly ProjectRole[] = [
  "owner_lawyer",
  "reviewer_lawyer",
  "business_contributor",
  "business_viewer",
] as const;

/** Lawyer-typed roles. Granting these requires `Actor.role === "human_lawyer"`. */
export const LAWYER_PROJECT_ROLES: ReadonlySet<ProjectRole> = new Set([
  "owner_lawyer",
  "reviewer_lawyer",
]);

export function isLawyerProjectRole(role: ProjectRole): boolean {
  return LAWYER_PROJECT_ROLES.has(role);
}

/**
 * A single (actor, project, role) triple. Memberships live INSIDE
 * `ProjectState.memberships` (see ADR-019) so they share the
 * persistence path with the rest of the project — memory / file /
 * postgres adapters all work without new methods.
 *
 * Mutation contract:
 *   - createProject seeds exactly one owner_lawyer membership for the
 *     creator (rejected if the creator is not a human_lawyer).
 *   - addMembershipToProject appends a new entry and emits a
 *     `membership_created` AuditLog.
 *   - disableMembershipInProject sets `disabled_at` (never deletes
 *     the row) and emits a `membership_disabled` AuditLog. Disabled
 *     entries are kept for the audit trail; `findActiveMembership`
 *     ignores them.
 *
 * No "edit role" path in 3L — to change a role, disable the old
 * membership and add a new one. Keeps the audit trail unambiguous.
 */
export const projectMembershipSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  actor_id: z.string().min(1),
  project_role: projectRoleSchema,
  created_at: isoDateTimeSchema,
  /** Actor id of whoever granted this membership. */
  created_by: z.string().min(1),
  /** ISO 8601 timestamp when the membership was disabled, or null. */
  disabled_at: isoDateTimeSchema.nullable().default(null),
});
export type ProjectMembership = z.infer<typeof projectMembershipSchema>;
