import { expect, test } from "@playwright/test";
import { answerAllRequiredIntakeQuestions, waitForStoreIdle } from "./helpers";

/**
 * Milestone 3G — UI-level lawyer-only guards.
 *
 * Where Milestone 3F's `multi-actor.spec.ts` exercises the server-side
 * role rejection via the API, this spec checks the BROWSER-side
 * convenience: lawyer-only buttons must be disabled when the selected
 * actor is not a `human_lawyer`. Server enforcement remains the final
 * authority (still asserted at the end of this spec for safety).
 *
 * Scenario:
 *
 *   1. lawyer_kim creates the project and walks to "issues_open".
 *   2. Switch the actor selector to business_choi.
 *   3. Assert: Issue Card accept/reject/defer/partial-accept buttons are
 *      all disabled, the inline "lawyer required" note is visible, the
 *      `title` attribute carries the bilingual help text.
 *   4. Switch back to lawyer_park. Buttons re-enable.
 *   5. Park rejects a card with a reason note. History records park.
 *   6. Accept the remaining cards as park; generate a revision.
 *   7. Switch to business_choi again. Assert approve-final-btn is
 *      disabled even though the workflow allows it.
 *   8. Sanity: server still rejects a forced business_choi approval
 *      (UI guard is convenience, server is authority).
 *   9. Switch to park, approve final, download both DOCX exports
 *      (separation still holds).
 */

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/projects/reset");
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

async function selectActor(
  page: import("@playwright/test").Page,
  actorId: string,
) {
  // Settle any in-flight ops (including the initial GET /api/auth/session
  // on first mount) BEFORE switching. After 3I, `setActorId` POSTs to
  // /api/auth/demo/actor — if it raced an unfinished initial session
  // GET, the GET's late `setSession` could clobber our POST's result.
  await waitForStoreIdle(page);
  await page
    .getByTestId("actor-selector-input")
    .selectOption(actorId);
  // Wait for the POST /api/auth/demo/actor + setSession to land before
  // the next assertion / click reads `useCurrentActor()`.
  await waitForStoreIdle(page);
}

