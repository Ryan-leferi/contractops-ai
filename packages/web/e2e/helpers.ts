import { expect, type BrowserContext, type Page } from "@playwright/test";

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
 * Seed the demo session actor cookie on a browser context before the
 * first navigation (Milestone 3I).
 *
 * After 3I the client no longer reads `localStorage`; the server
 * resolves the actor from the `contractops_demo_actor` cookie. Playwright
 * specs that want a non-default actor (lawyer_park, business_choi, …)
 * inject the cookie up front so `GET /api/auth/session` on first mount
 * returns the intended actor.
 *
 * `name` and `path` must match `DEMO_SESSION_COOKIE_NAME` exactly —
 * the server only reads cookies at `path=/` for our routes.
 *
 * The base URL is read from the Playwright config (`baseURL` in
 * `playwright.config.ts` is `http://localhost:3100`). We pass it as a
 * full URL string so `addCookies` doesn't need a separate `domain`
 * field.
 */
export async function setDemoActorCookie(
  context: BrowserContext,
  actorId: string,
  baseUrl = "http://localhost:3100",
): Promise<void> {
  // Playwright accepts EITHER `url` OR (`domain` + `path`), not both.
  // Passing `url` implicitly anchors the cookie to that origin at
  // path "/", which is exactly what `DEMO_SESSION_COOKIE_NAME` is
  // scoped to on the server side.
  await context.addCookies([
    {
      name: "contractops_demo_actor",
      value: actorId,
      url: baseUrl,
      sameSite: "Lax",
    },
  ]);
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
