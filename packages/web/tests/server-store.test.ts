import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ProjectNotFoundError,
  UnknownOperationError,
  applyOperationToStore,
  createProjectInStore,
  debugStoreSizes,
  getProjectAudits,
  getProjectDecisionHistory,
  getProjectState,
  listProjectSummaries,
  parseOperationOrThrow,
  resetStore,
} from "../lib/server-store";
import type { Operation } from "../lib/operations";

/**
 * Server-store unit tests (Milestone 3D).
 *
 * Each test resets the in-memory singleton so state from previous tests
 * does not bleed in. The store loads playbook files from disk via the
 * findPlaybooksDir() resolver, which is verified end-to-end here.
 *
 * No HTTP, no browser, no Playwright — pure Node calls into the same
 * module the /api/projects route handlers use.
 */

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("server-store: create / list / get", () => {
  it("creates a project, lists it, and returns its full ProjectState", () => {
    expect(listProjectSummaries()).toEqual([]);

    const { state, audits } = createProjectInStore("Demo project A");
    expect(state.project.name).toBe("Demo project A");
    expect(state.project.status).toBe("created");
    // Project creation emits exactly one audit log entry.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.event_type).toBe("project_created");

    const summaries = listProjectSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("Demo project A");

    // Round-trip through get*.
    const fetched = getProjectState(state.project.id);
    expect(fetched?.project.id).toBe(state.project.id);
    expect(getProjectAudits(state.project.id)).toHaveLength(1);
    expect(getProjectDecisionHistory(state.project.id)).toEqual([]);
  });

  it("returns null / empty for unknown project ids", () => {
    expect(getProjectState("nope")).toBeNull();
    expect(getProjectAudits("nope")).toEqual([]);
    expect(getProjectDecisionHistory("nope")).toEqual([]);
  });

  it("listProjectSummaries is sorted by created_at ascending", () => {
    createProjectInStore("first");
    createProjectInStore("second");
    createProjectInStore("third");
    const names = listProjectSummaries().map((p) => p.name);
    expect(names).toEqual(["first", "second", "third"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyOperationToStore (workflow ops)
// ─────────────────────────────────────────────────────────────────────

async function quickSetupToIssuesOpen(): Promise<string> {
  const { state } = createProjectInStore("e2e setup");
  const id = state.project.id;
  await applyOperationToStore(id, {
    name: "add_source",
    args: {
      file_name: "proposal.pdf",
      source_type: "proposal",
      version: "1",
      incorporated: true,
      source_priority: 1,
    },
  });
  await applyOperationToStore(id, {
    name: "add_source_content",
    args: {
      source_document_id: getProjectState(id)!.source_documents[0]!.id,
      text_content: "[synthetic] body",
    },
  });
  await applyOperationToStore(id, { name: "lock_source_pack", args: {} });
  await applyOperationToStore(id, {
    name: "classify_and_confirm",
    args: { confirmed_type: "NDA", hint: "NDA" },
  });
  await applyOperationToStore(id, { name: "select_playbook", args: {} });
  // Answer every required intake question.
  const after = getProjectState(id)!;
  for (const q of after.intake_questions.filter((x) => x.required)) {
    await applyOperationToStore(id, {
      name: "answer_intake",
      args: { question_id: q.id, value: `synthetic-${q.key}` },
    });
  }
  await applyOperationToStore(id, { name: "draft_deal_memo", args: {} });
  await applyOperationToStore(id, { name: "approve_deal_memo", args: {} });
  await applyOperationToStore(id, { name: "draft_drafting_plan", args: {} });
  await applyOperationToStore(id, { name: "approve_drafting_plan", args: {} });
  await applyOperationToStore(id, { name: "create_v0", args: {} });
  await applyOperationToStore(id, { name: "run_mock_reviews", args: {} });
  return id;
}

describe("server-store: applyOperationToStore — workflow ops", () => {
  it("each operation updates the persisted ProjectState in place", async () => {
    const { state } = createProjectInStore("workflow-test");
    const id = state.project.id;
    expect(getProjectState(id)!.source_documents).toHaveLength(0);

    await applyOperationToStore(id, {
      name: "add_source",
      args: {
        file_name: "x.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
      },
    });
    expect(getProjectState(id)!.source_documents).toHaveLength(1);
  });

  it("rejects unknown project ids", async () => {
    await expect(
      applyOperationToStore("missing", { name: "lock_source_pack", args: {} }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Invariants: append-only audit + decision history
// ─────────────────────────────────────────────────────────────────────

describe("server-store: audit log + decision history are append-only", () => {
  it("multiple decisions append new entries; existing entries never change id or order", async () => {
    const id = await quickSetupToIssuesOpen();
    const issueIds = getProjectState(id)!.issue_cards.map((c) => c.issue_id);
    expect(issueIds.length).toBeGreaterThan(0);
    const firstIssue = issueIds[0]!;

    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: firstIssue, decision: "rejected", reason_note: "initial reject" },
    });
    const history1 = getProjectDecisionHistory(id);
    expect(history1).toHaveLength(1);
    const firstEntry = history1[0]!;
    expect(firstEntry.previous_decision).toBe("pending");
    expect(firstEntry.new_decision).toBe("rejected");

    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: firstIssue, decision: "accepted", reason_note: "changed mind" },
    });
    const history2 = getProjectDecisionHistory(id);
    expect(history2).toHaveLength(2);
    // The first entry is unchanged.
    expect(history2[0]!.id).toBe(firstEntry.id);
    expect(history2[0]!.new_decision).toBe("rejected");
    expect(history2[0]!.reason_note).toBe("initial reject");
    // The new entry appended at the end.
    expect(history2[1]!.previous_decision).toBe("rejected");
    expect(history2[1]!.new_decision).toBe("accepted");
  });

  it("every operation appends to the project's audit log; nothing is removed", async () => {
    const id = await quickSetupToIssuesOpen();
    const auditsBefore = getProjectAudits(id);
    expect(auditsBefore.length).toBeGreaterThan(0);

    const firstIssue = getProjectState(id)!.issue_cards[0]!.issue_id;
    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: firstIssue, decision: "rejected" },
    });
    const auditsAfter = getProjectAudits(id);
    expect(auditsAfter.length).toBe(auditsBefore.length + 1);
    // The earlier audits are unchanged (same ids, same order).
    expect(auditsAfter.slice(0, auditsBefore.length).map((a) => a.id)).toEqual(
      auditsBefore.map((a) => a.id),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Invariants: source-pack lock blocks add; final-approval blocked while pending
// ─────────────────────────────────────────────────────────────────────

describe("server-store: workflow invariants still enforced", () => {
  it("source-pack lock blocks subsequent add_source", async () => {
    const { state } = createProjectInStore("lock-test");
    const id = state.project.id;
    await applyOperationToStore(id, {
      name: "add_source",
      args: { file_name: "a.pdf", source_type: "proposal", version: "1", incorporated: true, source_priority: 1 },
    });
    await applyOperationToStore(id, { name: "lock_source_pack", args: {} });
    await expect(
      applyOperationToStore(id, {
        name: "add_source",
        args: { file_name: "b.pdf", source_type: "proposal", version: "1", incorporated: true, source_priority: 2 },
      }),
    ).rejects.toThrow();
  });

  it("approve_final is refused while any Issue Card is still pending", async () => {
    const id = await quickSetupToIssuesOpen();
    const cards = getProjectState(id)!.issue_cards;
    expect(cards.length).toBeGreaterThan(0);

    // Decide one card so revision can proceed; leave the others pending.
    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: cards[0]!.issue_id, decision: "accepted" },
    });
    // Generate the revision. Pending cards are simply skipped (PLATFORM_BRIEF.md
    // §5 rule 5) and the project status advances to `revised`. At that point
    // approve_final's pending-cards guard becomes the gate.
    await applyOperationToStore(id, { name: "create_revision", args: {} });
    const stillPending = getProjectState(id)!.issue_cards.filter(
      (c) => c.human_decision === "pending",
    );
    expect(stillPending.length).toBeGreaterThan(0);

    await expect(
      applyOperationToStore(id, { name: "approve_final", args: {} }),
    ).rejects.toThrow(/pending/i);
  });

  it("rejected Issue Card stays excluded from revision input", async () => {
    const id = await quickSetupToIssuesOpen();
    const cards = getProjectState(id)!.issue_cards;
    const [first, ...rest] = cards;
    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: first!.issue_id, decision: "rejected" },
    });
    for (const c of rest) {
      await applyOperationToStore(id, {
        name: "decide_issue",
        args: { issue_id: c.issue_id, decision: "accepted" },
      });
    }
    await applyOperationToStore(id, { name: "create_revision", args: {} });
    const versions = getProjectState(id)!.contract_versions;
    const v1 = versions[versions.length - 1]!;
    expect(v1.content).not.toContain(first!.recommended_revision);
    // Accepted cards' content does appear.
    expect(v1.content).toContain(rest[0]!.recommended_revision);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Validation: unknown operation rejected
// ─────────────────────────────────────────────────────────────────────

describe("parseOperationOrThrow", () => {
  it("accepts every supported operation name", () => {
    for (const name of [
      "add_source",
      "add_source_content",
      "lock_source_pack",
      "classify_and_confirm",
      "select_playbook",
      "answer_intake",
      "draft_deal_memo",
      "approve_deal_memo",
      "draft_drafting_plan",
      "approve_drafting_plan",
      "create_v0",
      "run_mock_reviews",
      "decide_issue",
      "run_mock_final_qa",
      "create_revision",
      "approve_final",
      "create_export",
    ]) {
      const op = parseOperationOrThrow({ name, args: {} }) as Operation;
      expect(op.name).toBe(name);
    }
  });

  it("rejects unknown operation names with UnknownOperationError", () => {
    expect(() => parseOperationOrThrow({ name: "drop_database", args: {} })).toThrow(
      UnknownOperationError,
    );
    expect(() => parseOperationOrThrow({ name: 42 })).toThrow(UnknownOperationError);
  });

  it("rejects bodies that are not an object", () => {
    expect(() => parseOperationOrThrow(null)).toThrow(UnknownOperationError);
    expect(() => parseOperationOrThrow("hello")).toThrow(UnknownOperationError);
    expect(() => parseOperationOrThrow([1, 2, 3])).toThrow(UnknownOperationError);
  });

  it("rejects when args is not an object", () => {
    expect(() => parseOperationOrThrow({ name: "lock_source_pack", args: "no" })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// resetStore + debug helpers
// ─────────────────────────────────────────────────────────────────────

describe("resetStore", () => {
  it("drops every project and every audit", () => {
    createProjectInStore("a");
    createProjectInStore("b");
    expect(debugStoreSizes().projects).toBe(2);
    expect(debugStoreSizes().totalAudits).toBe(2);
    resetStore();
    expect(debugStoreSizes()).toEqual({ projects: 0, auditedProjects: 0, totalAudits: 0 });
    expect(listProjectSummaries()).toEqual([]);
  });
});
