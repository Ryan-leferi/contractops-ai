import { expect, test } from "@playwright/test";

/**
 * GATED real-mode end-to-end test.
 *
 * Runs ONLY when E2E_REAL_OPENAI=true. CI must not set this. The webServer
 * configuration in playwright.config.ts must additionally have USE_REAL_LLM,
 * OPENAI_API_KEY, LLM_PROVIDER_ALLOWLIST, and the NEXT_PUBLIC_* mirrors set,
 * or this test will fail when it tries to hit /api/agent/deal-memo.
 *
 * Purpose: prove the real provider seam works end-to-end against an actual
 * OpenAI account, without changing the workflow code.
 */

const REAL_ENABLED = process.env.E2E_REAL_OPENAI === "true";

test.describe("Real OpenAI Deal Memo drafter (gated)", () => {
  test.skip(!REAL_ENABLED, "skipped: set E2E_REAL_OPENAI=true to run");

  test("Deal Memo content comes from a real OpenAI run; AgentRun shows mode=real provider_id=openai", async ({
    page,
  }) => {
    test.setTimeout(60_000); // real network latency

    await page.goto("/projects");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    // 1. Create project
    await page.goto("/projects/new");
    await page.fill("input#name", "Real-OpenAI Deal Memo E2E");
    await page.click('button[type="submit"]');
    await expect(page.getByTestId("project-name")).toBeVisible();
    const projectId = page.url().split("/projects/")[1]!;

    // 2. Sources + sanitized text
    await page.goto(`/projects/${projectId}/sources`);
    await page.fill('[data-testid="source-file-name"]', "synthetic_proposal.pdf");
    await page.click('[data-testid="add-source-btn"]');
    const firstToggle = page.locator('[data-testid^="toggle-content-"]').first();
    await firstToggle.click();
    const firstTextarea = page.locator('[data-testid^="source-content-textarea-"]').first();
    await firstTextarea.fill(
      "[synthetic] Test proposal: counterparty Acme Corp, term 12 months, fee 10,000,000 KRW.",
    );
    await page.locator('[data-testid^="save-content-"]').first().click();
    page.once("dialog", (d) => d.accept());
    await page.click('[data-testid="lock-pack-btn"]');

    // 3. NDA path
    await page.goto(`/projects/${projectId}/contract-type`);
    await page.fill('[data-testid="contract-type-input"]', "NDA");
    await page.click('[data-testid="confirm-type-btn"]');

    await page.goto(`/projects/${projectId}/playbook`);
    await page.click('[data-testid="select-playbook-btn"]');

    await page.goto(`/projects/${projectId}/intake`);
    await expect(page.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
    const intakeCards = page.locator('[data-testid^="intake-card-"]');
    const count = await intakeCards.count();
    for (let i = 0; i < count; i++) {
      const card = intakeCards.nth(i);
      await card.locator("input").fill(`answer ${i + 1}`);
      await card.locator("button").click();
    }

    // 4. Deal Memo — this MUST hit the real provider via /api/agent/deal-memo
    await page.goto(`/projects/${projectId}/deal-memo`);
    await page.click('[data-testid="generate-deal-memo-btn"]');
    await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted", { timeout: 30_000 });

    const content = await page.getByTestId("deal-memo-content").innerText();
    expect(content.length).toBeGreaterThan(20);

    // 5. Overview should show an AgentRun with mode=real / provider_id=openai
    await page.goto(`/projects/${projectId}`);
    const realModeBadge = page.locator('[data-testid="agent-run-mode-deal_memo_drafter"]');
    await expect(realModeBadge).toHaveText("real");
    const providerCode = page.locator('[data-testid="agent-run-provider-deal_memo_drafter"]');
    await expect(providerCode).toHaveText("openai");
  });
});
