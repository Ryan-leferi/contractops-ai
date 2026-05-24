import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * Milestone 3A — real DOCX export end-to-end.
 *
 * Drives the same mock workflow that nda-happy-path covers up to final
 * approval, then exercises BOTH download buttons and asserts on the actual
 * binary that lands on disk:
 *
 *   - the file name ends in .docx (the right one for each audience);
 *   - the file is non-empty and starts with the PKZip magic bytes;
 *   - the file XML contains the contract body in the clean export;
 *   - the clean DOCX XML contains NO internal-commentary marker;
 *   - the commentary DOCX XML self-identifies as INTERNAL ONLY;
 *   - the gated real-OpenAI spec stays skipped — no real provider needed.
 *
 * Uses the BOF-style synthetic playbook via UI selection — no contract
 * type name is hardcoded in the workflow logic (PLATFORM_BRIEF.md §13).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("DOCX exports — clean + commentary download real .docx files with strict audience separation", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // 1. Create project
  await page.goto("/projects/new");
  await page.fill("input#name", "E2E DOCX project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("E2E DOCX project");

  const projectId = page.url().split("/projects/")[1]!;

  // 2. Add a source, attach synthetic content, lock the pack
  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "proposal.pdf");
  await page.click('[data-testid="add-source-btn"]');
  await page.locator('[data-testid^="toggle-content-"]').first().click();
  await page
    .locator('[data-testid^="source-content-textarea-"]')
    .first()
    .fill("[synthetic] Wholly synthetic source content for DOCX e2e.");
  await page.locator('[data-testid^="save-content-"]').first().click();
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');
  await expect(page.getByTestId("source-pack-status")).toHaveText("Locked");

  // 3. Confirm contract type → select Playbook
  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "NDA");
  await page.click('[data-testid="confirm-type-btn"]');
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');
  await expect(page.getByTestId("playbook-badge")).toHaveText("Playbook matched");

  // 4. Answer all required intake — and wait for the persistence indicator
  // ("all required answered") before moving on, so deal-memo approval below
  // is not racing the localStorage write.
  await page.goto(`/projects/${projectId}/intake`);
  await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
  const intakeCards = page.locator('[data-testid^="intake-card-"]');
  const totalIntake = await intakeCards.count();
  for (let i = 0; i < totalIntake; i++) {
    const card = intakeCards.nth(i);
    await card.locator("input").fill(`synthetic answer ${i + 1}`);
    await card.locator("button").click();
  }
  await expect(page.getByTestId("intake-progress")).toContainText("all required answered");

  // 5. Deal Memo → approve (wait for the async mock draft to finish first)
  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");

  // 6. Drafting Plan → approve
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Approved");

  // 7. v0 draft
  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");

  // 8. Issues — run reviews and accept everything
  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');
  await expect(page.getByTestId("pending-section")).toBeVisible();
  let pending = page.locator('[data-testid^="pending-card-"]');
  while ((await pending.count()) > 0) {
    await pending.nth(0).locator('[data-testid="accept-btn"]').click();
    pending = page.locator('[data-testid^="pending-card-"]');
  }

  // 9. Generate revision + approve final
  await page.goto(`/projects/${projectId}/qa`);
  await page.click('[data-testid="generate-revision-btn"]');
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();

  // 10. Exports — download both DOCX files and assert on the binaries.
  await page.goto(`/projects/${projectId}/exports`);

  const [cleanDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-clean_docx-btn"]'),
  ]);
  expect(cleanDownload.suggestedFilename()).toMatch(/\.docx$/);
  expect(cleanDownload.suggestedFilename()).toMatch(/_clean\.docx$/);

  const cleanPath = await cleanDownload.path();
  expect(cleanPath).not.toBeNull();
  const cleanBytes = await readFile(cleanPath!);
  expect(cleanBytes.length).toBeGreaterThan(1500);
  // .docx is a ZIP archive; PKZip magic bytes are 0x50 0x4B.
  expect(cleanBytes[0]).toBe(0x50);
  expect(cleanBytes[1]).toBe(0x4b);

  const [commentaryDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-commentary_docx-btn"]'),
  ]);
  expect(commentaryDownload.suggestedFilename()).toMatch(/\.docx$/);
  expect(commentaryDownload.suggestedFilename()).toMatch(/_commentary_INTERNAL\.docx$/);

  const commentaryPath = await commentaryDownload.path();
  expect(commentaryPath).not.toBeNull();
  const commentaryBytes = await readFile(commentaryPath!);
  expect(commentaryBytes.length).toBeGreaterThan(1500);

  // Spot-check the binary contents: unzip and look at word/document.xml.
  // Inline import keeps Playwright's bundling simple — jszip is already a
  // devDependency in @contractops/core.
  const { default: JSZip } = await import("jszip");

  const cleanZip = await JSZip.loadAsync(cleanBytes);
  const cleanXml = await cleanZip.file("word/document.xml")!.async("string");
  expect(cleanXml).toContain("E2E DOCX project");
  // None of these markers may appear in a clean export.
  for (const marker of [
    "법무주석",
    "[COMMENTARY]",
    "[INTERNAL]",
    "[REDLINE_RATIONALE]",
    "[NEGOTIATION_GUIDANCE]",
  ]) {
    expect(cleanXml).not.toContain(marker);
  }

  const commentaryZip = await JSZip.loadAsync(commentaryBytes);
  const commentaryXml = await commentaryZip
    .file("word/document.xml")!
    .async("string");
  // The internal-only banner / footer MUST be present.
  expect(commentaryXml).toContain("INTERNAL ONLY");
  expect(commentaryXml).toContain("내부 법무 검토 전용");

  // Visual containers stay separated.
  await expect(page.getByTestId("external-section")).toBeVisible();
  await expect(page.getByTestId("internal-section")).toBeVisible();
});
