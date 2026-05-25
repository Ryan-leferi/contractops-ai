import { expect, type Page } from "@playwright/test";

/**
 * Wait for every in-flight store operation to land (Milestone 3D).
 *
 * The 3D StoreProvider tracks the number of running fetch + mutation
 * operations and mirrors the count onto `<html data-ops-in-flight="N">`.
 * Tests should `await waitForStoreIdle(page)` after any mutation click
 * before reading post-mutation DOM, so the assertion is gated on the
 * server round-trip + React commit having actually happened.
 *
 * Without this, the legacy synchronous-localStorage assumption (click →
 * DOM updated instantly) becomes a race against the new POST /api/...
 * round-trip.
 */
export async function waitForStoreIdle(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.dataset.opsInFlight === "0",
    null,
    { timeout: timeoutMs },
  );
}

/**
 * Answer every intake question rendered on the /intake page, one save at
 * a time, gated on the store going idle between each save.
 *
 * Required because the 3D StoreProvider made `applyProjectOp` async: a
 * tight `fill → click; fill → click;` loop without `waitForStoreIdle`
 * between saves races the React state commit. On slow CI runners
 * (GitHub Actions specifically) a click can fire while the previous
 * answer is still in flight, dispatching the next save from a stale
 * snapshot and silently losing the earlier answer — observed as
 * `intake-progress` reading "2/4 answered · 2 required missing" even
 * though the loop clicked Save four times.
 *
 * The helper:
 *   1. waits for at least one intake card to hydrate;
 *   2. fills + saves each card in order;
 *   3. waits for the store to settle after every save;
 *   4. asserts the page's own "all required answered" gate.
 *
 * The Custom Contract spec uses its own inline loop with `waitForStoreIdle`
 * inside; this helper is a drop-in replacement that bakes that pattern in.
 */
export async function answerAllRequiredIntakeQuestions(
  page: Page,
  timeoutMs = 10_000,
): Promise<void> {
  const cards = page.locator('[data-testid^="intake-card-"]');
  // (1) hydrate — the page may render the heading before the cards mount.
  await expect(cards.first()).toBeVisible({ timeout: timeoutMs });
  const total = await cards.count();
  for (let i = 0; i < total; i++) {
    const card = cards.nth(i);
    await card.locator("input").fill(`a${i + 1}`);
    await card.locator("button").click();
    // (3) gate next iteration on the previous save landing.
    await waitForStoreIdle(page, timeoutMs);
  }
  // (4) page-owned guard — never advance to Deal Memo without it.
  await expect(page.getByTestId("intake-progress")).toContainText(
    "all required answered",
  );
}
