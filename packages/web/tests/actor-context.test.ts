import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyOperationToStore,
  createProjectInStore,
  getProjectAudits,
  getProjectDecisionHistory,
  getProjectState,
  resetStore,
} from "../lib/server-store";
import { DEMO_ACTOR_REGISTRY } from "../lib/demo-actors";
import {
  FilePersistenceAdapter,
  __resetPersistenceAdapterCacheForTests,
  type PersistenceAdapter,
} from "../lib/persistence";

const KIM = DEMO_ACTOR_REGISTRY.lawyer_kim;
const PARK = DEMO_ACTOR_REGISTRY.lawyer_park;
const CHOI = DEMO_ACTOR_REGISTRY.business_choi;

/**
 * Helper: drive a project from creation up through "issues_open" using
 * the supplied actor for every step. lawyer_kim by default because the
 * pre-issues ops include lawyer-only guards (classify_and_confirm).
 */
async function walkToIssuesOpen(creator = KIM): Promise<string> {
  const { state } = await createProjectInStore("actor-context-test", creator);
  const id = state.project.id;
  await applyOperationToStore(
    id,
    {
      name: "add_source",
      args: {
        file_name: "proposal.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
      },
    },
    creator,
  );
  await applyOperationToStore(
    id,
    {
      name: "add_source_content",
      args: {
        source_document_id: (await getProjectState(id))!.source_documents[0]!.id,
        text_content: "[synthetic] body",
      },
    },
    creator,
  );
  await applyOperationToStore(id, { name: "lock_source_pack", args: {} }, creator);
  await applyOperationToStore(
    id,
    { name: "classify_and_confirm", args: { confirmed_type: "NDA" } },
    creator,
  );
  await applyOperationToStore(id, { name: "select_playbook", args: {} }, creator);
  for (const q of (await getProjectState(id))!.intake_questions.filter(
    (x) => x.required,
  )) {
    await applyOperationToStore(
      id,
      { name: "answer_intake", args: { question_id: q.id, value: `a-${q.key}` } },
      creator,
    );
  }
  await applyOperationToStore(id, { name: "draft_deal_memo", args: {} }, creator);
  await applyOperationToStore(id, { name: "approve_deal_memo", args: {} }, creator);
  await applyOperationToStore(
    id,
    { name: "draft_drafting_plan", args: {} },
    creator,
  );
  await applyOperationToStore(
    id,
    { name: "approve_drafting_plan", args: {} },
    creator,
  );
  await applyOperationToStore(id, { name: "create_v0", args: {} }, creator);
  await applyOperationToStore(id, { name: "run_mock_reviews", args: {} }, creator);
  return id;
}