test("Issue decision buttons disable for business_choi, re-enable for lawyer_park; final approval guarded too", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);

  // 1. lawyer_kim creates + walks the project ──────────────────
  await selectActor(page, "lawyer_kim");
  await page.goto("/projects/new");
  await page.fill("input#name", "UI guard demo");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("UI guard demo");
  const projectId = page.url().split("/projects/")[1]!;

  // Milestone 3L: Kim (owner_lawyer) grants memberships up-front so
  // the dropdown-switches later in the test land on actors who CAN
  // open the project. Park gets owner_lawyer because the test runs
  // approve_final as park at the end (reviewer_lawyer lacks that
  // permission). Choi gets business_contributor — enough to view
  // the page; decide / approve / export-internal are correctly
  // denied by the matrix.
  const grantPark = await page.context().request.post(
    `/api/projects/${projectId}/memberships`,
    { data: { actor_id: "lawyer_park", project_role: "owner_lawyer" } },
  );
  await expect.poll(() => grantPark.status()).toBe(201);
  const grantChoi = await page.context().request.post(
    `/api/projects/${projectId}/memberships`,
    { data: { actor_id: "business_choi", project_role: "business_contributor" } },
  );
  await expect.poll(() => grantChoi.status()).toBe(201);

  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "proposal.pdf");
  await page.click('[data-testid="add-source-btn"]');
  await waitForStoreIdle(page);
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');
  await expect(page.getByTestId("source-pack-status")).toHaveText("Locked");

  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "NDA");
  await page.click('[data-testid="confirm-type-btn"]');
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');

  await page.goto(`/projects/${projectId}/intake`);
  // Helper gates each save on `waitForStoreIdle` — required because the
  // 3D StoreProvider made `applyProjectOp` async. Without per-save
  // gating, a tight fill→click loop drops answers on slow CI runners
  // (see helpers.ts comment + the original failure
  // "2/4 answered · 2 required missing" on GitHub Actions).
  await answerAllRequiredIntakeQuestions(page);

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

  // 2. Switch to business_choi ─────────────────────────────────
  await selectActor(page, "business_choi");
  await expect(page.getByTestId("actor-selector-role")).toHaveText("Business");

  // 3. Lawyer-only buttons must be disabled + warning visible ──
  await expect(page.getByTestId("lawyer-required-note").first()).toBeVisible();
  const firstPending = page.locator('[data-testid^="pending-card-"]').first();
  await expect(firstPending.locator('[data-testid="accept-btn"]')).toBeDisabled();
  await expect(firstPending.locator('[data-testid="reject-btn"]')).toBeDisabled();
  await expect(firstPending.locator('[data-testid="defer-btn"]')).toBeDisabled();
  // Tooltip carries the bilingual message.
  const acceptTitle = await firstPending
    .locator('[data-testid="accept-btn"]')
    .getAttribute("title");
  expect(acceptTitle).not.toBeNull();
  expect(acceptTitle!).toContain("human_lawyer");
  expect(acceptTitle!).toContain("변호사");

  // partial-accept-btn must also be disabled (regardless of partial_note input)
  await firstPending
    .locator('[data-testid="partial-note-input"]')
    .fill("attempted by business");
  await expect(firstPending.locator('[data-testid="partial-accept-btn"]')).toBeDisabled();

  // 4. Switch to lawyer_park → buttons re-enable ───────────────
  await selectActor(page, "lawyer_park");
  await expect(page.getByTestId("actor-selector-role")).toHaveText("Lawyer");
  await expect(
    page.locator('[data-testid="lawyer-required-note"]').first(),
  ).toBeHidden();
  const firstPendingAsPark = page.locator('[data-testid^="pending-card-"]').first();
  await expect(firstPendingAsPark.locator('[data-testid="accept-btn"]')).toBeEnabled();
  await expect(firstPendingAsPark.locator('[data-testid="reject-btn"]')).toBeEnabled();
  await expect(firstPendingAsPark.locator('[data-testid="defer-btn"]')).toBeEnabled();

  // 5. Park rejects a card with a reason note ──────────────────
  await firstPendingAsPark
    .locator('[data-testid="reason-note-input"]')
    .fill("park rejects (UI guard demo)");
  await firstPendingAsPark.locator('[data-testid="reject-btn"]').click();
  await waitForStoreIdle(page);

  const decidedRejected = page.locator('[data-testid="decided-card-rejected"]').first();
  await expect(decidedRejected).toBeVisible();
  await decidedRejected.locator('[data-testid^="history-toggle-"]').first().click();
  const hist = decidedRejected.locator('[data-testid^="history-panel-"]').first();
  await expect(hist).toContainText("pending → rejected");
  await expect(hist).toContainText("lawyer_park");
  await expect(hist).toContainText("park rejects");

  // 6. Park accepts the rest, generates revision ───────────────
  let remaining = await page.locator('[data-testid^="pending-card-"]').count();
  while (remaining > 0) {
    await page
      .locator('[data-testid^="pending-card-"] [data-testid="accept-btn"]')
      .first()
      .click();
    await waitForStoreIdle(page);
    remaining = await page.locator('[data-testid^="pending-card-"]').count();
  }
  await page.goto(`/projects/${projectId}/qa`);
  await page.click('[data-testid="generate-revision-btn"]');
  await expect(page.getByTestId("version-row-v1")).toBeVisible();

  // 7. Switch back to business_choi → approve-final-btn disabled ─
  await selectActor(page, "business_choi");
  await expect(page.getByTestId("approve-final-btn")).toBeDisabled();
  await expect(page.getByTestId("lawyer-required-note")).toBeVisible();

  // 8. Server is still the authoritative check ────────────────
  // Milestone 3I: the request body must NOT carry actor_id. The
  // server resolves the actor from the session cookie. Use the
  // page's own request context so the business_choi cookie set by
  // the dropdown above is sent automatically.
  // Milestone 3L: Choi is now a project member (business_contributor)
  // but `approve_final` is owner_lawyer-only — the project RBAC layer
  // returns 403 PROJECT_PERMISSION_DENIED BEFORE reaching the core
  // role guard. The UI-button-disabled assertion above is what we
  // expose to the user; this is the server's authoritative refusal.
  const blockedResp = await page.context().request.post(
    `/api/projects/${projectId}/operations`,
    {
      data: { name: "approve_final", args: {} },
    },
  );
  expect(blockedResp.status()).toBe(403);
  const blockedBody = (await blockedResp.json()) as { error: string; code: string };
  expect(blockedBody.code).toBe("PROJECT_PERMISSION_DENIED");

  // 8b. body.actor_id is rejected outright — even attempting to
  // pose as a lawyer while logged in as business_choi must fail
  // with OPERATION_ACTOR_ID_FORBIDDEN before the operation runs.
  const impersonate = await page.context().request.post(
    `/api/projects/${projectId}/operations`,
    {
      data: { name: "approve_final", args: {}, actor_id: "lawyer_kim" },
    },
  );
  expect(impersonate.status()).toBe(400);
  const impBody = (await impersonate.json()) as { code: string };
  expect(impBody.code).toBe("OPERATION_ACTOR_ID_FORBIDDEN");
  void request;

  // 9. Park completes the workflow + DOCX export separation holds ─
  await selectActor(page, "lawyer_park");
  await expect(page.getByTestId("approve-final-btn")).toBeEnabled();
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();

  await page.goto(`/projects/${projectId}/exports`);
  const [cleanDl] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-clean_docx-btn"]'),
  ]);
  expect(cleanDl.suggestedFilename()).toMatch(/_clean\.docx$/);
  const [commentaryDl] = await Promise.all([
    page.waitForEvent("download"),
    page.click('[data-testid="create-export-commentary_docx-btn"]'),
  ]);
  expect(commentaryDl.suggestedFilename()).toMatch(/_commentary_INTERNAL\.docx$/);
});

