import { expect, test } from "@playwright/test";
import { waitForStoreIdle } from "./helpers";

/**
 * Milestone 3F — multi-actor / per-actor demo E2E.
 *
 * Three browser contexts share the same server-side store (Milestone 3D)
 * AND the server-side actor registry (Milestone 3F):
 *
 *   A → lawyer_kim    (human_lawyer)
 *   B → lawyer_park   (human_lawyer)
 *   C → business_choi (user — NOT a lawyer)
 *
 * Scenario:
 *
 *   1. Reset the server store.
 *   2. A (Kim) creates the project, walks to "issues_open".
 *   3. A rejects an Issue Card with a reason note.
 *   4. B (Park) opens the same project URL, switches the actor selector
 *      to Park, and changes that card back to "accepted" with another
 *      reason note. History should show both actors.
 *   5. C (Choi) tries to approve_final via the API — server should 422
 *      because business_choi is not a human_lawyer.
 *   6. Rejected cards still excluded from revision; pending cards still
 *      block final approval.
 *
 * The actor selector lives in the global header. The selected id
 * persists in localStorage; each browser context has its own
 * localStorage, so contexts hold independent actor selections.
 */

async function setActorInLocalStorage(
  context: import("@playwright/test").BrowserContext,
  actorId: string,
) {
  // Drop the storage key on a blank page first (initStorage requires the
  // page to be reachable). We then visit /projects which will hydrate
  // from this seed value.
  await context.addInitScript(
    (id) => {
      try {
        window.localStorage.setItem("contractops:demo-actor", id);
      } catch {
        /* ignore */
      }
    },
    actorId,
  );
}

