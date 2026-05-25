import { expect, test } from "@playwright/test";
import { setDemoActorCookie, waitForStoreIdle } from "./helpers";

/**
 * Multi-actor / per-actor demo E2E (Milestones 3F + 3I).
 *
 * Three browser contexts share the same server-side store and the same
 * server-side actor registry. After 3I the "who am I acting as?" answer
 * lives in a server-side cookie (`contractops_demo_actor`); each
 * Playwright context has its own cookie jar, so the three browsers hold
 * three independent demo sessions without any client-side wiring.
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
 *   4. B (Park) opens the same project URL, changes that card back to
 *      "accepted" with another reason note. Decision history shows
 *      both actors in order.
 *   5. C (Choi) opens the project — the actor selector reads
 *      "business_choi" + "Business" because the cookie injected on the
 *      context is what the server returns from /api/auth/session.
 *   6. C (Choi) tries to decide a still-pending card via the API using
 *      her own cookie jar — server returns 422 because business_choi
 *      is not a human_lawyer. (Server-side role guard is the
 *      authoritative check.)
 *   7. C attempts to IMPERSONATE Kim by sending `actor_id: "lawyer_kim"`
 *      in the body. Milestone 3I forbids body.actor_id outright — the
 *      server returns 400 `OPERATION_ACTOR_ID_FORBIDDEN`. The cookie
 *      identity is the only identity that ever runs.
 *   8. A fresh context with an INVALID actor cookie ("anonymous_intruder")
 *      gets 401 `INVALID_SESSION`.
 *   9. Decision history still has exactly Kim + Park (no Choi entries).
 *  10. AuditLog still attributes project_created + deal_memo_approved
 *      to Kim; no entry was ever attributed to Choi.
 */

test.describe("Multi-actor demo (lawyer_kim ↔ lawyer_park, business_choi blocked)", () => {
  test("three browser contexts each act as a different actor; AuditLog + DecisionHistory reflect it; non-lawyer is blocked from approvals; body.actor_id impersonation is rejected", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    // Clean server-side store
    await request.post("/api/projects/reset");

    // ── Context A: lawyer_kim creates + drives the project ─────────
    const contextA = await browser.newContext();
    await setDemoActorCookie(contextA, "lawyer_kim");
    const pageA = await contextA.newPage();

    await pageA.goto("/projects/new");
    await waitForStoreIdle(pageA);
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
    await waitForStoreIdle(pageA);
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
      await waitForStoreIdle(pageA);
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
    await setDemoActorCookie(contextB, "lawyer_park");
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

    // ── Context C: business_choi opens the project (Milestone 3I) ──
    const contextC = await browser.newContext();
    await setDemoActorCookie(contextC, "business_choi");
    const pageC = await contextC.newPage();
    await pageC.goto(`/projects/${projectId}/issues`);
    await waitForStoreIdle(pageC);
    await expect(pageC.getByTestId("actor-selector-input")).toHaveValue("business_choi");
    await expect(pageC.getByTestId("actor-selector-role")).toHaveText("Business");
    // UI guard surface — lawyer-required note visible on the issues page.
    await expect(
      pageC.locator('[data-testid="lawyer-required-note"]').first(),
    ).toBeVisible();

    // Pick a still-pending card for the force tests below.
    const stateResp = await request.get(`/api/projects/${projectId}`);
    const stateBody = (await stateResp.json()) as {
      state: { issue_cards: { issue_id: string; human_decision: string }[] };
    };
    const pendingCard = stateBody.state.issue_cards.find(
      (c) => c.human_decision === "pending",
    );
    expect(pendingCard).toBeDefined();

    // ── C decides a card via her OWN request context (cookie =
    //    business_choi). No body.actor_id. Server's role guard fires.
    const refused = await contextC.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "decide_issue",
          args: { issue_id: pendingCard!.issue_id, decision: "accepted" },
        },
      },
    );
    expect(refused.status()).toBe(422);
    const refusedBody = (await refused.json()) as { error: string; code: string };
    expect(refusedBody.code).toBe("OPERATION_REJECTED");
    expect(refusedBody.error.toLowerCase()).toContain("lawyer");

    // ── C attempts IMPERSONATION via body.actor_id="lawyer_kim".
    //    Milestone 3I rejects body.actor_id outright — server returns
    //    400 OPERATION_ACTOR_ID_FORBIDDEN. Critically, the request is
    //    rejected BEFORE the operation runs, so Choi cannot pretend to
    //    be Kim by editing a JSON field.
    const impersonate = await contextC.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "decide_issue",
          args: { issue_id: pendingCard!.issue_id, decision: "accepted" },
          actor_id: "lawyer_kim",
        },
      },
    );
    expect(impersonate.status()).toBe(400);
    const impBody = (await impersonate.json()) as { code: string };
    expect(impBody.code).toBe("OPERATION_ACTOR_ID_FORBIDDEN");

    // ── A fresh context with an UNKNOWN actor cookie ─────────────
    const contextBad = await browser.newContext();
    await setDemoActorCookie(contextBad, "anonymous_intruder");
    const badResp = await contextBad.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: { name: "approve_final", args: {} },
      },
    );
    expect(badResp.status()).toBe(401);
    const badBody = (await badResp.json()) as { code: string };
    expect(badBody.code).toBe("INVALID_SESSION");
    await contextBad.close();

    // ── Append-only audit + decision history must NOT have grown.
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

    // AuditLog records the correct actor ids — project_created is Kim,
    // deal_memo_approved is Kim, and NO entry was ever attributed to
    // business_choi (her 422 + 400 + 401 attempts left no trail).
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
    await contextC.close();
  });
});
