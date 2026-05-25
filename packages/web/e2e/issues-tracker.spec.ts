import { expect, test } from "@playwright/test";

/**
 * Milestone 3C — Issue Tracker filters, decision history, dashboard.
 *
 * Verifies:
 *   - the review dashboard count cards render and react to filters;
 *   - severity / decision filters narrow the visible list;
 *   - changing an Issue Card's decision appends to its history;
 *   - the per-card "Decision history" toggle reveals all entries;
 *   - the rejected card stays excluded from revision input;
 *   - the QA page shows the four-group revision preview;
 *   - final approval stays blocked while any card is pending.
 *
 * Does NOT touch real-provider gating — runs entirely in mock mode.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("Issue Tracker: dashboard, filters, decision history, blocked-final, revision preview", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // ── Setup project up to "issues seeded" ─────────────────────────
  await page.goto("/projects/new");
  await page.fill("input#name", "E2E tracker project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("E2E tracker project");
  const projectId = page.url().split("/projects/")[1]!;

  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "proposal.pdf");
  await page.click('[data-testid="add-source-btn"]');
  await page.locator('[data-testid^="toggle-content-"]').first().click();
  await page
    .locator('[data-testid^="source-content-textarea-"]')
    .first()
    .fill("[synthetic] tracker e2e content");
  await page.locator('[data-testid^="save-content-"]').first().click();
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');

  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "NDA");
  await page.click('[data-testid="confirm-type-btn"]');
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');

  await page.goto(`/projects/${projectId}/intake`);
  await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const intakeCards = page.locator('[data-testid^="intake-card-"]');
  const totalIntake = await intakeCards.count();
  for (let i = 0; i < totalIntake; i++) {
    const card = intakeCards.nth(i);
    await card.locator("input").fill(`answer ${i + 1}`);
    await card.locator("button").click();
  }
  await expect(page.getByTestId("intake-progress")).toContainText("all required answered");

  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");

  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");

  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");

  // ── Run reviews and verify the dashboard appears ────────────────
  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');
  await expect(page.getByTestId("review-dashboard")).toBeVisible();
  await expect(page.getByTestId("pending-section")).toBeVisible();

  // Dashboard counts: total > 0, pending == total at this point, accepted = 0
  const totalText = await page.getByTestId("dash-total").innerText();
  const total = parseInt(totalText.split("\n").pop()!.trim(), 10);
  expect(total).toBeGreaterThan(0);
  const pendingText = await page.getByTestId("dash-pending").innerText();
  expect(parseInt(pendingText.split("\n").pop()!.trim(), 10)).toBe(total);
  await expect(page.getByTestId("dash-blocks-final")).toBeVisible();

  // ── Filter by severity = critical ───────────────────────────────
  await page.click('[data-testid="filter-severity-critical"]');
  const visibleCountAfterCritical = await page.getByTestId("visible-count").innerText();
  // The match count is "Showing N of M" — extract N and M.
  const m1 = /Showing (\d+) of (\d+)/.exec(visibleCountAfterCritical);
  expect(m1).not.toBeNull();
  const [, shownStr, totalStr] = m1!;
  const shown = parseInt(shownStr!, 10);
  expect(shown).toBeLessThanOrEqual(parseInt(totalStr!, 10));
  // Toggle off → back to total
  await page.click('[data-testid="filter-severity-critical"]');
  await expect(page.getByTestId("visible-count")).toContainText(`Showing ${total} of ${total}`);

  // ── Filter by decision = pending ────────────────────────────────
  await page.click('[data-testid="filter-decision-pending"]');
  await expect(page.getByTestId("visible-count")).toContainText(`Showing ${total} of ${total}`);
  await page.click('[data-testid="filter-decision-pending"]'); // toggle off

  // ── Decide one card as rejected with a reason note ─────────────
  const firstPending = page.locator('[data-testid^="pending-card-"]').first();
  const firstSourceAgent = await firstPending.getAttribute("data-testid");
  const rejectedProblem = await firstPending.locator("h3").first().innerText();
  await firstPending.locator('[data-testid="reason-note-input"]').fill("first reject reason");
  await firstPending.locator('[data-testid="reject-btn"]').click();

  // Dashboard reflects the change
  await expect(page.getByTestId("dash-rejected")).toContainText("1");

  // The card should now appear in the Decided section
  const decidedRejected = page.locator('[data-testid="decided-card-rejected"]').first();
  await expect(decidedRejected).toBeVisible();
  // Reason note rendered
  await expect(decidedRejected.locator('[data-testid^="reason-note-"]').first()).toContainText(
    "first reject reason",
  );

  // ── Toggle history and verify the entry is recorded ────────────
  const historyToggle = decidedRejected.locator('[data-testid^="history-toggle-"]').first();
  await historyToggle.click();
  const historyPanel = decidedRejected.locator('[data-testid^="history-panel-"]').first();
  await expect(historyPanel).toBeVisible();
  await expect(historyPanel).toContainText("pending → rejected");
  await expect(historyPanel).toContainText("first reject reason");

  // ── Change the same card's decision → history must append ──────
  // The card's history panel is still open from step 3 above. After the
  // re-accept, the SAME card re-renders with decision = "accepted" (its
  // testid switches from decided-card-rejected to decided-card-accepted)
  // but its `openHistory` UI state is keyed by issue_id and survives the
  // re-render, so the panel remains visible without another toggle click.
  await decidedRejected.locator('[data-testid^="change-decision-toggle-"]').first().click();
  await decidedRejected.locator('[data-testid^="re-reason-input-"]').first().fill("reconsidered");
  await decidedRejected.locator('[data-testid^="re-accept-btn-"]').first().click();

  const acceptedCard = page.locator('[data-testid="decided-card-accepted"]').first();
  await expect(acceptedCard).toBeVisible();
  const acceptedHistory = acceptedCard.locator('[data-testid^="history-panel-"]').first();
  await expect(acceptedHistory).toBeVisible();
  await expect(acceptedHistory).toContainText("pending → rejected");
  await expect(acceptedHistory).toContainText("rejected → accepted");
  await expect(acceptedHistory).toContainText("reconsidered");

  // ── Reject ANOTHER card so the revision still has a rejected one ─
  // After re-accepting the first card we need a fresh reject to assert
  // "rejected card stays excluded from revision" downstream.
  const secondPending = page.locator('[data-testid^="pending-card-"]').first();
  const secondProblem = await secondPending.locator("h3").first().innerText();
  await secondPending.locator('[data-testid="reject-btn"]').click();

  // ── Approve everything still pending so we can hit final approval ─
  let pending = page.locator('[data-testid^="pending-card-"]');
  while ((await pending.count()) > 0) {
    await pending.nth(0).locator('[data-testid="accept-btn"]').click();
    pending = page.locator('[data-testid^="pending-card-"]');
  }
  await expect(page.getByTestId("dash-pending")).toContainText("0");

  // ── QA page: four-group revision preview + final approval works ─
  await page.goto(`/projects/${projectId}/qa`);
  await expect(page.getByTestId("rev-group-applied")).toBeVisible();
  await expect(page.getByTestId("rev-group-partial")).toBeVisible();
  await expect(page.getByTestId("rev-group-skipped")).toBeVisible();
  await expect(page.getByTestId("rev-group-pending")).toBeVisible();
  // Pending group is now empty → final approval should be unblocked.
  await expect(page.getByTestId("rev-group-pending")).toContainText("(0)");

  await page.click('[data-testid="generate-revision-btn"]');
  await expect(page.getByTestId("version-row-v1")).toBeVisible();

  // The rejected card's problem text MUST NOT appear in v1 (still proves
  // PLATFORM_BRIEF.md §5 rule 5 holds end-to-end through 3C).
  const v1Content = await page.getByTestId("version-content-v1").innerText();
  expect(v1Content).not.toContain(secondProblem);

  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();
});

test("Issue Tracker: final approval refuses while ANY Issue Card is pending", async ({ page }) => {
  test.setTimeout(45_000);

  // Minimal setup — same fast path as above.
  await page.goto("/projects/new");
  await page.fill("input#name", "E2E pending-blocks");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("E2E pending-blocks");
  const projectId = page.url().split("/projects/")[1]!;

  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "proposal.pdf");
  await page.click('[data-testid="add-source-btn"]');
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');
  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "NDA");
  await page.click('[data-testid="confirm-type-btn"]');
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');
  await page.goto(`/projects/${projectId}/intake`);
  await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const intakeCards = page.locator('[data-testid^="intake-card-"]');
  const totalIntake = await intakeCards.count();
  for (let i = 0; i < totalIntake; i++) {
    const card = intakeCards.nth(i);
    await card.locator("input").fill(`a${i + 1}`);
    await card.locator("button").click();
  }
  await expect(page.getByTestId("intake-progress")).toContainText("all required answered");
  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-plan-btn"]');
  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');

  // Decide only ONE card so the rest stay pending.
  await page.locator('[data-testid^="pending-card-"]').first().locator('[data-testid="accept-btn"]').click();
  // At least one card must still be pending for this assertion to mean anything.
  const remaining = await page.locator('[data-testid^="pending-card-"]').count();
  expect(remaining).toBeGreaterThan(0);

  // QA page: approve-final button must be disabled while pending exists.
  await page.goto(`/projects/${projectId}/qa`);
  await expect(page.getByTestId("approve-final-btn")).toBeDisabled();
  await expect(page.getByTestId("pending-blocks-final-note")).toBeVisible();
});
