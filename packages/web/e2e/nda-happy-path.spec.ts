import { expect, test } from "@playwright/test";
import { waitForStoreIdle } from "./helpers";

/**
 * NDA happy-path end-to-end. Drives the UI from project creation through
 * to clean + commentary export placeholders, asserting each milestone-1C
 * acceptance criterion along the way.
 */

test.beforeEach(async ({ page, request }) => {
  // 3D: state lives in the server-side in-memory store. Reset it before
  // each test so the suite stays isolated.
  await request.post("/api/projects/reset");
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("NDA happy path — create → sources → confirm → playbook → intake → deal memo → drafting plan → v0 → reviews → decisions → revision → final → exports", async ({
  page,
}) => {
  // 1. Create project
  await page.goto("/projects/new");
  await page.fill('input#name', "E2E NDA project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("E2E NDA project");
  await expect(page.getByTestId("project-status")).toHaveText("created");

  const projectUrl = page.url();
  const projectId = projectUrl.split("/projects/")[1]!;

  // 2. Sources — add then lock
  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "proposal_v1.pdf");
  await page.click('[data-testid="add-source-btn"]');
  await expect(page.getByTestId("source-row")).toHaveCount(1);

  // Add a second source for realism
  await page.fill('[data-testid="source-file-name"]', "operation_guide.pdf");
  await page.locator('select#stype').selectOption("operation_guide");
  await page.click('[data-testid="add-source-btn"]');
  await expect(page.getByTestId("source-row")).toHaveCount(2);

  // 2-bis. Attach SYNTHETIC text content to the first source document.
  // Verifies the source-content textarea + SourceDocumentContent flow.
  const firstRowToggle = page.locator('[data-testid^="toggle-content-"]').first();
  await firstRowToggle.click();
  const firstTextarea = page.locator('[data-testid^="source-content-textarea-"]').first();
  await firstTextarea.fill(
    "[synthetic] Mock proposal content for E2E. Defines obligations and parties.",
  );
  await page.locator('[data-testid^="save-content-"]').first().click();
  // After save the textarea collapses; "content attached" appears in the row subtitle
  await expect(page.locator('[data-testid="source-row"]').first()).toContainText("content attached");

  // 2a. Source Pack lock prevents new source addition
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');
  await expect(page.getByTestId("source-pack-status")).toHaveText("Locked");
  await expect(page.getByTestId("pack-locked-info")).toBeVisible();
  // The add-source form is no longer in the DOM
  await expect(page.locator('[data-testid="source-file-name"]')).toHaveCount(0);

  // 3. Contract type — confirm "NDA"
  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "NDA");
  await page.click('[data-testid="confirm-type-btn"]');
  await expect(page.getByTestId("contract-type-status")).toHaveText("Confirmed");

  // 4. Playbook — select
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');
  await expect(page.getByTestId("playbook-name")).toHaveText("NDA");
  await expect(page.getByTestId("playbook-badge")).toHaveText("Playbook matched");

  // 5. Intake — answer all required, then verify Deal Memo approval is blocked until done.
  await page.goto(`/projects/${projectId}/intake`);
  // Wait for hydration: the StoreProvider re-loads from localStorage on mount.
  await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const intakeCards = page.locator('[data-testid^="intake-card-"]');
  const totalCount = await intakeCards.count();
  expect(totalCount).toBeGreaterThan(0);

  // 5a. Try to approve Deal Memo first without answering — should fail.
  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("page-error")).toContainText("Required intake questions");

  // 5b. Go back, answer all required intake questions.
  await page.goto(`/projects/${projectId}/intake`);
  for (let i = 0; i < totalCount; i++) {
    const card = intakeCards.nth(i);
    const input = card.locator('input');
    const save = card.locator('button');
    await input.fill(`answer ${i + 1}`);
    await save.click();
  }
  await expect(page.getByTestId("intake-progress")).toContainText("all required answered");

  // 6. Deal Memo — approve
  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");

  // 7. Drafting Plan
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");

  // 8. v0 draft
  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");

  // 9. Issues — run reviews, then decide one of each: accept / reject / partial
  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');
  await expect(page.getByTestId("pending-section")).toBeVisible();
  const pendingCards = page.locator('[data-testid^="pending-card-"]');
  const pendingCount = await pendingCards.count();
  expect(pendingCount).toBeGreaterThanOrEqual(3);

  // First card → reject (so we can later verify it's absent from revision)
  const rejectCard = pendingCards.nth(0);
  const rejectProblemText = await rejectCard.locator('h3').first().innerText();
  await rejectCard.locator('[data-testid="reject-btn"]').click();
  await waitForStoreIdle(page);

  // Second pending → partial accept
  let remainingCount = await page.locator('[data-testid^="pending-card-"]').count();
  if (remainingCount > 1) {
    const partialCard = page.locator('[data-testid^="pending-card-"]').nth(0);
    await partialCard.locator('[data-testid="partial-note-input"]').fill("Cap at 50%");
    await partialCard.locator('[data-testid="partial-accept-btn"]').click();
    await waitForStoreIdle(page);
  }

  // Accept all remaining pending cards — re-query each iteration since the
  // DOM mutates after every decision (3D: server round-trip + react commit).
  remainingCount = await page.locator('[data-testid^="pending-card-"]').count();
  while (remainingCount > 0) {
    await page
      .locator('[data-testid^="pending-card-"] [data-testid="accept-btn"]')
      .first()
      .click();
    await waitForStoreIdle(page);
    remainingCount = await page.locator('[data-testid^="pending-card-"]').count();
  }

  await expect(page.getByTestId("pending-section")).toHaveCount(0);

  // 10. QA — generate revision and approve final
  await page.goto(`/projects/${projectId}/qa`);
  await expect(page.getByTestId("stat-pending")).toContainText("0");
  // The skipped stat must include at least the one we rejected
  const skippedText = await page.getByTestId("stat-skipped").innerText();
  expect(parseInt(skippedText.split("\n").pop() || "0", 10)).toBeGreaterThanOrEqual(1);

  await page.click('[data-testid="generate-revision-btn"]');
  await expect(page.getByTestId("version-row-v1")).toBeVisible();

  // 10a. Verify rejected card content is absent from v1
  const v1Content = await page.getByTestId("version-content-v1").innerText();
  expect(v1Content).not.toContain(rejectProblemText);

  // 10b. Approve final
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();

  // 11. Exports — clean + commentary buttons download real DOCX binaries
  // (Milestone 3A). The downloads are awaited so Playwright consumes the
  // events deterministically. After each download the page also stores a
  // human-readable metadata summary in localStorage so the export-content
  // testid still has the in-page assertions from earlier milestones.
  await page.goto(`/projects/${projectId}/exports`);

  const [cleanDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-clean_docx-btn"]'),
  ]);
  expect(cleanDownload.suggestedFilename()).toMatch(/_clean\.docx$/);

  const [commentaryDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-commentary_docx-btn"]'),
  ]);
  expect(commentaryDownload.suggestedFilename()).toMatch(/_commentary_INTERNAL\.docx$/);

  const cleanContent = await page.getByTestId("export-content-clean_docx").innerText();
  const commentaryContent = await page.getByTestId("export-content-commentary_docx").innerText();
  expect(cleanContent).toContain("CLEAN EXTERNAL CONTRACT");
  expect(cleanContent).not.toContain("[COMMENTARY]");
  expect(cleanContent).not.toContain("[INTERNAL]");
  expect(cleanContent).not.toContain("[REDLINE_RATIONALE]");
  expect(cleanContent).not.toContain("[NEGOTIATION_GUIDANCE]");
  expect(commentaryContent).toContain("[COMMENTARY]");

  // The two sections render in distinct containers.
  await expect(page.getByTestId("external-section")).toBeVisible();
  await expect(page.getByTestId("internal-section")).toBeVisible();
});
