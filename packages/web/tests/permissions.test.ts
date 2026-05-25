/**
 * Permission matrix + operation/export mappers (Milestone 3L).
 *
 * Pure-function tests. The matrix is small enough that we assert the
 * exhaustive truth table — adding a permission requires updating the
 * matrix AND extending the tests below, which is the point.
 */
import { describe, expect, it } from "vitest";

import {
  PROJECT_ROLE_MATRIX,
  type Permission,
  can,
  mapExportTypeToPermission,
  mapOperationToPermission,
} from "../lib/auth";
import type { Operation } from "../lib/operations";

const ALL_ROLES = [
  "owner_lawyer",
  "reviewer_lawyer",
  "business_contributor",
  "business_viewer",
] as const;

const ALL_PERMISSIONS: Permission[] = [
  "view_project",
  "view_audit_log",
  "view_decision_history",
  "view_memberships",
  "manage_memberships",
  "add_source",
  "lock_source_pack",
  "confirm_contract_type",
  "select_playbook",
  "answer_intake",
  "draft_deal_memo",
  "approve_deal_memo",
  "draft_drafting_plan",
  "approve_drafting_plan",
  "create_v0",
  "run_mock_reviews",
  "decide_issue",
  "create_revision",
  "run_qa",
  "approve_final",
  "export_clean",
  "export_internal",
];

describe("PROJECT_ROLE_MATRIX — owner_lawyer holds EVERY permission", () => {
  for (const perm of ALL_PERMISSIONS) {
    it(`owner_lawyer can ${perm}`, () => {
      expect(can("owner_lawyer", perm)).toBe(true);
    });
  }
});

describe("PROJECT_ROLE_MATRIX — reviewer_lawyer excludes approvals + membership management", () => {
  const DENIED_FOR_REVIEWER: Permission[] = [
    "approve_deal_memo",
    "approve_drafting_plan",
    "approve_final",
    "manage_memberships",
  ];
  for (const perm of DENIED_FOR_REVIEWER) {
    it(`reviewer_lawyer cannot ${perm}`, () => {
      expect(can("reviewer_lawyer", perm)).toBe(false);
    });
  }
  it("reviewer_lawyer can decide_issue + run_qa + run_mock_reviews (per spec)", () => {
    expect(can("reviewer_lawyer", "decide_issue")).toBe(true);
    expect(can("reviewer_lawyer", "run_qa")).toBe(true);
    expect(can("reviewer_lawyer", "run_mock_reviews")).toBe(true);
  });
  it("reviewer_lawyer can view audit + decision history (lawyer-only reads)", () => {
    expect(can("reviewer_lawyer", "view_audit_log")).toBe(true);
    expect(can("reviewer_lawyer", "view_decision_history")).toBe(true);
  });
  it("reviewer_lawyer can export both clean AND internal (internal == lawyer-only)", () => {
    expect(can("reviewer_lawyer", "export_clean")).toBe(true);
    expect(can("reviewer_lawyer", "export_internal")).toBe(true);
  });
});

describe("PROJECT_ROLE_MATRIX — business_contributor: sources + intake only", () => {
  it("can view + add_source + answer_intake + export_clean", () => {
    expect(can("business_contributor", "view_project")).toBe(true);
    expect(can("business_contributor", "add_source")).toBe(true);
    expect(can("business_contributor", "answer_intake")).toBe(true);
    expect(can("business_contributor", "export_clean")).toBe(true);
  });
  it("cannot lock_source_pack / approve / decide / export internal", () => {
    expect(can("business_contributor", "lock_source_pack")).toBe(false);
    expect(can("business_contributor", "approve_deal_memo")).toBe(false);
    expect(can("business_contributor", "approve_drafting_plan")).toBe(false);
    expect(can("business_contributor", "approve_final")).toBe(false);
    expect(can("business_contributor", "decide_issue")).toBe(false);
    expect(can("business_contributor", "export_internal")).toBe(false);
    expect(can("business_contributor", "view_audit_log")).toBe(false);
    expect(can("business_contributor", "view_decision_history")).toBe(false);
    expect(can("business_contributor", "manage_memberships")).toBe(false);
  });
});

