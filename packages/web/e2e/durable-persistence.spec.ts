import { expect, test } from "@playwright/test";
import { waitForStoreIdle } from "./helpers";

/**
 * GATED durable-persistence Playwright spec (Milestone 3E).
 *
 * Runs ONLY when `E2E_DURABLE_PERSISTENCE=true`. CI never sets this. The
 * webServer that Playwright starts must additionally be running with:
 *
 *   PERSISTENCE_DRIVER=file
 *   PERSISTENCE_FILE_PATH=.tmp-e2e-data  (or any path on the local disk)
 *
 * Locally:
 *
 *   E2E_DURABLE_PERSISTENCE=true \
 *     PERSISTENCE_DRIVER=file \
 *     PERSISTENCE_FILE_PATH=.tmp-e2e-data \
 *     npm run e2e -w @contractops/web
 *
 * The test:
 *   1. resets the server store (drops the on-disk JSON/JSONL files);
 *   2. browser context A creates a project + walks to issues_open;
 *   3. browser context A rejects one Issue Card;
 *   4. browser context A closes;
 *   5. browser context B opens the SAME project URL — sees the project,
 *      sees the rejected decision in history.
 *
 * Step 5 succeeds even though context A is closed because the file
 * adapter persisted the state to disk. The reset call at the start of
 * the test keeps the suite repeatable.
 */

const DURABLE_ENABLED = process.env.E2E_DURABLE_PERSISTENCE === "true";

test.describe("Durable persistence (file adapter, gated)", () => {
  test.skip(!DURABLE_ENABLED, "skipped: set E2E_DURABLE_PERSISTENCE=true to run");

  test("project + decision history survive a fresh browser context against the file-backed store", async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000);

    // 1. Reset the server's durable store so the test is self-contained.
    //    The /api/projects/reset route deletes every JSON/JSONL file under
    //    PERSISTENCE_FILE_PATH (file adapter implementation of
    //    resetDemoStore = rm -rf <root>/projects).
    await request.post("/api/projects/reset");

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    await pageA.goto("/projects/new");
    await pageA.fill("input#name", "Durable persistence e2e");
    await pageA.click('button[type="submit"]');
    await expect(pageA.getByTestId("project-name")).toHaveText(
      "Durable persistence e2e",
    );
    const projectId = pageA.url().split("/projects/")[1]!;

    // Walk up through "issues_open" the same fast path used by other specs.
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

    await pageA.goto(`/projects/${projectId}/intake`);
    await expect(pageA.locator('[data-testid^="intake-card-"]').first()).toBeVisible();
    const intakeCards = pageA.locator('[data-testid^="intake-card-"]');
    const totalIntake = await intakeCards.count();
    for (let i = 0; i < totalIntake; i++) {
      const card = intakeCards.nth(i);
      await card.locator("input").fill(`a${i + 1}`);
      await card.locator("button").click();
    }
    await expect(pageA.getByTestId("intake-progress")).toContainText(
      "all required answered",
    );

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
    await expect(pageA.getByTestId("pending-section")).toBeVisible();

    // 3. A rejects the first pending card with a reason note.
    const firstPending = pageA.locator('[data-testid^="pending-card-"]').first();
    await firstPending
      .locator('[data-testid="reason-note-input"]')
      .fill("durable persistence demo — rejected by A");
    await firstPending.locator('[data-testid="reject-btn"]').click();
    await waitForStoreIdle(pageA);
    await expect(pageA.getByTestId("dash-rejected")).toContainText("1");

    // 4. A closes — simulating a tab-close or even a browser-restart.
    await contextA.close();

    // 5. A fresh browser context (no shared cookies, no shared localStorage)
    //    opens the SAME project URL. The state and decision_history must
    //    still be there because the file adapter wrote them to disk.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`/projects/${projectId}/issues`);
    await waitForStoreIdle(pageB);

    // Project metadata visible
    await expect(pageB.getByTestId("review-dashboard")).toBeVisible();

    // Rejected card + reason note visible
    const decidedRejected = pageB.locator('[data-testid="decided-card-rejected"]').first();
    await expect(decidedRejected).toBeVisible();
    await expect(
      decidedRejected.locator('[data-testid^="reason-note-"]').first(),
    ).toContainText("durable persistence demo — rejected by A");

    // Decision history readable from a fresh context
    await decidedRejected.locator('[data-testid^="history-toggle-"]').first().click();
    const historyPanel = decidedRejected.locator('[data-testid^="history-panel-"]').first();
    await expect(historyPanel).toBeVisible();
    await expect(historyPanel).toContainText("pending → rejected");
    await expect(historyPanel).toContainText("durable persistence demo — rejected by A");

    // The /api/projects/[id]/decision-history endpoint also reflects it.
    const histResp = await request.get(`/api/projects/${projectId}/decision-history`);
    expect(histResp.ok()).toBe(true);
    const histBody = (await histResp.json()) as {
      history: { previous_decision: string; new_decision: string; reason_note: string | null }[];
    };
    expect(histBody.history).toHaveLength(1);
    expect(histBody.history[0]!.new_decision).toBe("rejected");
    expect(histBody.history[0]!.reason_note).toBe(
      "durable persistence demo — rejected by A",
    );

    await contextB.close();
  });
});
