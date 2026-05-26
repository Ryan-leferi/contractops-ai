/**
 * Project-level permission matrix (Milestone 3L).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Source of truth for "can role X perform permission Y?".      │
 *   │ Read by the route-level authorization layer                  │
 *   │ (`project-authz.ts`); the matrix itself is a pure data table │
 *   │ — no React, no env, no I/O.                                  │
 *   │                                                              │
 *   │ Extending: adding a new Permission requires (a) extending    │
 *   │ the union below, (b) deciding which roles get it in          │
 *   │ PROJECT_ROLE_MATRIX, (c) covering it in                      │
 *   │ tests/permissions.test.ts. Adding a new ProjectRole requires │
 *   │ extending `projectRoleSchema` in @contractops/schemas first. │
 *   │                                                              │
 *   │ Permission ≠ Operation name. Several operations may map to   │
 *   │ the same permission (e.g. `add_source` + `add_source_content`│
 *   │ both require `add_source`). The mapping lives in             │
 *   │ `mapOperationToPermission` in this file.                     │
 *   └──────────────────────────────────────────────────────────────┘
 */
import type { ProjectRole } from "@contractops/schemas";
import type { Operation, OperationName } from "@/lib/operations";

/**
 * Closed set of project-level permissions. Each one is checked by
 * exactly one route or one operation; there are no compound
 * permissions ("approve_anything") in 3L.
 */
export type Permission =
  // ── Read-side ───────────────────────────────────────────────
  | "view_project"            // GET /api/projects/[id] + workflow page views
  | "view_audit_log"          // GET /api/projects/[id]/audit-logs (internal)
  | "view_decision_history"   // GET /api/projects/[id]/decision-history (internal)
  | "view_memberships"        // GET /api/projects/[id]/memberships
  // ── Membership management ───────────────────────────────────
  | "manage_memberships"      // POST + DELETE memberships
  // ── Source pack ─────────────────────────────────────────────
  | "add_source"              // add_source + add_source_content (pre-lock)
  | "lock_source_pack"        // lock_source_pack
  // ── Workflow setup ──────────────────────────────────────────
  | "confirm_contract_type"   // classify_and_confirm
  | "select_playbook"         // select_playbook
  | "answer_intake"           // answer_intake
  // ── Drafting ────────────────────────────────────────────────
  | "draft_deal_memo"         // draft_deal_memo
  | "approve_deal_memo"       // approve_deal_memo
  | "draft_drafting_plan"     // draft_drafting_plan
  | "approve_drafting_plan"   // approve_drafting_plan
  | "create_v0"               // create_v0
  // ── Review + QA ─────────────────────────────────────────────
  | "run_mock_reviews"        // run_mock_reviews
  | "decide_issue"            // decide_issue
  | "create_revision"         // create_revision
  | "run_qa"                  // run_mock_final_qa
  // ── Final approval + export ─────────────────────────────────
  | "approve_final"           // approve_final (owner only)
  | "export_clean"            // clean_docx + cover_email (any member)
  | "export_internal"         // commentary_docx + negotiation_matrix (lawyers only)
  // ── Pilot P1 — Solo Drafting Loop ───────────────────────────
  | "run_draft_loop"          // create_draft_iteration / synthesize_reviews / stop_draft_loop
  | "batch_accept_issues";    // batch_accept_review_issues (lawyer-only, audited per card)

/**
 * The matrix. Each role maps to the EXHAUSTIVE set of permissions it
 * holds. Missing means denied — there is no "deny override". The
 * defaults are:
 *
 *   owner_lawyer         — every permission.
 *   reviewer_lawyer      — everything EXCEPT the four approval +
 *                           membership-management permissions.
 *   business_contributor — view + (pre-lock) sources + intake +
 *                           clean exports. No lawyer ops.
 *   business_viewer      — view + clean exports. Read-only.
 *
 * `LAWYER_PROJECT_ROLES` in `@contractops/schemas` already enforces
 * that ONLY `human_lawyer` actors may be granted owner / reviewer;
 * the matrix below assumes that invariant holds.
 */
