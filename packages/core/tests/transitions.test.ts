import { describe, expect, it } from "vitest";
import {
  assertTransition,
  isValidTransition,
  advanceStatus,
  WorkflowError,
} from "@contractops/core";

// Test §15. Invalid workflow transition rejected.
describe("§15. Invalid workflow transition rejected", () => {
  it("rejects skipping from created directly to draft_v0_created", () => {
    expect(() => assertTransition("created", "draft_v0_created")).toThrowError(
      /Invalid workflow transition/,
    );
    expect(isValidTransition("created", "draft_v0_created")).toBe(false);
  });

  it("rejects skipping from playbook_selected to drafting_plan_approved", () => {
    expect(() =>
      assertTransition("playbook_selected", "drafting_plan_approved"),
    ).toThrowError(WorkflowError);
  });

  it("rejects skipping from issues_open to exported", () => {
    expect(() => assertTransition("issues_open", "exported")).toThrowError(
      /Invalid workflow transition/,
    );
  });

  it("allows the canonical happy-path transitions", () => {
    expect(isValidTransition("created", "sources_uploaded")).toBe(true);
    expect(isValidTransition("sources_uploaded", "source_pack_locked")).toBe(true);
    expect(isValidTransition("source_pack_locked", "type_suggested")).toBe(true);
    expect(isValidTransition("type_suggested", "type_confirmed")).toBe(true);
    expect(isValidTransition("type_confirmed", "playbook_selected")).toBe(true);
    expect(isValidTransition("playbook_selected", "intake_in_progress")).toBe(true);
    expect(isValidTransition("intake_in_progress", "deal_memo_drafted")).toBe(true);
    expect(isValidTransition("deal_memo_drafted", "deal_memo_approved")).toBe(true);
    expect(isValidTransition("deal_memo_approved", "drafting_plan_drafted")).toBe(true);
    expect(isValidTransition("drafting_plan_drafted", "drafting_plan_approved")).toBe(true);
    expect(isValidTransition("drafting_plan_approved", "draft_v0_created")).toBe(true);
    expect(isValidTransition("draft_v0_created", "reviews_in_progress")).toBe(true);
    expect(isValidTransition("reviews_in_progress", "issues_open")).toBe(true);
    expect(isValidTransition("issues_open", "revised")).toBe(true);
    expect(isValidTransition("revised", "final_approved")).toBe(true);
    expect(isValidTransition("final_approved", "exported")).toBe(true);
  });

  it("advanceStatus returns target when valid", () => {
    expect(advanceStatus("created", "sources_uploaded")).toBe("sources_uploaded");
  });
});
