import { describe, expect, it } from "vitest";
import {
  contractDraftOutputSchema,
  dealMemoDraftOutputSchema,
  draftingPlanOutputSchema,
  finalQAOutputSchema,
  issueCardListOutputSchema,
  revisionOutputSchema,
} from "@contractops/schemas";

describe("Agent output schemas", () => {
  it("DealMemoDraftOutput accepts minimum + warnings", () => {
    expect(() =>
      dealMemoDraftOutputSchema.parse({ content: "memo" }),
    ).not.toThrow();
    expect(() =>
      dealMemoDraftOutputSchema.parse({
        content: "memo",
        rationale: "structural notes",
        warnings: ["missing intake: x"],
      }),
    ).not.toThrow();
    expect(() => dealMemoDraftOutputSchema.parse({ content: "" })).toThrow();
  });

  it("DraftingPlanOutput requires content + toc + is_custom", () => {
    expect(() =>
      draftingPlanOutputSchema.parse({
        content: "plan",
        table_of_contents: ["제1조 (목적)"],
        is_custom: false,
      }),
    ).not.toThrow();
    expect(() =>
      draftingPlanOutputSchema.parse({ content: "plan", is_custom: false }),
    ).toThrow();
  });

  it("ContractDraftOutput requires content", () => {
    expect(() => contractDraftOutputSchema.parse({ content: "body" })).not.toThrow();
    expect(() => contractDraftOutputSchema.parse({})).toThrow();
  });

  it("IssueCardListOutput requires every finding to be a full Issue Card seed", () => {
    expect(() => issueCardListOutputSchema.parse({ findings: [] })).not.toThrow();
    expect(() =>
      issueCardListOutputSchema.parse({
        findings: [
          {
            source_agent: "mock_claude",
            severity: "high",
            location: { article: "제3조" },
            issue_type: "scope",
            problem: "too broad",
            why_it_matters: "risk",
            recommended_revision: "narrow",
            business_impact: "moderate",
            recommended_action: "revise",
          },
        ],
      }),
    ).not.toThrow();
    // Missing `recommended_action` → rejected
    expect(() =>
      issueCardListOutputSchema.parse({
        findings: [
          {
            source_agent: "mock_claude",
            severity: "high",
            location: {},
            issue_type: "x",
            problem: "x",
            why_it_matters: "x",
            recommended_revision: "x",
            business_impact: "x",
          },
        ],
      }),
    ).toThrow();
    // Invalid severity → rejected
    expect(() =>
      issueCardListOutputSchema.parse({
        findings: [
          {
            source_agent: "x",
            severity: "huge",
            location: {},
            issue_type: "x",
            problem: "x",
            why_it_matters: "x",
            recommended_revision: "x",
            business_impact: "x",
            recommended_action: "revise",
          },
        ],
      }),
    ).toThrow();
  });

  it("RevisionOutput requires content + applied_issue_card_ids", () => {
    expect(() =>
      revisionOutputSchema.parse({
        content: "revised",
        applied_issue_card_ids: ["id1", "id2"],
      }),
    ).not.toThrow();
    expect(() => revisionOutputSchema.parse({ content: "revised" })).toThrow();
  });

  it("FinalQAOutput requires findings array (passes optional)", () => {
    expect(() =>
      finalQAOutputSchema.parse({ findings: [] }),
    ).not.toThrow();
    expect(() =>
      finalQAOutputSchema.parse({
        findings: [
          {
            severity: "low",
            location: {},
            issue_type: "numbering",
            problem: "x",
            recommended_revision: "x",
          },
        ],
        passes: ["all dates consistent"],
      }),
    ).not.toThrow();
  });
});
