import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  STATUS_ORDER,
  WorkflowError,
  aggAddSource,
  aggApproveDealMemo,
  aggApproveDraftingPlan,
  aggApproveFinal,
  aggClassifyAndConfirm,
  aggCreateProject,
  aggCreateRevision,
  aggCreateV0,
  aggDecideIssue,
  aggDraftDealMemo,
  aggDraftDraftingPlan,
  aggLockSourcePack,
  aggRunMockReviews,
  aggSelectPlaybook,
  assertStatusAtLeast,
  assertStatusOneOf,
  createMockAggregateContext,
  statusRank,
  withStatus,
} from "@contractops/core";
import {
  humanLawyer,
  loadAllPlaybooks,
  loadPlaybook,
  testEnv,
  user,
} from "./helpers";

describe("Status order and guards", () => {
  it("STATUS_ORDER covers all 17 workflow stages", () => {
    expect(STATUS_ORDER.length).toBe(17);
    expect(STATUS_ORDER[0]).toBe("created");
    expect(STATUS_ORDER[STATUS_ORDER.length - 1]).toBe("exported");
  });

  it("statusRank is monotonic", () => {
    for (let i = 1; i < STATUS_ORDER.length; i++) {
      expect(statusRank(STATUS_ORDER[i]!)).toBeGreaterThan(statusRank(STATUS_ORDER[i - 1]!));
    }
  });

  it("assertStatusOneOf rejects unexpected status", () => {
    expect(() => assertStatusOneOf("created", ["sources_uploaded"])).toThrowError(WorkflowError);
    expect(() => assertStatusOneOf("created", ["created"])).not.toThrow();
  });

  it("assertStatusAtLeast rejects earlier statuses", () => {
    expect(() => assertStatusAtLeast("created", "playbook_selected")).toThrowError(WorkflowError);
    expect(() => assertStatusAtLeast("issues_open", "issues_open")).not.toThrow();
    expect(() => assertStatusAtLeast("exported", "issues_open")).not.toThrow();
  });

  it("withStatus is idempotent if already at or past target", () => {
    const project = {
      id: "p",
      name: "x",
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "u",
      status: "playbook_selected" as const,
    };
    expect(withStatus(project, "playbook_selected")).toBe(project);
    expect(withStatus(project, "type_confirmed")).toBe(project);
    const next = withStatus(project, "intake_in_progress");
    expect(next.status).toBe("intake_in_progress");
  });
});

describe("Project.status advances through expected workflow states", () => {
  async function buildToFinal() {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    let s = created.state;
    expect(s.project.status).toBe("created");

    s = aggAddSource(s, {
      file_name: "proposal.pdf",
      source_type: "proposal",
      version: "1",
      incorporated: true,
      source_priority: 1,
      uploaded_by: user,
    }, env).state;
    expect(s.project.status).toBe("sources_uploaded");

    s = aggLockSourcePack(s, user, env).state;
    expect(s.project.status).toBe("source_pack_locked");

    s = aggClassifyAndConfirm(s, {
      confirmed_type: "NDA",
      confirmed_by: humanLawyer,
      hint: "NDA",
    }, env).state;
    expect(s.project.status).toBe("type_confirmed");

    s = aggSelectPlaybook(s, {
      available_playbooks: loadAllPlaybooks(),
      selector: humanLawyer,
    }, env).state;
    expect(s.project.status).toBe("intake_in_progress");

    // Answer all required intake questions
    for (const q of s.intake_questions.filter((q) => q.required)) {
      s = {
        ...s,
        intake_answers: [
          ...s.intake_answers,
          {
            id: env.newId(),
            project_id: s.project.id,
            question_id: q.id,
            value: "answer",
            answered_by: user.id,
            answered_at: env.now(),
          },
        ],
      };
    }

    const ctx = createMockAggregateContext({ env, actor: humanLawyer });

    s = (await aggDraftDealMemo(s, ctx)).state;
    expect(s.project.status).toBe("deal_memo_drafted");

    s = aggApproveDealMemo(s, humanLawyer, env).state;
    expect(s.project.status).toBe("deal_memo_approved");

    s = (await aggDraftDraftingPlan(s, ctx)).state;
    expect(s.project.status).toBe("drafting_plan_drafted");

    s = aggApproveDraftingPlan(s, humanLawyer, env).state;
    expect(s.project.status).toBe("drafting_plan_approved");

    s = (await aggCreateV0(s, ctx)).state;
    expect(s.project.status).toBe("draft_v0_created");

    s = (await aggRunMockReviews(s, ctx)).state;
    expect(s.project.status).toBe("issues_open");

    if (s.issue_cards.length > 0) {
      s = aggDecideIssue(s, {
        issue_id: s.issue_cards[0]!.issue_id,
        decision: "accepted",
        decided_by: humanLawyer,
      }, env).state;
    }
    expect(s.project.status).toBe("issues_open");

    s = (await aggCreateRevision(s, ctx)).state;
    expect(s.project.status).toBe("revised");

    s = aggApproveFinal(s, humanLawyer, env).state;
    expect(s.project.status).toBe("final_approved");

    return { s, env };
  }

  it("advances through every workflow state in order", async () => {
    const { s } = await buildToFinal();
    expect(s.project.status).toBe("final_approved");
  });
});

describe("Out-of-order operations fail due to status guard", () => {
  it("rejects aggLockSourcePack before any source upload", () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    expect(() => aggLockSourcePack(created.state, user, env)).toThrowError(/Invalid workflow transition/);
  });

  it("rejects aggClassifyAndConfirm before lock", () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    const added = aggAddSource(created.state, {
      file_name: "x.pdf",
      source_type: "proposal",
      version: "1",
      incorporated: true,
      source_priority: 1,
      uploaded_by: user,
    }, env);
    expect(() =>
      aggClassifyAndConfirm(added.state, {
        confirmed_type: "NDA",
        confirmed_by: humanLawyer,
      }, env),
    ).toThrowError(/Invalid workflow transition/);
  });

  it("rejects aggSelectPlaybook before type is confirmed", () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    expect(() =>
      aggSelectPlaybook(created.state, {
        available_playbooks: loadAllPlaybooks(),
        selector: humanLawyer,
      }, env),
    ).toThrowError(/Invalid workflow transition/);
  });

  it("rejects aggDraftDealMemo before intake_in_progress", async () => {
    const env = testEnv();
    const ctx = createMockAggregateContext({ env });
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    await expect(aggDraftDealMemo(created.state, ctx)).rejects.toThrowError(
      /Invalid workflow transition/,
    );
  });

  it("rejects aggCreateV0 before drafting_plan_approved", async () => {
    const env = testEnv();
    const ctx = createMockAggregateContext({ env });
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    await expect(aggCreateV0(created.state, ctx)).rejects.toThrowError(
      /Invalid workflow transition/,
    );
  });
});