beforeEach(async () => {
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

afterEach(async () => {
  await resetStore();
});

// ─────────────────────────────────────────────────────────────────────
// Actor identity flows through AuditLog + IssueDecisionHistory
// ─────────────────────────────────────────────────────────────────────

describe("actor context — selected actor lands in AuditLog + decision history", () => {
  it("createProjectInStore stamps the chosen actor on the project_created audit", async () => {
    await createProjectInStore("kim-project", KIM);
    await createProjectInStore("park-project", PARK);
    // Project ids differ, but each audit log records the right actor.
    const allSummaries = await import("../lib/server-store").then((m) => m.listProjectSummaries());
    const summaries = await allSummaries;
    for (const s of summaries) {
      const audits = await getProjectAudits(s.id);
      // Milestone 3L: createProject emits TWO audits — project_created
      // + the auto-owner_lawyer membership_created. Both carry the same
      // creator actor, so the assertion logic stays the same.
      expect(audits).toHaveLength(2);
      const created = audits.find((a) => a.event_type === "project_created")!;
      const membership = audits.find((a) => a.event_type === "membership_created")!;
      expect(created.event_type).toBe("project_created");
      expect(membership.event_type).toBe("membership_created");
      if (s.name === "kim-project") {
        expect(created.actor).toBe(KIM.id);
        expect(membership.actor).toBe(KIM.id);
      }
      if (s.name === "park-project") {
        expect(created.actor).toBe(PARK.id);
        expect(membership.actor).toBe(PARK.id);
      }
    }
  });

  it("approve_deal_memo audit carries the selected lawyer's id", async () => {
    const { state } = await createProjectInStore("deal-memo-actor", KIM);
    const id = state.project.id;
    // Walk to the point where deal memo can be approved.
    await applyOperationToStore(
      id,
      {
        name: "add_source",
        args: {
          file_name: "x.pdf",
          source_type: "proposal",
          version: "1",
          incorporated: true,
          source_priority: 1,
        },
      },
      KIM,
    );
    await applyOperationToStore(id, { name: "lock_source_pack", args: {} }, KIM);
    await applyOperationToStore(
      id,
      { name: "classify_and_confirm", args: { confirmed_type: "NDA" } },
      KIM,
    );
    await applyOperationToStore(id, { name: "select_playbook", args: {} }, KIM);
    for (const q of (await getProjectState(id))!.intake_questions.filter(
      (x) => x.required,
    )) {
      await applyOperationToStore(
        id,
        { name: "answer_intake", args: { question_id: q.id, value: `a-${q.key}` } },
        KIM,
      );
    }
    await applyOperationToStore(id, { name: "draft_deal_memo", args: {} }, KIM);
    // Approve with PARK so the audit captures a different actor.
    await applyOperationToStore(id, { name: "approve_deal_memo", args: {} }, PARK);

    const audits = await getProjectAudits(id);
    const approval = audits.find((a) => a.event_type === "deal_memo_approved");
    expect(approval).toBeDefined();
    expect(approval!.actor).toBe(PARK.id);
  });

  it("decide_issue records the deciding lawyer's id in decision_history", async () => {
    const projectId = await walkToIssuesOpen(KIM);
    const card = (await getProjectState(projectId))!.issue_cards[0]!;
    await applyOperationToStore(
      projectId,
      {
        name: "decide_issue",
        args: {
          issue_id: card.issue_id,
          decision: "rejected",
          reason_note: "kim rejects",
        },
      },
      KIM,
    );
    const history = await getProjectDecisionHistory(projectId);
    expect(history).toHaveLength(1);
    expect(history[0]!.actor_id).toBe(KIM.id);
    expect(history[0]!.actor_role).toBe("human_lawyer");
    expect(history[0]!.reason_note).toBe("kim rejects");
  });

  it("decision change by a DIFFERENT lawyer appends a second history entry attributed to that lawyer", async () => {
    const projectId = await walkToIssuesOpen(KIM);
    const card = (await getProjectState(projectId))!.issue_cards[0]!;
    await applyOperationToStore(
      projectId,
      {
        name: "decide_issue",
        args: {
          issue_id: card.issue_id,
          decision: "rejected",
          reason_note: "kim rejects",
        },
      },
      KIM,
    );
    await applyOperationToStore(
      projectId,
      {
        name: "decide_issue",
        args: {
          issue_id: card.issue_id,
          decision: "accepted",
          reason_note: "park overrules",
        },
      },
      PARK,
    );
    const history = await getProjectDecisionHistory(projectId);
    expect(history).toHaveLength(2);
    // Append-only: entry 0 unchanged
    expect(history[0]!.actor_id).toBe(KIM.id);
    expect(history[0]!.previous_decision).toBe("pending");
    expect(history[0]!.new_decision).toBe("rejected");
    expect(history[0]!.reason_note).toBe("kim rejects");
    // New entry attributes to park
    expect(history[1]!.actor_id).toBe(PARK.id);
    expect(history[1]!.previous_decision).toBe("rejected");
    expect(history[1]!.new_decision).toBe("accepted");
    expect(history[1]!.reason_note).toBe("park overrules");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Non-lawyer actor is rejected on every lawyer-only op
// ─────────────────────────────────────────────────────────────────────

describe("non-lawyer actor (business_choi) is rejected from every lawyer-only op", () => {
  it("approve_deal_memo throws when called by business_choi", async () => {
    const { state } = await createProjectInStore("choi-cant-approve", KIM);
    const id = state.project.id;
    await applyOperationToStore(
      id,
      {
        name: "add_source",
        args: {
          file_name: "x.pdf",
          source_type: "proposal",
          version: "1",
          incorporated: true,
          source_priority: 1,
        },
      },
      KIM,
    );
    await applyOperationToStore(id, { name: "lock_source_pack", args: {} }, KIM);
    await applyOperationToStore(
      id,
      { name: "classify_and_confirm", args: { confirmed_type: "NDA" } },
      KIM,
    );
    await applyOperationToStore(id, { name: "select_playbook", args: {} }, KIM);
    for (const q of (await getProjectState(id))!.intake_questions.filter(
      (x) => x.required,
    )) {
      await applyOperationToStore(
        id,
        { name: "answer_intake", args: { question_id: q.id, value: `a-${q.key}` } },
        KIM,
      );
    }
    await applyOperationToStore(id, { name: "draft_deal_memo", args: {} }, KIM);

    await expect(
      applyOperationToStore(id, { name: "approve_deal_memo", args: {} }, CHOI),
    ).rejects.toThrow(/human.lawyer|lawyer/i);
  });

  it("approve_drafting_plan throws when called by business_choi", async () => {
    const { state } = await createProjectInStore("choi-cant-plan", KIM);
    const id = state.project.id;
    await applyOperationToStore(
      id,
      {
        name: "add_source",
        args: {
          file_name: "x.pdf",
          source_type: "proposal",
          version: "1",
          incorporated: true,
          source_priority: 1,
        },
      },
      KIM,
    );
    await applyOperationToStore(id, { name: "lock_source_pack", args: {} }, KIM);
    await applyOperationToStore(
      id,
      { name: "classify_and_confirm", args: { confirmed_type: "NDA" } },
      KIM,
    );
    await applyOperationToStore(id, { name: "select_playbook", args: {} }, KIM);
    for (const q of (await getProjectState(id))!.intake_questions.filter(
      (x) => x.required,
    )) {
      await applyOperationToStore(
        id,
        { name: "answer_intake", args: { question_id: q.id, value: `a-${q.key}` } },
        KIM,
      );
    }
    await applyOperationToStore(id, { name: "draft_deal_memo", args: {} }, KIM);
    await applyOperationToStore(id, { name: "approve_deal_memo", args: {} }, KIM);
    await applyOperationToStore(
      id,
      { name: "draft_drafting_plan", args: {} },
      KIM,
    );

    await expect(
      applyOperationToStore(
        id,
        { name: "approve_drafting_plan", args: {} },
        CHOI,
      ),
    ).rejects.toThrow(/human.lawyer|lawyer/i);
  });

  it("decide_issue throws when called by business_choi", async () => {
    const projectId = await walkToIssuesOpen(KIM);
    const card = (await getProjectState(projectId))!.issue_cards[0]!;
    await expect(
      applyOperationToStore(
        projectId,
        {
          name: "decide_issue",
          args: { issue_id: card.issue_id, decision: "accepted" },
        },
        CHOI,
      ),
    ).rejects.toThrow(/human.lawyer|lawyer/i);
    // Append-only invariant: the failed op left no history entry behind.
    expect(await getProjectDecisionHistory(projectId)).toHaveLength(0);
  });

  it("approve_final throws when called by business_choi", async () => {
    const projectId = await walkToIssuesOpen(KIM);
    // Decide every card as Kim so the revision + final-approval path is reachable.
    const cards = (await getProjectState(projectId))!.issue_cards;
    for (const c of cards) {
      await applyOperationToStore(
        projectId,
        { name: "decide_issue", args: { issue_id: c.issue_id, decision: "accepted" } },
        KIM,
      );
    }
    await applyOperationToStore(projectId, { name: "create_revision", args: {} }, KIM);
    // Now try to approve as Choi.
    await expect(
      applyOperationToStore(projectId, { name: "approve_final", args: {} }, CHOI),
    ).rejects.toThrow(/human.lawyer|lawyer/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// File persistence preserves actor ids across adapter re-instantiation
// ─────────────────────────────────────────────────────────────────────

describe("file adapter preserves actor ids in audits + decision history", () => {
  // The file adapter is opt-in via PERSISTENCE_DRIVER=file. We bypass
  // the env-driven factory and call its constructor directly so we can
  // assert the on-disk round-trip without polluting the global cache.
  it("audit + history entries written via PARK survive a fresh FilePersistenceAdapter instance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contractops-actor-"));
    try {
      const first = new FilePersistenceAdapter(dir);

      // Manually construct + persist a project state + audit + history
      // entry attributed to PARK, the way the dispatcher would.
      const auditEntry = {
        id: "au_park_1",
        project_id: "proj_p",
        actor: PARK.id,
        event_type: "issue_card_decided",
        ref_id: "ic_x",
        timestamp: "2026-01-01T00:00:00.000Z",
        payload: { decision: "rejected" },
      } as Parameters<PersistenceAdapter["appendAuditLog"]>[1];

      const historyEntry = {
        id: "hist_park_1",
        project_id: "proj_p",
        issue_id: "ic_x",
        previous_decision: "pending",
        new_decision: "rejected",
        actor_id: PARK.id,
        actor_role: PARK.role,
        changed_at: "2026-01-01T00:00:00.000Z",
        partial_note: null,
        reason_note: "park decides",
      } as Parameters<PersistenceAdapter["appendDecisionHistory"]>[1];

      await first.createProject(
        {
          project: {
            id: "proj_p",
            name: "Park-driven project",
            status: "created",
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: PARK.id,
          },
          source_pack: { id: "sp_1", project_id: "proj_p", locked: false, locked_at: null, document_ids: [] },
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
        } as unknown as Parameters<PersistenceAdapter["createProject"]>[0],
        auditEntry,
      );
      await first.appendDecisionHistory("proj_p", historyEntry);

      // Fresh adapter against the same dir.
      const second = new FilePersistenceAdapter(dir);
      const audits = await second.listAuditLogs("proj_p");
      const history = await second.listDecisionHistory("proj_p");
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actor).toBe(PARK.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.actor_id).toBe(PARK.id);
      expect(history[0]!.actor_role).toBe("human_lawyer");
      // The state file also records PARK as creator.
      const state = await second.getProjectState("proj_p");
      expect(state!.project.created_by).toBe(PARK.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