test.describe("Multi-actor demo (lawyer_kim ↔ lawyer_park, business_choi blocked)", () => {
  test("three browser contexts each act as a different actor; AuditLog + DecisionHistory reflect it; non-lawyer is blocked from approvals", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    // Clean server-side store
    await request.post("/api/projects/reset");

    // ── Context A: lawyer_kim creates + drives the project ─────────
    const contextA = await browser.newContext();
    await setActorInLocalStorage(contextA, "lawyer_kim");
    const pageA = await contextA.newPage();

    await pageA.goto("/projects/new");
    await expect(pageA.getByTestId("actor-selector-input")).toHaveValue("lawyer_kim");
    await expect(pageA.getByTestId("actor-selector-role")).toHaveText("Lawyer");

    await pageA.fill("input#name", "Multi-actor demo");
    await pageA.click('button[type="submit"]');
    await expect(pageA.getByTestId("project-name")).toHaveText("Multi-actor demo");
    const projectId = pageA.url().split("/projects/")[1]!;

    // Walk to issues_open as Kim.
    await pageA.goto(`/projects/${projectId}/sources`);
    await pageA.fill('[data-testid="source-file-name"]', "proposal.pdf");
    await pageA.click('[data-testid="add-source-btn"]');
    pageA.once("dialog", (d) => d.accept());
    await pageA.click('[data-testid="lock-pack-btn"]');
    await expect(pageA.getByTestId("source-pack-status")).toHaveText("Locked");

    await pageA.goto(`/projects/${projectId}/contract-type`);
    await pageA.fill('[data-testid="contract-type-input"]', "NDA");
    await pageA.click('[data-testid="confirm-type-btn"]');
    await pageA.goto(`/projects/${projectId}/playbook`);
    await pageA.click('[data-testid="select-playbook-btn"]');

    await pageA.goto(`/projects/${projectId}/intake`);
    await expect(pageA.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
    const intakeCards = pageA.locator('[data-testid^="intake-card-"]');
    const totalIntake = await intakeCards.count();
    for (let i = 0; i < totalIntake; i++) {
      const card = intakeCards.nth(i);
      await card.locator("input").fill(`a${i + 1}`);
      await card.locator("button").click();
    }
    await expect(pageA.getByTestId("intake-progress")).toContainText(
      "all required answered",
    );

    await pageA.goto(`/projects/${projectId}/deal-memo`);
    await pageA.click('[data-testid="generate-deal-memo-btn"]');
    await expect(pageA.getByTestId("deal-memo-status")).toHaveText("Drafted");
    await pageA.click('[data-testid="approve-deal-memo-btn"]');
    await expect(pageA.getByTestId("deal-memo-status")).toHaveText("Approved");

    await pageA.goto(`/projects/${projectId}/drafting-plan`);
    await pageA.click('[data-testid="generate-plan-btn"]');
    await expect(pageA.getByTestId("plan-status")).toHaveText("Drafted");
    await pageA.click('[data-testid="approve-plan-btn"]');
    await expect(pageA.getByTestId("plan-status")).toHaveText("Approved");

    await pageA.goto(`/projects/${projectId}/draft`);
    await pageA.click('[data-testid="generate-v0-btn"]');
    await expect(pageA.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");

    await pageA.goto(`/projects/${projectId}/issues`);
    await pageA.click('[data-testid="run-reviews-btn"]');
    await expect(pageA.getByTestId("pending-section")).toBeVisible();

    // ── Kim rejects the first Issue Card ────────────────────────────
    const firstPending = pageA.locator('[data-testid^="pending-card-"]').first();
    await firstPending
      .locator('[data-testid="reason-note-input"]')
      .fill("Kim rejects this card");
    await firstPending.locator('[data-testid="reject-btn"]').click();
    await waitForStoreIdle(pageA);
    await expect(pageA.getByTestId("dash-rejected")).toContainText("1");

    // ── Context B: lawyer_park overrules Kim's rejection ───────────
    const contextB = await browser.newContext();
    await setActorInLocalStorage(contextB, "lawyer_park");
    const pageB = await contextB.newPage();
    await pageB.goto(`/projects/${projectId}/issues`);
    await waitForStoreIdle(pageB);
    await expect(pageB.getByTestId("actor-selector-input")).toHaveValue("lawyer_park");

    // Find Kim's rejected card and change-decision → accepted
    const decidedRejected = pageB.locator('[data-testid="decided-card-rejected"]').first();
    await expect(decidedRejected).toBeVisible();
    await decidedRejected
      .locator('[data-testid^="change-decision-toggle-"]')
      .first()
      .click();
    await decidedRejected
      .locator('[data-testid^="re-reason-input-"]')
      .first()
      .fill("Park overrules Kim");
    await decidedRejected
      .locator('[data-testid^="re-accept-btn-"]')
      .first()
      .click();
    await waitForStoreIdle(pageB);

    // Open history — both actors must appear, in order.
    const acceptedCard = pageB.locator('[data-testid="decided-card-accepted"]').first();
    await expect(acceptedCard).toBeVisible();
    const historyToggle = acceptedCard.locator('[data-testid^="history-toggle-"]').first();
    // It may already be open (the previous open survived the
    // re-render via React state). Click only if collapsed.
    const historyPanel = acceptedCard.locator('[data-testid^="history-panel-"]').first();
    if (!(await historyPanel.isVisible())) {
      await historyToggle.click();
    }
    await expect(historyPanel).toBeVisible();
    await expect(historyPanel).toContainText("pending → rejected");
    await expect(historyPanel).toContainText("lawyer_kim");
    await expect(historyPanel).toContainText("Kim rejects this card");
    await expect(historyPanel).toContainText("rejected → accepted");
    await expect(historyPanel).toContainText("lawyer_park");
    await expect(historyPanel).toContainText("Park overrules Kim");

    // Authoritative read via the API too — Park's entry attributes to park.
    const histResp = await request.get(
      `/api/projects/${projectId}/decision-history`,
    );
    expect(histResp.ok()).toBe(true);
    const histBody = (await histResp.json()) as {
      history: { actor_id: string; new_decision: string; reason_note: string | null }[];
    };
    expect(histBody.history).toHaveLength(2);
    expect(histBody.history[0]!.actor_id).toBe("lawyer_kim");
    expect(histBody.history[0]!.new_decision).toBe("rejected");
    expect(histBody.history[1]!.actor_id).toBe("lawyer_park");
    expect(histBody.history[1]!.new_decision).toBe("accepted");

    // ── Context C: business_choi tries a lawyer-only op ────────────
    // We exercise the API directly because UI surfaces (button disabled
    // states) are out of scope for this milestone — the server-side
    // role guard is the authoritative check.
    //
    // `decide_issue` is reachable from `issues_open` (we're still there),
    // and core's `decideIssueCard` rejects non-human-lawyer actors
    // BEFORE doing anything else. We pick a still-pending card so the
    // workflow's status guard doesn't fire first.
    const stateResp = await request.get(`/api/projects/${projectId}`);
    const stateBody = (await stateResp.json()) as {
      state: { issue_cards: { issue_id: string; human_decision: string }[] };
    };
    const pendingCard = stateBody.state.issue_cards.find(
      (c) => c.human_decision === "pending",
    );
    expect(pendingCard).toBeDefined();
    const blockedResp = await request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "decide_issue",
          args: { issue_id: pendingCard!.issue_id, decision: "accepted" },
          actor_id: "business_choi",
        },
      },
    );
    expect(blockedResp.status()).toBe(422);
    const blockedBody = (await blockedResp.json()) as { error: string; code: string };
    expect(blockedBody.error.toLowerCase()).toContain("lawyer");
    expect(blockedBody.code).toBe("OPERATION_REJECTED");

    // The decision history MUST NOT have grown — Choi's attempt left
    // no trace beyond Kim + Park.
    const histResp2 = await request.get(
      `/api/projects/${projectId}/decision-history`,
    );
    const histBody2 = (await histResp2.json()) as {
      history: { actor_id: string }[];
    };
    expect(histBody2.history).toHaveLength(2);
    expect(
      histBody2.history.some((h) => h.actor_id === "business_choi"),
    ).toBe(false);

    // Unknown actor_id is rejected with a clean 400.
    const unknownResp = await request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "approve_final",
          args: {},
          actor_id: "anonymous_intruder",
        },
      },
    );
    expect(unknownResp.status()).toBe(400);
    const unknownBody = (await unknownResp.json()) as { error: string; code: string };
    expect(unknownBody.code).toBe("UNKNOWN_ACTOR");

    // AuditLog still records the correct actor ids — the project_created
    // entry is Kim, the deal_memo_approved entry is Kim, no Choi
    // decision was ever recorded.
    const auditResp = await request.get(`/api/projects/${projectId}/audit-logs`);
    const auditBody = (await auditResp.json()) as {
      audits: { event_type: string; actor: string }[];
    };
    const created = auditBody.audits.find((a) => a.event_type === "project_created");
    expect(created!.actor).toBe("lawyer_kim");
    const dealApproved = auditBody.audits.find(
      (a) => a.event_type === "deal_memo_approved",
    );
    expect(dealApproved!.actor).toBe("lawyer_kim");
    expect(
      auditBody.audits.find((a) => a.actor === "business_choi"),
    ).toBeUndefined();

    await contextA.close();
    await contextB.close();
  });
});
