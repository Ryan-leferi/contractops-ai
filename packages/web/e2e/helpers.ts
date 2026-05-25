import type { Page } from "@playwright/test";

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