describe("PROJECT_ROLE_MATRIX — business_viewer: read-only", () => {
  it("can view_project + export_clean", () => {
    expect(can("business_viewer", "view_project")).toBe(true);
    expect(can("business_viewer", "export_clean")).toBe(true);
  });
  it("cannot mutate ANYTHING in the workflow", () => {
    for (const perm of [
      "add_source",
      "answer_intake",
      "lock_source_pack",
      "approve_deal_memo",
      "decide_issue",
      "approve_final",
      "export_internal",
      "manage_memberships",
    ] as Permission[]) {
      expect(can("business_viewer", perm)).toBe(false);
    }
  });
});

describe("Matrix invariants", () => {
  it("every role appears in the matrix with at least view_project", () => {
    for (const role of ALL_ROLES) {
      expect(PROJECT_ROLE_MATRIX[role]).toBeDefined();
      expect(can(role, "view_project")).toBe(true);
    }
  });

  it("only owner_lawyer has manage_memberships", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "manage_memberships")).toBe(role === "owner_lawyer");
    }
  });

  it("only owner_lawyer has approve_final", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "approve_final")).toBe(role === "owner_lawyer");
    }
  });

  it("export_internal is lawyer-only (owner or reviewer)", () => {
    expect(can("owner_lawyer", "export_internal")).toBe(true);
    expect(can("reviewer_lawyer", "export_internal")).toBe(true);
    expect(can("business_contributor", "export_internal")).toBe(false);
    expect(can("business_viewer", "export_internal")).toBe(false);
  });

  it("export_clean is open to every member (per spec)", () => {
    for (const role of ALL_ROLES) {
      expect(can(role, "export_clean")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// mapOperationToPermission
// ─────────────────────────────────────────────────────────────────────

describe("mapOperationToPermission", () => {
  it("returns the right permission for every Operation variant", () => {
    const mapping: Record<string, Permission> = {
      add_source: "add_source",
      add_source_content: "add_source",
      lock_source_pack: "lock_source_pack",
      classify_and_confirm: "confirm_contract_type",
      select_playbook: "select_playbook",
      answer_intake: "answer_intake",
      draft_deal_memo: "draft_deal_memo",
      approve_deal_memo: "approve_deal_memo",
      draft_drafting_plan: "draft_drafting_plan",
      approve_drafting_plan: "approve_drafting_plan",
      create_v0: "create_v0",
      run_mock_reviews: "run_mock_reviews",
      decide_issue: "decide_issue",
      run_mock_final_qa: "run_qa",
      create_revision: "create_revision",
      approve_final: "approve_final",
    };
    for (const [name, expected] of Object.entries(mapping)) {
      const op = { name, args: {} } as unknown as Operation;
      expect(mapOperationToPermission(op)).toBe(expected);
    }
  });

  it("create_export → export_clean when type is clean_docx/cover_email", () => {
    const ops: Operation[] = [
      { name: "create_export", args: { export_type: "clean_docx" } as never } as Operation,
      { name: "create_export", args: { export_type: "cover_email" } as never } as Operation,
    ];
    for (const op of ops) {
      expect(mapOperationToPermission(op)).toBe("export_clean");
    }
  });

  it("create_export → export_internal when type is commentary_docx/negotiation_matrix", () => {
    const ops: Operation[] = [
      { name: "create_export", args: { export_type: "commentary_docx" } as never } as Operation,
      { name: "create_export", args: { export_type: "negotiation_matrix" } as never } as Operation,
    ];
    for (const op of ops) {
      expect(mapOperationToPermission(op)).toBe("export_internal");
    }
  });

  it("create_export → null for an unknown export type (fail closed)", () => {
    const op = {
      name: "create_export",
      args: { export_type: "spreadsheet_xlsx" },
    } as unknown as Operation;
    expect(mapOperationToPermission(op)).toBeNull();
  });
});

describe("mapExportTypeToPermission", () => {
  it("clean_docx + cover_email → export_clean", () => {
    expect(mapExportTypeToPermission("clean_docx")).toBe("export_clean");
    expect(mapExportTypeToPermission("cover_email")).toBe("export_clean");
  });
  it("commentary_docx + negotiation_matrix → export_internal", () => {
    expect(mapExportTypeToPermission("commentary_docx")).toBe("export_internal");
    expect(mapExportTypeToPermission("negotiation_matrix")).toBe("export_internal");
  });
  it("unknown / undefined → null (fail closed)", () => {
    expect(mapExportTypeToPermission("xlsx")).toBeNull();
    expect(mapExportTypeToPermission(undefined)).toBeNull();
  });
});
