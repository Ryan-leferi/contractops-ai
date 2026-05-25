import { expect, test } from "@playwright/test";
import { answerAllRequiredIntakeQuestions, waitForStoreIdle } from "./helpers";

/**
 * Milestone 3D — multi-session demo via the server-side in-memory store.
 *
 * Two independent browser contexts (A and B) point at the same Next.js
 * server. The server holds project state in process memory, so each
 * context fetches the SAME state — proving the source of truth has
 * moved out of the browser's localStorage.
 *
 * Scenario:
 *
 *   1. Browser A creates a project and walks it up through "issues_open"
 *      (sources, lock, type, playbook, intake, deal memo, drafting plan,
 *      v0, run reviews).
 *   2. Browser B opens the SAME project URL — sees A's state, including
 *      every pending Issue Card.
 *   3. Browser B changes one Issue Card decision (rejects it with a
 *      reason note).
 *   4. Browser A reloads the Issues page — sees B's change reflected,
 *      including the decision history entry written by B.
 *   5. Sanity: the rejected card stays excluded when A drives the
 *      revision, and final approval is still blocked while pending
 *      cards remain.
 *
 * The test resets the server-side store in beforeAll so the project ids
 * are predictable between runs.
 */

test.beforeAll(async ({ request }) => {
  await request.post("/api/projects/reset");
});