export const PROJECT_ROLE_MATRIX: Record<ProjectRole, ReadonlySet<Permission>> = {
  owner_lawyer: new Set<Permission>([
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
    "run_draft_loop",
    "batch_accept_issues",
  ]),
  reviewer_lawyer: new Set<Permission>([
    "view_project",
    "view_audit_log",
    "view_decision_history",
    "view_memberships",
    "add_source",
    "lock_source_pack",
    "confirm_contract_type",
    "select_playbook",
    "answer_intake",
    "draft_deal_memo",
    "draft_drafting_plan",
    "create_v0",
    "run_mock_reviews",
    "decide_issue",
    "create_revision",
    "run_qa",
    "export_clean",
    "export_internal",
    "run_draft_loop",
    "batch_accept_issues",
  ]),
  business_contributor: new Set<Permission>([
    "view_project",
    "view_memberships",
    "add_source",
    "answer_intake",
    "export_clean",
  ]),
  business_viewer: new Set<Permission>([
    "view_project",
    "view_memberships",
    "export_clean",
  ]),
};

/** Permission check. `false` if `role` is missing from the matrix. */
export function can(role: ProjectRole, perm: Permission): boolean {
  return PROJECT_ROLE_MATRIX[role]?.has(perm) ?? false;
}

/**
 * Map a workflow operation to the single permission that gates it.
 *
 * Returning `null` means the operation is NOT covered by the matrix
 * and the route MUST deny it by default. This is the safer failure
 * mode — adding a new Operation to `lib/operations.ts` without
 * touching this map fails closed, not open.
 */
export function mapOperationToPermission(op: Operation): Permission | null {
  // Switch is exhaustive over OperationName — TypeScript would
  // complain if a new variant landed without a case. Note that the
  // export-by-type permission lives elsewhere (`mapExportTypeToPermission`)
  // because the `create_export` op carries the export type in args.
  const name: OperationName = op.name;
  switch (name) {
    case "add_source":
    case "add_source_content":
      return "add_source";
    case "lock_source_pack":
      return "lock_source_pack";
    case "classify_and_confirm":
      return "confirm_contract_type";
    case "select_playbook":
      return "select_playbook";
    case "answer_intake":
      return "answer_intake";
    case "draft_deal_memo":
      return "draft_deal_memo";
    case "approve_deal_memo":
      return "approve_deal_memo";
    case "draft_drafting_plan":
      return "draft_drafting_plan";
    case "approve_drafting_plan":
      return "approve_drafting_plan";
    case "create_v0":
      return "create_v0";
    case "run_mock_reviews":
      return "run_mock_reviews";
    case "decide_issue":
      return "decide_issue";
    case "run_mock_final_qa":
      return "run_qa";
    case "create_revision":
      return "create_revision";
    case "approve_final":
      return "approve_final";
    case "create_export": {
      // export gating depends on the export_type carried in args.
      // `mapExportTypeToPermission` does the type→perm translation;
      // the operation dispatch never branches on type itself.
      const exportType = (op.args as { export_type?: string }).export_type;
      return mapExportTypeToPermission(exportType);
    }
    case "create_draft_iteration":
    case "synthesize_reviews":
    case "stop_draft_loop":
      return "run_draft_loop";
    case "batch_accept_review_issues":
      return "batch_accept_issues";
    default: {
      // Exhaustiveness sentinel — fails the build if OperationName
      // grows a new variant that wasn't added here.
      const _exhaustive: never = name;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Export-type → permission lookup. `clean_docx` + `cover_email` are
 * "external" outputs any project member can produce; `commentary_docx`
 * + `negotiation_matrix` are "internal" outputs and require a lawyer
 * project role (PLATFORM_BRIEF.md §5 rule 7: internal commentary
 * must never reach external audiences).
 */
export function mapExportTypeToPermission(
  exportType: string | undefined,
): Permission | null {
  if (exportType === "clean_docx" || exportType === "cover_email") {
    return "export_clean";
  }
  if (exportType === "commentary_docx" || exportType === "negotiation_matrix") {
    return "export_internal";
  }
  return null;
}
