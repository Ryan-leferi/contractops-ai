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
 * Server-store façade tests (Milestones 3D + 3E).
 *
 * Exercises the route-level functions in `lib/server-store.ts` against
 * the default memory persistence adapter. After 3E every read/write is
 * async because the adapter interface is async (file adapter needs it).
 */

beforeEach(async () => {
  await resetStore();
});

afterEach(async () => {
  await resetStore();
});

describe("server-store: create / list / get", () => {
  it("creates a project, lists it, and returns its full ProjectState", async () => {
    expect(await listProjectSummaries()).toEqual([]);

    const { state, audits } = await createProjectInStore("Demo project A");
    expect(state.project.name).toBe("Demo project A");
    expect(state.project.status).toBe("created");
    // Project creation now emits TWO audit log entries (Milestone 3L):
    // project_created + membership_created (the auto-owner_lawyer grant).
    expect(audits).toHaveLength(2);
    expect(audits[0]!.event_type).toBe("project_created");
    expect(audits[1]!.event_type).toBe("membership_created");
    // The auto-membership is owner_lawyer for the creator.
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]!.project_role).toBe("owner_lawyer");
    expect(state.memberships[0]!.actor_id).toBe(state.project.created_by);

    const summaries = await listProjectSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.name).toBe("Demo project A");

    // Round-trip through get*.
    const fetched = await getProjectState(state.project.id);
    expect(fetched?.project.id).toBe(state.project.id);
    // Milestone 3L: createProject emits 2 audits (project_created +
    // auto-owner_lawyer membership_created).
    expect(await getProjectAudits(state.project.id)).toHaveLength(2);
    expect(await getProjectDecisionHistory(state.project.id)).toEqual([]);
  });

  it("returns null / empty for unknown project ids", async () => {
    expect(await getProjectState("nope")).toBeNull();
    expect(await getProjectAudits("nope")).toEqual([]);
    expect(await getProjectDecisionHistory("nope")).toEqual([]);
  });

  it("listProjectSummaries is sorted by created_at ascending", async () => {
    await createProjectInStore("first");
    await createProjectInStore("second");
    await createProjectInStore("third");
    const names = (await listProjectSummaries()).map((p) => p.name);
    expect(names).toEqual(["first", "second", "third"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// applyOperationToStore (workflow ops)
// ─────────────────────────────────────────────────────────────────────

async function quickSetupToIssuesOpen(): Promise<string> {
  const { state } = await createProjectInStore("e2e setup");
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
      source_document_id: (await getProjectState(id))!.source_documents[0]!.id,
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
  const after = (await getProjectState(id))!;
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
    const { state } = await createProjectInStore("workflow-test");
    const id = state.project.id;
    expect((await getProjectState(id))!.source_documents).toHaveLength(0);

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
    expect((await getProjectState(id))!.source_documents).toHaveLength(1);
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
    const issueIds = (await getProjectState(id))!.issue_cards.map((c) => c.issue_id);
    expect(issueIds.length).toBeGreaterThan(0);
    const firstIssue = issueIds[0]!;

    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: firstIssue, decision: "rejected", reason_note: "initial reject" },
    });
    const history1 = await getProjectDecisionHistory(id);
    expect(history1).toHaveLength(1);
    const firstEntry = history1[0]!;
    expect(firstEntry.previous_decision).toBe("pending");
    expect(firstEntry.new_decision).toBe("rejected");

    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: firstIssue, decision: "accepted", reason_note: "changed mind" },
    });
    const history2 = await getProjectDecisionHistory(id);
    expect(history2).toHaveLength(2);
    // The first entry is unchanged.
    expect(history2[0]!.id).toBe(firstEntry.id);
    expect(history2[0]!.new_decision).toBe("rejected");
    expect(history2[0]!.reason_note).toBe("initial reject");
    // The new entry appended at the end.
    expect(history2[1]!.previous_decision).toBe("rejected");
    expect(history2[1]!.new_decision).toBe("accepted");
  });

  it("works across multiple cards independently", async () => {
    const id = await quickSetupToIssuesOpen();
    const cards = (await getProjectState(id))!.issue_cards;
    const [a, b] = cards;
    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: a!.issue_id, decision: "accepted" },
    });
    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: b!.issue_id, decision: "rejected" },
    });
    await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: a!.issue_id, decision: "rejected" },
    });
    const history = await getProjectDecisionHistory(id);
    expect(history).toHaveLength(3);
    expect(history.filter((h) => h.issue_id === a!.issue_id)).toHaveLength(2);
    expect(history.filter((h) => h.issue_id === b!.issue_id)).toHaveLength(1);
  });

  it("emits one AuditLog entry per decision call (existing behavior preserved)", async () => {
    const id = await quickSetupToIssuesOpen();
    const card = (await getProjectState(id))!.issue_cards[0]!;
    const beforeAudits = (await getProjectAudits(id)).length;
    const first = await applyOperationToStore(id, {
      name: "decide_issue",
      args: { issue_id: card.issue_id, decision: "accepted" },
    });
    expect(first.audits).toHaveLength(1);
    expect((await getProjectAudits(id)).length).toBe(beforeAudits + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Invariants: source-pack lock blocks add; final-approval blocked while pending
// ─────────────────────────────────────────────────────────────────────

describe("server-store: workflow invariants still enforced", () => {
  it("source-pack lock blocks subsequent add_source", async () => {
    const { state } = await createProjectInStore("lock-test");
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
    const cards = (await getProjectState(id))!.issue_cards;
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
    const stillPending = (await getProjectState(id))!.issue_cards.filter(
      (c) => c.human_decision === "pending",
    );
    expect(stillPending.length).toBeGreaterThan(0);

    await expect(
      applyOperationToStore(id, { name: "approve_final", args: {} }),
    ).rejects.toThrow(/pending/i);
  });

  it("rejected Issue Card stays excluded from revision input", async () => {
    const id = await quickSetupToIssuesOpen();
    const cards = (await getProjectState(id))!.issue_cards;
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
    const versions = (await getProjectState(id))!.contract_versions;
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
  it("drops every project and every audit", async () => {
    await createProjectInStore("a");
    await createProjectInStore("b");
    expect((await debugStoreSizes()).projects).toBe(2);
    // 2 projects × (project_created + membership_created) = 4 audits.
    expect((await debugStoreSizes()).totalAudits).toBe(4);
    await resetStore();
    expect(await debugStoreSizes()).toEqual({ projects: 0, totalAudits: 0, totalHistory: 0 });
    expect(await listProjectSummaries()).toEqual([]);
  });
});
