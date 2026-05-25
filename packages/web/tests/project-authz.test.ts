/**
 * Project-level authorization helpers (Milestone 3L).
 *
 * Pure-function tests against synthetic ProjectState fixtures.
 */
import { describe, expect, it } from "vitest";

import type * as core from "@contractops/core";
import type { ProjectMembership, ProjectRole } from "@contractops/schemas";
import {
  ProjectAccessDeniedError,
  ProjectPermissionDeniedError,
  isProjectAccessDenied,
  isProjectPermissionDenied,
  isProjectVisibleTo,
  loadActiveMembership,
  requireProjectMembership,
  requireProjectPermission,
} from "../lib/auth";

function makeState(memberships: ProjectMembership[]): core.ProjectState {
  return {
    project: {
      id: "proj_x",
      name: "Test",
      status: "created",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "lawyer_kim",
    },
    source_pack: {
      id: "sp_x",
      project_id: "proj_x",
      locked: false,
      locked_at: null,
      document_ids: [],
    },
    source_documents: [],
    source_contents: [],
    contract_type: null,
    playbook: null,
    intake_questions: [],
    intake_answers: [],
    deal_memo: null,
    drafting_plan: null,
    contract_versions: [],
    issue_cards: [],
    agent_runs: [],
    exports: [],
    qa_runs: [],
    decision_history: [],
    memberships,
  } as unknown as core.ProjectState;
}

function membership(
  actorId: string,
  role: ProjectRole,
  opts: { disabled?: boolean; id?: string } = {},
): ProjectMembership {
  return {
    id: opts.id ?? `mem_${actorId}_${role}`,
    project_id: "proj_x",
    actor_id: actorId,
    project_role: role,
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "lawyer_kim",
    disabled_at: opts.disabled ? "2026-01-02T00:00:00.000Z" : null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// loadActiveMembership + isProjectVisibleTo
// ─────────────────────────────────────────────────────────────────────

describe("loadActiveMembership / isProjectVisibleTo", () => {
  it("returns null when actor has no membership", () => {
    const state = makeState([membership("lawyer_kim", "owner_lawyer")]);
    expect(loadActiveMembership(state, "lawyer_park")).toBeNull();
    expect(isProjectVisibleTo(state, "lawyer_park")).toBe(false);
  });

  it("returns the active membership when present", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("lawyer_park", "reviewer_lawyer"),
    ]);
    const m = loadActiveMembership(state, "lawyer_park");
    expect(m).not.toBeNull();
    expect(m!.project_role).toBe("reviewer_lawyer");
    expect(isProjectVisibleTo(state, "lawyer_park")).toBe(true);
  });

  it("ignores disabled memberships", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("lawyer_park", "reviewer_lawyer", { disabled: true }),
    ]);
    expect(loadActiveMembership(state, "lawyer_park")).toBeNull();
    expect(isProjectVisibleTo(state, "lawyer_park")).toBe(false);
  });

  it("returns the most-recent active membership on duplicates", () => {
    const state = makeState([
      {
        ...membership("lawyer_kim", "reviewer_lawyer", { id: "mem_old" }),
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        ...membership("lawyer_kim", "owner_lawyer", { id: "mem_new" }),
        created_at: "2026-02-01T00:00:00.000Z",
      },
    ]);
    expect(loadActiveMembership(state, "lawyer_kim")!.id).toBe("mem_new");
  });
});

// ─────────────────────────────────────────────────────────────────────
// requireProjectMembership
// ─────────────────────────────────────────────────────────────────────

