import { expect, test } from "@playwright/test";

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
  // 1. Create + sources + lock
  await page.goto("/projects/new");
  await page.fill('input#name', "E2E Custom project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toBeVisible();
  const projectId = page.url().split("/projects/")[1]!;

  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "synthetic_term_sheet.pdf");
  await page.locator('select#stype').selectOption("term_sheet");
  await page.click('[data-testid="add-source-btn"]');
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');

  // 2. Confirm an unknown contract type → falls back to Custom Contract sentinel.
  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "Joint marketing collaboration");
  await page.click('[data-testid="confirm-type-btn"]');
  await expect(page.getByTestId("contract-type-status")).toHaveText("Confirmed");

  // 3. Playbook → Custom Contract mode badge appears
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');
  await expect(page.getByTestId("playbook-badge")).toHaveText("Custom Contract mode");
  await expect(page.getByTestId("playbook-name")).toHaveText("Custom Contract");

  // 4. Answer required intake (Custom Contract has 2 required questions)
  await page.goto(`/projects/${projectId}/intake`);
  await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const cards = page.locator('[data-testid^="intake-card-"]');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.locator('input').fill(`answer ${i + 1}`);
    await card.locator('button').click();
  }
  await expect(page.getByTestId("intake-progress")).toContainText("all required answered");

  // 5. Deal Memo: generate + approve
  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");

  // 6. Drafting Plan — generated, NOT yet approved. Verify Custom warning is visible.
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await expect(page.getByTestId("custom-warning")).toBeVisible();

  // 7. Try v0 BEFORE approving the plan — must fail with a workflow error.
  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  // The status guard rejects with INVALID_TRANSITION (not the custom-drafting-plan
  // error, because the status hasn't advanced past drafting_plan_drafted yet).
  await expect(page.getByTestId("page-error")).toContainText(/Invalid workflow transition|Drafting Plan must be approved|Custom Contract mode requires/);
  await expect(page.locator('pre[data-testid="v0-content"]')).toHaveCount(0);

  // 8. Approve the plan, then v0 succeeds.
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="approve-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");

  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");
});
