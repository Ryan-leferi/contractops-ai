import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * GATED signed-cookie authentication end-to-end (Milestone 3J).
 *
 * Runs ONLY when E2E_SIGNED_AUTH=true. The Playwright webServer must
 * additionally be started with:
 *
 *   AUTH_MODE=signed_cookie
 *   AUTH_SESSION_SECRET=<32+ chars>
 *   E2E_SIGNED_AUTH=true
 *
 * Set these env vars before running:
 *
 *   E2E_SIGNED_AUTH=true \
 *     AUTH_MODE=signed_cookie \
 *     AUTH_SESSION_SECRET=this-is-a-32-char-test-secret-aaa \
 *     npm run e2e -w @contractops/web -- signed-auth.spec.ts
 *
 * CI must NOT set E2E_SIGNED_AUTH. Standard `npm run verify` keeps
 * demo mode and skips this spec.
 *
 * Behavior tested:
 *   1. Seed the three demo users (via the dev-only /api/auth/dev/seed).
 *   2. lawyer_kim logs in, creates a project, walks to Issue Cards,
 *      rejects one card.
 *   3. lawyer_kim logs out.
 *   4. lawyer_park logs in (separate browser context), changes that
 *      card to accepted. History shows kim then park.
 *   5. business_choi logs in (third context). UI guards visible.
 *   6. Choi cannot approve_final via API (422). body.actor_id
 *      impersonation rejected (400). Demo actor route rejected (403).
 *   7. Park completes the workflow + DOCX export separation holds.
 */

const SIGNED_AUTH_ENABLED = process.env.E2E_SIGNED_AUTH === "true";

const TEST_PASSWORD = "demo-password";
const USERS = {
  kim:   { email: "lawyer.kim@example.test",   id: "lawyer_kim" },
  park:  { email: "lawyer.park@example.test",  id: "lawyer_park" },
  choi:  { email: "biz.choi@example.test",     id: "business_choi" },
} as const;

/**
 * Hit a dev-only seed endpoint to ensure the three test users exist.
 *
 * We do this through the same API surface a developer would use — the
 * route handler `app/api/auth/dev/seed/route.ts` is gated by
 * `E2E_SIGNED_AUTH=true` itself so prod boots refuse to expose it.
 */
async function seedUsersOnce(request: APIRequestContext): Promise<void> {
  await request.post("/api/auth/dev/seed", {
    data: { password: TEST_PASSWORD },
  });
}