describe("requireProjectMembership", () => {
  it("returns the active membership when present", () => {
    const state = makeState([membership("lawyer_kim", "owner_lawyer")]);
    expect(
      requireProjectMembership(state, "lawyer_kim").project_role,
    ).toBe("owner_lawyer");
  });

  it("throws ProjectAccessDeniedError(no_membership) when actor was never a member", () => {
    const state = makeState([membership("lawyer_kim", "owner_lawyer")]);
    try {
      requireProjectMembership(state, "lawyer_park");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectAccessDeniedError);
      expect((err as ProjectAccessDeniedError).reason).toBe("no_membership");
      expect((err as ProjectAccessDeniedError).code).toBe("PROJECT_ACCESS_DENIED");
    }
  });

  it("throws ProjectAccessDeniedError(membership_disabled) when actor was disabled", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("lawyer_park", "reviewer_lawyer", { disabled: true }),
    ]);
    try {
      requireProjectMembership(state, "lawyer_park");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectAccessDeniedError);
      expect((err as ProjectAccessDeniedError).reason).toBe(
        "membership_disabled",
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// requireProjectPermission
// ─────────────────────────────────────────────────────────────────────

describe("requireProjectPermission", () => {
  it("returns membership when role grants the permission", () => {
    const state = makeState([membership("lawyer_kim", "owner_lawyer")]);
    const m = requireProjectPermission(state, "lawyer_kim", "approve_final");
    expect(m.project_role).toBe("owner_lawyer");
  });

  it("throws ProjectPermissionDeniedError when role lacks the permission", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("lawyer_park", "reviewer_lawyer"),
    ]);
    try {
      requireProjectPermission(state, "lawyer_park", "approve_final");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectPermissionDeniedError);
      expect((err as ProjectPermissionDeniedError).code).toBe(
        "PROJECT_PERMISSION_DENIED",
      );
      expect((err as ProjectPermissionDeniedError).required_permission).toBe(
        "approve_final",
      );
    }
  });

  it("non-member fails the membership check BEFORE the permission check", () => {
    const state = makeState([membership("lawyer_kim", "owner_lawyer")]);
    try {
      requireProjectPermission(state, "lawyer_park", "view_project");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectAccessDeniedError);
    }
  });

  it("business_contributor cannot approve_deal_memo", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("business_choi", "business_contributor"),
    ]);
    expect(() =>
      requireProjectPermission(state, "business_choi", "approve_deal_memo"),
    ).toThrow(ProjectPermissionDeniedError);
  });

  it("business_contributor CAN answer_intake", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("business_choi", "business_contributor"),
    ]);
    const m = requireProjectPermission(state, "business_choi", "answer_intake");
    expect(m.project_role).toBe("business_contributor");
  });

  it("business_contributor cannot export_internal but CAN export_clean", () => {
    const state = makeState([
      membership("lawyer_kim", "owner_lawyer"),
      membership("business_choi", "business_contributor"),
    ]);
    expect(() =>
      requireProjectPermission(state, "business_choi", "export_internal"),
    ).toThrow(ProjectPermissionDeniedError);
    expect(
      requireProjectPermission(state, "business_choi", "export_clean").project_role,
    ).toBe("business_contributor");
  });
});

// ─────────────────────────────────────────────────────────────────────
// isProjectAccessDenied / isProjectPermissionDenied predicates
// ─────────────────────────────────────────────────────────────────────

describe("error predicate helpers", () => {
  it("isProjectAccessDenied matches the right shape, not random objects", () => {
    expect(
      isProjectAccessDenied(
        new ProjectAccessDeniedError("p", "a", "no_membership"),
      ),
    ).toBe(true);
    expect(
      isProjectAccessDenied(
        new ProjectPermissionDeniedError("p", "a", "owner_lawyer", "view_project"),
      ),
    ).toBe(false);
    expect(isProjectAccessDenied(null)).toBe(false);
    expect(isProjectAccessDenied({ code: "OTHER" })).toBe(false);
  });
  it("isProjectPermissionDenied matches only its code", () => {
    expect(
      isProjectPermissionDenied(
        new ProjectPermissionDeniedError("p", "a", "owner_lawyer", "view_project"),
      ),
    ).toBe(true);
    expect(
      isProjectPermissionDenied(
        new ProjectAccessDeniedError("p", "a", "no_membership"),
      ),
    ).toBe(false);
  });
});
