import { expect, test } from "@playwright/test";
import { waitForStoreIdle } from "./helpers";

/**
 * Custom Contract path. Confirms that:
 *  - typing an unknown contract type triggers the Custom Contract sentinel;
 *  - the Custom-Contract warning is visible on the Drafting Plan page;
 *  - v0 cannot be generated until the human lawyer approves the Drafting Plan.
 */

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/projects/reset");
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("Custom Contract path — v0 blocked until human-approved Drafting Plan", async ({ page }) => {
  // Cumulative `waitForStoreIdle` waits push this past the 30s Playwright
  // default; the workflow itself is fast (all mock), but each settle is a
  // small handshake we want to be defensive about.
  test.setTimeout(90_000);

  // 1. Create + sources + lock
  await page.goto("/projects/new");
  await page.fill('input#name', "E2E Custom project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toBeVisible();
  const projectId = page.url().split("/projects/")[1]!;

  await page.goto(`/projects/${projectId}/sources`);
  await waitForStoreIdle(page);
  await page.fill('[data-testid="source-file-name"]', "synthetic_term_sheet.pdf");
  await page.locator('select#stype').selectOption("term_sheet");
  await page.click('[data-testid="add-source-btn"]');
  await waitForStoreIdle(page);
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');
  await waitForStoreIdle(page);

  // 2. Confirm an unknown contract type → falls back to Custom Contract sentinel.
  await page.goto(`/projects/${projectId}/contract-type`);
  await waitForStoreIdle(page);
  await page.fill('[data-testid="contract-type-input"]', "Joint marketing collaboration");
  await page.click('[data-testid="confirm-type-btn"]');
  await expect(page.getByTestId("contract-type-status")).toHaveText("Confirmed");

  // 3. Playbook → Custom Contract mode badge appears
  await page.goto(`/projects/${projectId}/playbook`);
  await waitForStoreIdle(page);
  await page.click('[data-testid="select-playbook-btn"]');
  await expect(page.getByTestId("playbook-badge")).toHaveText("Custom Contract mode");
  await expect(page.getByTestId("playbook-name")).toHaveText("Custom Contract");

  // 4. Answer required intake (Custom Contract has 2 required questions)
  await page.goto(`/projects/${projectId}/intake`);
  await waitForStoreIdle(page);
  await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const cards = page.locator('[data-testid^="intake-card-"]');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.locator('input').fill(`answer ${i + 1}`);
    await card.locator('button').click();
    await waitForStoreIdle(page);
  }
  await expect(page.getByTestId("intake-progress")).toContainText("all required answered");

  // 5. Deal Memo: generate + approve
  await page.goto(`/projects/${projectId}/deal-memo`);
  await waitForStoreIdle(page);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");

  // 6. Drafting Plan — generated, NOT yet approved. Verify Custom warning is visible.
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await waitForStoreIdle(page);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await expect(page.getByTestId("custom-warning")).toBeVisible();

  // 7. v0 page BEFORE plan approval — generate-v0-btn must render but be
  // disabled with a clear "Drafting Plan approval required" affordance.
  // The server-side guard (`core.aggCreateV0` asserting status ===
  // `drafting_plan_approved`) is still the authoritative check and is
  // exercised by the existing core acceptance tests; here we verify the
  // UI surfaces the blocked state without relying on a click-then-error
  // race that became flaky after the 3D async-store refactor.
  await page.goto(`/projects/${projectId}/draft`);
  await waitForStoreIdle(page);
  await expect(page.getByTestId("generate-v0-btn")).toBeVisible();
  await expect(page.getByTestId("generate-v0-btn")).toBeDisabled();
  await expect(page.getByTestId("drafting-plan-required-note")).toContainText(
    /Drafting Plan approval required|변호사 승인된 Drafting Plan/,
  );
  // No v0 content is rendered before the plan is approved.
  await expect(page.locator('pre[data-testid="v0-content"]')).toHaveCount(0);

  // 8. Approve the plan, then v0 succeeds.
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await waitForStoreIdle(page);
  await page.click('[data-testid="approve-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");

  await page.goto(`/projects/${projectId}/draft`);
  await waitForStoreIdle(page);
  // After plan approval the button must be visible AND enabled.
  await expect(page.getByTestId("generate-v0-btn")).toBeEnabled();
  await expect(page.getByTestId("drafting-plan-required-note")).toHaveCount(0);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");
});