test("export buttons disable for business_choi even when a final version exists", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);

  // Setup as lawyer_kim → full happy path so a final version exists.
  await selectActor(page, "lawyer_kim");
  await page.goto("/projects/new");
  await page.fill("input#name", "Export guard demo");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("Export guard demo");
  const projectId = page.url().split("/projects/")[1]!;

  // Milestone 3L: Choi needs membership to even open the project.
  // business_contributor gives view + export_clean; commentary +
  // negotiation export are correctly denied by the matrix.
  const grantChoi = await page.context().request.post(
    `/api/projects/${projectId}/memberships`,
    { data: { actor_id: "business_choi", project_role: "business_contributor" } },
  );
  await expect.poll(() => grantChoi.status()).toBe(201);

  await page.goto(`/projects/${projectId}/sources`);
  await page.fill('[data-testid="source-file-name"]', "p.pdf");
  await page.click('[data-testid="add-source-btn"]');
  await waitForStoreIdle(page);
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="lock-pack-btn"]');
  await waitForStoreIdle(page);
  await page.goto(`/projects/${projectId}/contract-type`);
  await page.fill('[data-testid="contract-type-input"]', "NDA");
  await page.click('[data-testid="confirm-type-btn"]');
  await page.goto(`/projects/${projectId}/playbook`);
  await page.click('[data-testid="select-playbook-btn"]');
  await page.goto(`/projects/${projectId}/intake`);
  await answerAllRequiredIntakeQuestions(page);
  await page.goto(`/projects/${projectId}/deal-memo`);
  await page.click('[data-testid="generate-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-deal-memo-btn"]');
  await expect(page.getByTestId("deal-memo-status")).toHaveText("Approved");
  await page.goto(`/projects/${projectId}/drafting-plan`);
  await page.click('[data-testid="generate-plan-btn"]');
  await expect(page.getByTestId("plan-status")).toHaveText("Drafted");
  await page.click('[data-testid="approve-plan-btn"]');
  await page.goto(`/projects/${projectId}/draft`);
  await page.click('[data-testid="generate-v0-btn"]');
  await expect(page.getByTestId("v0-content")).toContainText("MOCK v0 DRAFT");
  await page.goto(`/projects/${projectId}/issues`);
  await page.click('[data-testid="run-reviews-btn"]');
  await expect(page.getByTestId("pending-section")).toBeVisible();
  let remaining = await page.locator('[data-testid^="pending-card-"]').count();
  while (remaining > 0) {
    await page
      .locator('[data-testid^="pending-card-"] [data-testid="accept-btn"]')
      .first()
      .click();
    await waitForStoreIdle(page);
    remaining = await page.locator('[data-testid^="pending-card-"]').count();
  }
  await page.goto(`/projects/${projectId}/qa`);
  await waitForStoreIdle(page);
  await expect(page.getByTestId("generate-revision-btn")).toBeEnabled();
  await page.click('[data-testid="generate-revision-btn"]');
  await expect(page.getByTestId("version-row-v1")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.click('[data-testid="approve-final-btn"]');
  await expect(page.getByTestId("final-approved-banner")).toBeVisible();

  // Switch to business_choi → exports disabled despite final-approved version
  await page.goto(`/projects/${projectId}/exports`);
  await selectActor(page, "business_choi");
  await expect(page.getByTestId("lawyer-required-note")).toBeVisible();
  await expect(page.getByTestId("create-export-clean_docx-btn")).toBeDisabled();
  await expect(page.getByTestId("create-export-commentary_docx-btn")).toBeDisabled();
  await expect(page.getByTestId("create-export-cover_email-btn")).toBeDisabled();
  await expect(page.getByTestId("create-export-negotiation_matrix-btn")).toBeDisabled();

  // Switch back to a lawyer → exports re-enable.
  await selectActor(page, "lawyer_kim");
  await expect(page.getByTestId("create-export-clean_docx-btn")).toBeEnabled();

  // request kept so the parameter is "used" — placeholder for future
  // server-side cross-check if the export route ever grows a role check.
  void request;
});
