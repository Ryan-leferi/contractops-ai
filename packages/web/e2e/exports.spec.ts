import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * Milestone 3B — all four real exports end-to-end.
 *
 * Drives the mock workflow up to final approval, then exercises every
 * export download button and asserts on the actual file that lands on
 * disk:
 *
 *   - clean_docx          → external, .docx, no internal markers in XML
 *   - cover_email         → external, .md, no internal markers in Markdown
 *   - commentary_docx     → internal, .docx, INTERNAL ONLY banner in XML
 *   - negotiation_matrix  → internal, .docx, INTERNAL ONLY banner in XML
 *
 * The gated real-OpenAI spec stays skipped — no real provider needed.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("all four MVP exports download with correct format and strict audience separation", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // 1. Create project
  await page.goto("/projects/new");
  await page.fill("input#name", "E2E exports project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("E2E exports project");

  const projectId = page.url().split("/projects/")[1]!;

  // 2. Add a source, attach synthetic content, lock the pack
  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "proposal.pdf");
  await page.click('[data-testid="add-source-btn"]');
  await page.locator('[data-testid^="toggle-content-"]').first().click();
  await page
    .locator('[data-testid^="source-content-textarea-"]')
    .first()
    .fill("[synthetic] Wholly synthetic source content for exports e2e.");
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

  // 4. Answer all required intake — wait for persistence indicator
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

  // 5. Deal Memo + Drafting Plan + v0 + Issues + final approval
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

  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');
  await expect(page.getByTestId("pending-section")).toBeVisible();

  // Reject the first pending card so the negotiation matrix has a rejected
  // entry to render, then accept the rest.
  const firstReject = page.locator('[data-testid^="pending-card-"]').nth(0);
  await firstReject.locator('[data-testid="reject-btn"]').click();
  let pending = page.locator('[data-testid^="pending-card-"]');
  while ((await pending.count()) > 0) {
    await pending.nth(0).locator('[data-testid="accept-btn"]').click();
    pending = page.locator('[data-testid^="pending-card-"]');
  }

  await page.goto(`/projects/${projectId}/qa`);
  await page.click('[data-testid="generate-revision-btn"]');
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();

  // 6. Exports — download all four and assert on the binaries.
  await page.goto(`/projects/${projectId}/exports`);

  // ── clean DOCX ──────────────────────────────────────────────────
  const [cleanDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-clean_docx-btn"]'),
  ]);
  expect(cleanDownload.suggestedFilename()).toMatch(/_clean\.docx$/);
  const cleanBytes = await readFile((await cleanDownload.path())!);
  expect(cleanBytes.length).toBeGreaterThan(1500);
  expect(cleanBytes[0]).toBe(0x50); // PK magic
  expect(cleanBytes[1]).toBe(0x4b);

  // ── cover email Markdown ────────────────────────────────────────
  const [emailDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-cover_email-btn"]'),
  ]);
  expect(emailDownload.suggestedFilename()).toMatch(/_cover_email\.md$/);
  const emailBytes = await readFile((await emailDownload.path())!);
  expect(emailBytes.length).toBeGreaterThan(100);
  // NOT a zip / DOCX
  expect(emailBytes[0]).not.toBe(0x50);
  const emailText = new TextDecoder().decode(emailBytes);

  // ── commentary DOCX ─────────────────────────────────────────────
  const [commentaryDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-commentary_docx-btn"]'),
  ]);
  expect(commentaryDownload.suggestedFilename()).toMatch(/_commentary_INTERNAL\.docx$/);
  const commentaryBytes = await readFile((await commentaryDownload.path())!);
  expect(commentaryBytes.length).toBeGreaterThan(1500);

  // ── negotiation matrix DOCX ─────────────────────────────────────
  const [matrixDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-negotiation_matrix-btn"]'),
  ]);
  expect(matrixDownload.suggestedFilename()).toMatch(/_negotiation_matrix_INTERNAL\.docx$/);
  const matrixBytes = await readFile((await matrixDownload.path())!);
  expect(matrixBytes.length).toBeGreaterThan(1500);

  // ── Cross-file binary introspection (jszip) ─────────────────────
  const { default: JSZip } = await import("jszip");

  const cleanZip = await JSZip.loadAsync(cleanBytes);
  const cleanXml = await cleanZip.file("word/document.xml")!.async("string");
  expect(cleanXml).toContain("E2E exports project");
  // External MUST NOT contain any internal marker.
  for (const marker of [
    "법무주석",
    "[COMMENTARY]",
    "[INTERNAL]",
    "[REDLINE_RATIONALE]",
    "[NEGOTIATION_GUIDANCE]",
  ]) {
    expect(cleanXml).not.toContain(marker);
  }

  // Cover email — external, same prohibition.
  for (const marker of [
    "법무주석",
    "[COMMENTARY]",
    "[INTERNAL]",
    "[REDLINE_RATIONALE]",
    "[NEGOTIATION_GUIDANCE]",
  ]) {
    expect(emailText).not.toContain(marker);
  }
  expect(emailText).toContain("안녕하십니까");
  expect(emailText).toContain("감사합니다");
  expect(emailText).toContain("does NOT auto-send");

  // Commentary — internal banner required.
  const commentaryZip = await JSZip.loadAsync(commentaryBytes);
  const commentaryXml = await commentaryZip
    .file("word/document.xml")!
    .async("string");
  expect(commentaryXml).toContain("INTERNAL ONLY");
  expect(commentaryXml).toContain("내부 법무 검토 전용");

  // Negotiation matrix — internal banner + matrix-specific heading.
  const matrixZip = await JSZip.loadAsync(matrixBytes);
  const matrixXml = await matrixZip.file("word/document.xml")!.async("string");
  expect(matrixXml).toContain("INTERNAL ONLY");
  expect(matrixXml).toContain("내부 법무 검토 전용");
  expect(matrixXml).toContain("Negotiation Matrix");
  // It MUST reference the rejected decision we recorded above so the matrix
  // is genuinely covering the full decision trail.
  expect(matrixXml).toMatch(/rejected/);

  // Visual containers stay separated.
  await expect(page.getByTestId("external-section")).toBeVisible();
  await expect(page.getByTestId("internal-section")).toBeVisible();
});
