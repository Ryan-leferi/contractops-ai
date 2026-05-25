import { expect, test } from "@playwright/test";
import { waitForStoreIdle } from "./helpers";

/**
 * Deterministic QA flow (mock-mode).
 *
 * Drives the full NDA path, but injects a v0 body that contains a known
 * forbidden expression ("기타 ") so the deterministic-QA engine MUST produce
 * at least one IssueCard with source_agent = "deterministic_qa". The user
 * then rejects that card and we verify the revision body does NOT contain
 * the rejected card's id.
 *
 * Also confirms clean / commentary export separation still holds after the
 * deterministic QA layer is in play.
 */

test.beforeEach(async ({ page, request }) => {
  // 3D: state lives in the server-side in-memory store. Reset it before
  // each test so the suite stays isolated.
  await request.post("/api/projects/reset");
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("deterministic_qa Issue Card appears on final QA, user rejects, revision excludes it, exports stay clean", async ({
  page,
}) => {
  // 1. Build a project the regular way up through v0.
  await page.goto("/projects/new");
  await page.fill("input#name", "Deterministic QA E2E");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toBeVisible();
  const projectId = page.url().split("/projects/")[1]!;

  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "synthetic.pdf");
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
  const intakeCount = await intakeCards.count();
  for (let i = 0; i < intakeCount; i++) {
    const card = intakeCards.nth(i);
    await card.locator("input").fill(`answer ${i + 1}`);
    await card.locator("button").click();
  }

  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");

  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await page.click('[data-testid="approve-plan-btn"]');

  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");

  // 2. (3D refactor) State now lives in the server's in-memory store; we
  //    can't poke it via localStorage. Instead the mock v0 body already
  //    contains a known forbidden expression ("기타 ...") seeded by
  //    `composeV0Draft` in lib/actions.ts, so the deterministic QA engine
  //    will find at least one issue without any injection.

  // 3. Run reviews → decide all open cards → revision → final QA.
  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');
  await expect(page.getByTestId("pending-section")).toBeVisible();
  let pendingCount = await page.locator('[data-testid^="pending-card-"]').count();
  while (pendingCount > 0) {
    await page
      .locator('[data-testid^="pending-card-"] [data-testid="accept-btn"]')
      .first()
      .click();
    await waitForStoreIdle(page);
    pendingCount = await page.locator('[data-testid^="pending-card-"]').count();
  }
  await expect(page.getByTestId("pending-section")).toHaveCount(0);

  // Generate revision and then run final QA (deterministic QA fires here).
  await page.goto(`/projects/${projectId}/qa`);
  await page.click('[data-testid="generate-revision-btn"]');
  await expect(page.getByTestId("version-row-v1")).toBeVisible();
  await page.click('[data-testid="run-qa-btn"]');

  // 4. New deterministic_qa pending cards should appear on the Issues page.
  await page.goto(`/projects/${projectId}/issues`);
  await expect(page.getByTestId("pending-section")).toBeVisible();
  // The Issues page renders source_agent as part of the CardDescription.
  // Use a textual locator instead of test-id since deterministic cards reuse
  // the same `pending-card-${source_agent}` testid pattern.
  const detPending = page.locator('[data-testid^="pending-card-deterministic_qa"]');
  const detCount = await detPending.count();
  expect(detCount).toBeGreaterThan(0);

  // Reject the first deterministic_qa card and remember its description for
  // the revision-exclusion assertion.
  const cardToReject = detPending.first();
  const cardText = await cardToReject.innerText();
  expect(cardText).toContain("deterministic_qa");
  await cardToReject.locator('[data-testid="reject-btn"]').click();
  await waitForStoreIdle(page);

  // Accept any remaining pending cards so revision can proceed.
  let otherCount = await page.locator('[data-testid^="pending-card-"]').count();
  while (otherCount > 0) {
    await page
      .locator('[data-testid^="pending-card-"] [data-testid="accept-btn"]')
      .first()
      .click();
    await waitForStoreIdle(page);
    otherCount = await page.locator('[data-testid^="pending-card-"]').count();
  }
  await expect(page.getByTestId("pending-section")).toHaveCount(0);

  // 5. Regenerate revision (v2). The rejected deterministic_qa card MUST be
  //    skipped — the rejected card's problem text comes from the engine, e.g.
  //    `금지 표현 "기타" 발견` — and that exact problem string must NOT show
  //    up inside the new version content.
  await page.goto(`/projects/${projectId}/qa`);
  await page.click('[data-testid="generate-revision-btn"]');
  await expect(page.getByTestId("version-row-v2")).toBeVisible();
  const v2Content = await page.getByTestId("version-content-v2").innerText();
  expect(v2Content).not.toContain('금지 표현 "기타" 발견');

  // 6. Approve final + verify clean / commentary export separation holds.
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();

  await page.goto(`/projects/${projectId}/exports`);
  await page.click('[data-testid="create-export-clean_docx-btn"]');
  await page.click('[data-testid="create-export-commentary_docx-btn"]');
  const cleanContent = await page.getByTestId("export-content-clean_docx").innerText();
  const commentaryContent = await page
    .getByTestId("export-content-commentary_docx")
    .innerText();
  expect(cleanContent).toContain("CLEAN EXTERNAL CONTRACT");
  expect(cleanContent).not.toContain("[COMMENTARY]");
  expect(cleanContent).not.toContain("[INTERNAL]");
  expect(commentaryContent).toContain("[COMMENTARY]");
});
