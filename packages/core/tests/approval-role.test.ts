import { describe, expect, it } from "vitest";
import {
  approveDealMemo,
  approveDraftingPlan,
  approveFinalVersion,
  createDealMemo,
  createDraftingPlan,
} from "@contractops/core";
import { buildToV0 } from "./scenarios";
import { humanLawyer, nonLawyer, otherLawyer, testEnv } from "./helpers";

describe("Human-lawyer approval role snapshots", () => {
  it("approveDealMemo records approved_by_role = human_lawyer", () => {
    const s = buildToV0("nda.json");
    expect(s.deal_memo?.approved_by_role).toBe("human_lawyer");
  });

  it("approveDraftingPlan records approved_by_role = human_lawyer", () => {
    const s = buildToV0("nda.json");
    expect(s.drafting_plan?.approved_by_role).toBe("human_lawyer");
  });

  it("approveFinalVersion records final_approved_by_role = human_lawyer", () => {
    const env = testEnv();
    const s = buildToV0("nda.json");
    const { version } = approveFinalVersion({
      version: s.v0!,
      approved_by: otherLawyer,
      env,
    });
    expect(version.final_approved_by_role).toBe("human_lawyer");
    expect(version.final_approved_by).toBe(otherLawyer.id);
  });

  it("non-lawyer cannot satisfy approveDealMemo", () => {
    const env = testEnv();
    const dm = createDealMemo({ project_id: "p", content: "x", env });
    expect(() =>
      approveDealMemo({
        deal_memo: dm,
        approved_by: nonLawyer,
        required_questions: [],
        answers: [],
        env,
      }),
    ).toThrowError(/requires a human lawyer/);
  });

  it("non-lawyer cannot satisfy approveDraftingPlan", () => {
    const env = testEnv();
    const s = buildToV0("nda.json");
    const newPlan = createDraftingPlan({
      project_id: s.project.id,
      content: "x",
      playbook: s.playbook!,
      env,
    });
    expect(() =>
      approveDraftingPlan({
        plan: newPlan,
        deal_memo: s.deal_memo!,
        approved_by: nonLawyer,
        env,
      }),
    ).toThrowError(/requires a human lawyer/);
  });

  it("non-lawyer cannot satisfy approveFinalVersion", () => {
    const env = testEnv();
    const s = buildToV0("nda.json");
    expect(() =>
      approveFinalVersion({
        version: s.v0!,
        approved_by: nonLawyer,
        env,
      }),
    ).toThrowError(/requires a human lawyer/);
  });
});