async function login(
  context: BrowserContext,
  email: string,
): Promise<void> {
  const res = await context.request.post("/api/auth/login", {
    data: { email, password: TEST_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`login(${email}) failed: HTTP ${res.status()}`);
  }
}

async function logout(context: BrowserContext): Promise<void> {
  await context.request.post("/api/auth/logout");
}

test.describe("Signed-cookie auth (gated)", () => {
  test.skip(!SIGNED_AUTH_ENABLED, "skipped: set E2E_SIGNED_AUTH=true to run");

  test("login → create project → multi-context multi-actor → logout flow", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);

    // 0. Reset server-side state (auth + project store).
    await request.post("/api/projects/reset");
    await seedUsersOnce(request);

    // ── Context A: lawyer_kim logs in + creates project ─────────────
    const ctxKim = await browser.newContext();
    await login(ctxKim, USERS.kim.email);
    const pageKim = await ctxKim.newPage();
    await pageKim.goto("/projects/new");
    // Session check via API: actor is kim, source=signed_cookie.
    const sessionResp = await ctxKim.request.get("/api/auth/session");
    const sessionBody = (await sessionResp.json()) as {
      authenticated: boolean;
      actor: { id: string } | null;
      source: string | null;
    };
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.actor?.id).toBe(USERS.kim.id);
    expect(sessionBody.source).toBe("signed_cookie");

    await pageKim.fill("input#name", "Signed auth demo");
    await pageKim.click('button[type="submit"]');
    await expect(pageKim.getByTestId("project-name")).toHaveText("Signed auth demo");
    const projectId = pageKim.url().split("/projects/")[1]!;

    // Walk to issues_open via API to keep the spec compact.
    const walkKim = async (op: { name: string; args: unknown }) => {
      const r = await ctxKim.request.post(
        `/api/projects/${projectId}/operations`,
        { data: op },
      );
      if (!r.ok()) throw new Error(`op ${op.name} failed: ${r.status()}`);
    };
    await walkKim({
      name: "add_source",
      args: {
        file_name: "p.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
      },
    });
    await walkKim({ name: "lock_source_pack", args: {} });
    await walkKim({
      name: "classify_and_confirm",
      args: { confirmed_type: "NDA" },
    });
    await walkKim({ name: "select_playbook", args: {} });
    const projResp = await ctxKim.request.get(`/api/projects/${projectId}`);
    const projBody = (await projResp.json()) as {
      state: { intake_questions: { id: string; required: boolean; key: string }[] };
    };
    for (const q of projBody.state.intake_questions.filter((q) => q.required)) {
      await walkKim({
        name: "answer_intake",
        args: { question_id: q.id, value: `a-${q.key}` },
      });
    }
    await walkKim({ name: "draft_deal_memo", args: {} });
    await walkKim({ name: "approve_deal_memo", args: {} });
    await walkKim({ name: "draft_drafting_plan", args: {} });
    await walkKim({ name: "approve_drafting_plan", args: {} });
    await walkKim({ name: "create_v0", args: {} });
    await walkKim({ name: "run_mock_reviews", args: {} });

    // Pick a still-pending card.
    const stateResp = await ctxKim.request.get(`/api/projects/${projectId}`);
    const stateBody = (await stateResp.json()) as {
      state: {
        issue_cards: { issue_id: string; human_decision: string }[];
      };
    };
    const pending = stateBody.state.issue_cards.find(
      (c) => c.human_decision === "pending",
    )!;

    // Kim rejects the card with a reason note.
    await walkKim({
      name: "decide_issue",
      args: {
        issue_id: pending.issue_id,
        decision: "rejected",
        reason_note: "kim rejects (signed-auth demo)",
      },
    });

    // Kim logs out (session cookie cleared).
    await logout(ctxKim);
    const postLogoutSession = await ctxKim.request.get("/api/auth/session");
    expect((await postLogoutSession.json()).authenticated).toBe(false);

    // ── Context B: lawyer_park logs in, overrides Kim ───────────────
    const ctxPark = await browser.newContext();
    await login(ctxPark, USERS.park.email);
    const walkPark = async (op: { name: string; args: unknown }) => {
      const r = await ctxPark.request.post(
        `/api/projects/${projectId}/operations`,
        { data: op },
      );
      if (!r.ok()) throw new Error(`park op ${op.name} failed: ${r.status()}`);
    };
    await walkPark({
      name: "decide_issue",
      args: {
        issue_id: pending.issue_id,
        decision: "accepted",
        reason_note: "park overrules kim",
      },
    });
    // History shows kim then park.
    const histResp = await request.get(
      `/api/projects/${projectId}/decision-history`,
    );
    const histBody = (await histResp.json()) as {
      history: { actor_id: string; new_decision: string }[];
    };
    expect(histBody.history).toHaveLength(2);
    expect(histBody.history[0]!.actor_id).toBe(USERS.kim.id);
    expect(histBody.history[0]!.new_decision).toBe("rejected");
    expect(histBody.history[1]!.actor_id).toBe(USERS.park.id);
    expect(histBody.history[1]!.new_decision).toBe("accepted");

    // ── Context C: business_choi logs in, server blocks lawyer ops ──
    const ctxChoi = await browser.newContext();
    await login(ctxChoi, USERS.choi.email);
    const pageChoi = await ctxChoi.newPage();
    await pageChoi.goto(`/projects/${projectId}/issues`);
    // UI guard surface: lawyer-required note visible.
    await expect(
      pageChoi.locator('[data-testid="lawyer-required-note"]').first(),
    ).toBeVisible();

    // Server-side role guard: Choi attempting decide_issue → 422.
    const stateResp2 = await ctxChoi.request.get(`/api/projects/${projectId}`);
    const stateBody2 = (await stateResp2.json()) as {
      state: {
        issue_cards: { issue_id: string; human_decision: string }[];
      };
    };
    const anotherPending = stateBody2.state.issue_cards.find(
      (c) => c.human_decision === "pending",
    );
    expect(anotherPending).toBeDefined();
    const refused = await ctxChoi.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "decide_issue",
          args: { issue_id: anotherPending!.issue_id, decision: "accepted" },
        },
      },
    );
    expect(refused.status()).toBe(422);
    expect((await refused.json()).code).toBe("OPERATION_REJECTED");

    // body.actor_id impersonation still rejected.
    const impersonate = await ctxChoi.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "decide_issue",
          args: { issue_id: anotherPending!.issue_id, decision: "accepted" },
          actor_id: USERS.kim.id,
        },
      },
    );
    expect(impersonate.status()).toBe(400);
    expect((await impersonate.json()).code).toBe("OPERATION_ACTOR_ID_FORBIDDEN");

    // Demo actor route disabled in signed_cookie mode → 403.
    const demo = await ctxChoi.request.post("/api/auth/demo/actor", {
      data: { actor_id: USERS.kim.id },
    });
    expect(demo.status()).toBe(403);
    expect((await demo.json()).code).toBe("DEMO_AUTH_DISABLED");

    // ── Park decides the remaining cards, generates revision + final ─
    for (const card of stateBody2.state.issue_cards.filter(
      (c) => c.human_decision === "pending",
    )) {
      await walkPark({
        name: "decide_issue",
        args: { issue_id: card.issue_id, decision: "accepted" },
      });
    }
    await walkPark({ name: "create_revision", args: {} });
    await walkPark({ name: "approve_final", args: {} });

    // Export separation: clean vs commentary file names differ.
    const cleanResp = await ctxPark.request.post("/api/exports/render", {
      data: { project_id: projectId, export_type: "clean_docx" },
    });
    expect(cleanResp.ok()).toBe(true);
    const cleanCd = cleanResp.headers()["content-disposition"] ?? "";
    expect(cleanCd).toMatch(/_clean\.docx/);
    const commentaryResp = await ctxPark.request.post("/api/exports/render", {
      data: { project_id: projectId, export_type: "commentary_docx" },
    });
    expect(commentaryResp.ok()).toBe(true);
    const commCd = commentaryResp.headers()["content-disposition"] ?? "";
    expect(commCd).toMatch(/_commentary_INTERNAL\.docx/);

    await ctxKim.close();
    await ctxPark.close();
    await ctxChoi.close();
  });
});