test("two browser contexts share state via the server-side in-memory store", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // ── A creates the project and drives it to "issues_open" ──────
  await pageA.goto("/projects/new");
  await pageA.fill("input#name", "Multi-session demo");
  await pageA.click('button[type="submit"]');
  await expect(pageA.getByTestId("project-name")).toHaveText("Multi-session demo");

  const projectUrl = pageA.url();
  const projectId = projectUrl.split("/projects/")[1]!;
  expect(projectId.length).toBeGreaterThan(0);

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
  await expect(pageA.getByTestId("playbook-badge")).toHaveText("Playbook matched");

  await pageA.goto(`/projects/${projectId}/intake`);
  await expect(pageA.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const intakeCardsA = pageA.locator('[data-testid^="intake-card-"]');
  const totalIntakeA = await intakeCardsA.count();
  for (let i = 0; i < totalIntakeA; i++) {
    const card = intakeCardsA.nth(i);
    await card.locator("input").fill(`a${i + 1}`);
    await card.locator("button").click();
  }
  await expect(pageA.getByTestId("intake-progress")).toContainText("all required answered");

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
  const aPendingCount = await pageA.locator('[data-testid^="pending-card-"]').count();
  expect(aPendingCount).toBeGreaterThan(0);

  // ── B opens the SAME project URL — sees A's state via the server ─
  await pageB.goto(`/projects/${projectId}/issues`);
  await waitForStoreIdle(pageB);
  await expect(pageB.getByTestId("review-dashboard")).toBeVisible();
  // B must see the same pending cards A just seeded. toHaveCount auto-retries
  // until the full set has rendered, avoiding a race with React batching.
  await expect(pageB.locator('[data-testid^="pending-card-"]')).toHaveCount(aPendingCount);

  // ── B rejects one card with a reason note ────────────────────────
  const bFirstPending = pageB.locator('[data-testid^="pending-card-"]').first();
  const rejectedProblem = await bFirstPending.locator("h3").first().innerText();
  await bFirstPending
    .locator('[data-testid="reason-note-input"]')
    .fill("rejected by browser B");
  await bFirstPending.locator('[data-testid="reject-btn"]').click();
  await waitForStoreIdle(pageB);
  // B should now see the card under "decided" with the reason note.
  const bDecided = pageB.locator('[data-testid="decided-card-rejected"]').first();
  await expect(bDecided).toBeVisible();
  await expect(bDecided.locator('[data-testid^="reason-note-"]').first()).toContainText(
    "rejected by browser B",
  );

  // ── A reloads and sees B's change ────────────────────────────────
  await pageA.reload();
  await expect(pageA.getByTestId("review-dashboard")).toBeVisible();
  const aDecidedRejected = pageA.locator('[data-testid="decided-card-rejected"]').first();
  await expect(aDecidedRejected).toBeVisible();
  await expect(aDecidedRejected.locator('[data-testid^="reason-note-"]').first()).toContainText(
    "rejected by browser B",
  );
  // Decision history visible from A's side too — append-only entry that B wrote.
  await aDecidedRejected.locator('[data-testid^="history-toggle-"]').first().click();
  const aHistoryPanel = aDecidedRejected.locator('[data-testid^="history-panel-"]').first();
  await expect(aHistoryPanel).toBeVisible();
  await expect(aHistoryPanel).toContainText("pending → rejected");
  await expect(aHistoryPanel).toContainText("rejected by browser B");

  // ── A accepts every remaining pending card ───────────────────────
  let aRemaining = await pageA.locator('[data-testid^="pending-card-"]').count();
  while (aRemaining > 0) {
    await pageA
      .locator('[data-testid^="pending-card-"] [data-testid="accept-btn"]')
      .first()
      .click();
    await waitForStoreIdle(pageA);
    aRemaining = await pageA.locator('[data-testid^="pending-card-"]').count();
  }
  await expect(pageA.getByTestId("dash-pending")).toContainText("0");

  // ── A generates revision and approves final ──────────────────────
  await pageA.goto(`/projects/${projectId}/qa`);
  await pageA.click('[data-testid="generate-revision-btn"]');
  await expect(pageA.getByTestId("version-row-v1")).toBeVisible();
  const v1Content = await pageA.getByTestId("version-content-v1").innerText();
  // The rejected card's problem text MUST NOT appear in v1 — even though
  // the rejection happened in a different browser context.
  expect(v1Content).not.toContain(rejectedProblem);

  pageA.once("dialog", (d) => d.accept());
  await pageA.click('[data-testid="approve-final-btn"]');
  await expect(pageA.getByTestId("final-approved-banner")).toBeVisible();

  // ── Final sanity: B sees the final-approved state too ────────────
  await pageB.goto(`/projects/${projectId}/qa`);
  await expect(pageB.getByTestId("final-approved-banner")).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test("final approval refuses when one browser leaves pending issues behind", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto("/projects/new");
  await pageA.fill("input#name", "Multi-session pending block");
  await pageA.click('button[type="submit"]');
  await expect(pageA.getByTestId("project-name")).toHaveText("Multi-session pending block");
  const projectId = pageA.url().split("/projects/")[1]!;

  await pageA.goto(`/projects/${projectId}/sources`);
  await pageA.fill('[data-testid="source-file-name"]', "p.pdf");
  await pageA.click('[data-testid="add-source-btn"]');
  pageA.once("dialog", (d) => d.accept());
  await pageA.click('[data-testid="lock-pack-btn"]');
  await pageA.goto(`/projects/${projectId}/contract-type`);
  await pageA.fill('[data-testid="contract-type-input"]', "NDA");
  await pageA.click('[data-testid="confirm-type-btn"]');
  await pageA.goto(`/projects/${projectId}/playbook`);
  await pageA.click('[data-testid="select-playbook-btn"]');
  await pageA.goto(`/projects/${projectId}/intake`);
  // Helper gates each save on `waitForStoreIdle` — required because
  // the 3D StoreProvider made `applyProjectOp` async. The tight
  // fill→click loop without per-save gating drops answers on slow
  // CI runners (observed in GitHub Actions as
  // "3/4 answered · 1 required missing"). Same fix already applied
  // to lawyer-ui-guards.spec.ts.
  await answerAllRequiredIntakeQuestions(pageA);
  await pageA.goto(`/projects/${projectId}/deal-memo`);
  await pageA.click('[data-testid="generate-deal-memo-btn"]');
  await expect(pageA.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await pageA.click('[data-testid="approve-deal-memo-btn"]');
  await pageA.goto(`/projects/${projectId}/drafting-plan`);
  await pageA.click('[data-testid="generate-plan-btn"]');
  await expect(pageA.getByTestId("plan-status")).toHaveText("Drafted");
  await pageA.click('[data-testid="approve-plan-btn"]');
  await pageA.goto(`/projects/${projectId}/draft`);
  await pageA.click('[data-testid="generate-v0-btn"]');
  await pageA.goto(`/projects/${projectId}/issues`);
  await pageA.click('[data-testid="run-reviews-btn"]');
  await pageA
    .locator('[data-testid^="pending-card-"]')
    .first()
    .locator('[data-testid="accept-btn"]')
    .click();
  await waitForStoreIdle(pageA);

  // B opens the project, sees the lingering pending cards. Wait for the
  // StoreProvider hydration (GET /api/projects + GET /api/projects/[id])
  // to settle before counting, otherwise the page may briefly render
  // "No Issue Cards yet" before the fetch resolves.
  await pageB.goto(`/projects/${projectId}/issues`);
  await waitForStoreIdle(pageB);
  await expect(pageB.getByTestId("review-dashboard")).toBeVisible();
  const remaining = await pageB.locator('[data-testid^="pending-card-"]').count();
  expect(remaining).toBeGreaterThan(0);

  // B navigates to /qa and sees Approve Final disabled.
  await pageB.goto(`/projects/${projectId}/qa`);
  await expect(pageB.getByTestId("approve-final-btn")).toBeDisabled();
  await expect(pageB.getByTestId("pending-blocks-final-note")).toBeVisible();

  await contextA.close();
  await contextB.close();
});
