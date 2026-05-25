import { expect, test, type APIRequestContext } from "@playwright/test";
import { setDemoActorCookie, waitForStoreIdle } from "./helpers";

/**
 * Project membership + minimal RBAC E2E (Milestone 3L).
 *
 * Three browser contexts, three different actors. Walks:
 *   1. lawyer_kim creates a project → auto owner_lawyer membership.
 *   2. kim adds lawyer_park as reviewer_lawyer.
 *   3. park (separate context) opens the project, decides one Issue Card.
 *   4. business_choi (no membership) cannot open the project — both
 *      the operations route and the project read route return 403.
 *   5. kim adds choi as business_contributor.
 *   6. choi (own context) can now open the project; can answer intake
 *      via API but approve_deal_memo is 403 PROJECT_PERMISSION_DENIED.
 *   7. choi cannot download commentary DOCX or negotiation matrix.
 *   8. clean vs commentary export separation still holds: clean for
 *      choi via export_clean would be permitted (we don't trigger a
 *      generate here to keep the test compact), commentary for choi
 *      is 403.
 *   9. body.actor_id spoofing is still rejected (3I invariant).
 */

async function listVisibleProjects(req: APIRequestContext): Promise<string[]> {
  const res = await req.get("/api/projects");
  if (!res.ok()) throw new Error(`GET /api/projects: ${res.status()}`);
  const body = (await res.json()) as { projects: { id: string; name: string }[] };
  return body.projects.map((p) => p.name);
}

test.describe("Project membership + minimal RBAC (Milestone 3L)", () => {
  test("owner → reviewer → contributor permission scenarios end-to-end", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    // 0. Reset.
    await request.post("/api/projects/reset");

    // ── 1. lawyer_kim creates project → auto owner_lawyer ──────────
    const ctxKim = await browser.newContext();
    await setDemoActorCookie(ctxKim, "lawyer_kim");
    const pageKim = await ctxKim.newPage();
    await pageKim.goto("/projects/new");
    await pageKim.fill("input#name", "RBAC E2E");
    await pageKim.click('button[type="submit"]');
    await expect(pageKim.getByTestId("project-name")).toHaveText("RBAC E2E");
    const projectId = pageKim.url().split("/projects/")[1]!;

    // Kim sees the project; the Members page shows owner_lawyer.
    await pageKim.goto(`/projects/${projectId}/members`);
    await waitForStoreIdle(pageKim);
    await expect(pageKim.getByTestId("my-project-role")).toHaveText("owner_lawyer");
    await expect(pageKim.getByTestId("manage-memberships-allowed")).toBeVisible();
    await expect(
      pageKim.getByTestId("membership-actor-lawyer_kim"),
    ).toBeVisible();

    // ── 2. kim grants park = reviewer_lawyer via the Members UI ────
    await pageKim
      .getByTestId("add-member-actor-select")
      .selectOption("lawyer_park");
    await pageKim
      .getByTestId("add-member-role-select")
      .selectOption("reviewer_lawyer");
    await pageKim.click('[data-testid="add-membership-btn"]');
    await expect(
      pageKim.getByTestId("membership-actor-lawyer_park"),
    ).toBeVisible();
    await expect(
      pageKim.getByTestId("membership-role-lawyer_park"),
    ).toHaveText("reviewer_lawyer");

    // Kim walks the workflow to issues_open so there are cards to decide.
    const walkKim = async (op: { name: string; args: unknown }) => {
      const r = await ctxKim.request.post(
        `/api/projects/${projectId}/operations`,
        { data: op },
      );
      if (!r.ok()) throw new Error(`kim op ${op.name}: ${r.status()}`);
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
    const stateRes = await ctxKim.request.get(`/api/projects/${projectId}`);
    const stateBody = (await stateRes.json()) as {
      state: { intake_questions: { id: string; required: boolean; key: string }[] };
    };
    for (const q of stateBody.state.intake_questions.filter((q) => q.required)) {
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

    // ── 3. park opens project, decides one pending card ────────────
    const ctxPark = await browser.newContext();
    await setDemoActorCookie(ctxPark, "lawyer_park");
    // Park sees the project in their list because they have membership.
    expect(await listVisibleProjects(ctxPark.request)).toContain("RBAC E2E");
    const parkState = await ctxPark.request.get(`/api/projects/${projectId}`);
    expect(parkState.status()).toBe(200);
    const parkStateBody = (await parkState.json()) as {
      state: { issue_cards: { issue_id: string; human_decision: string }[] };
    };
    const pendingForPark = parkStateBody.state.issue_cards.find(
      (c) => c.human_decision === "pending",
    )!;
    expect(pendingForPark).toBeDefined();
    const parkDecide = await ctxPark.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "decide_issue",
          args: {
            issue_id: pendingForPark.issue_id,
            decision: "accepted",
            reason_note: "park (reviewer) decides",
          },
        },
      },
    );
    expect(parkDecide.status()).toBe(200);

    // Reviewer cannot approve_final (owner_lawyer only).
    const parkApprove = await ctxPark.request.post(
      `/api/projects/${projectId}/operations`,
      { data: { name: "approve_final", args: {} } },
    );
    expect(parkApprove.status()).toBe(403);
    expect((await parkApprove.json()).code).toBe("PROJECT_PERMISSION_DENIED");

    // ── 4. business_choi (no membership) cannot open the project ───
    const ctxChoi = await browser.newContext();
    await setDemoActorCookie(ctxChoi, "business_choi");
    expect(await listVisibleProjects(ctxChoi.request)).not.toContain("RBAC E2E");
    const choiReadDenied = await ctxChoi.request.get(
      `/api/projects/${projectId}`,
    );
    expect(choiReadDenied.status()).toBe(403);
    expect((await choiReadDenied.json()).code).toBe("PROJECT_ACCESS_DENIED");

    // ── 5. kim adds choi as business_contributor ───────────────────
    const grantChoi = await ctxKim.request.post(
      `/api/projects/${projectId}/memberships`,
      {
        data: {
          actor_id: "business_choi",
          project_role: "business_contributor",
        },
      },
    );
    expect(grantChoi.status()).toBe(201);

    // ── 6. choi can now view; answer_intake permission, but
    //       approve_deal_memo is denied by the matrix.
    expect(await listVisibleProjects(ctxChoi.request)).toContain("RBAC E2E");
    const choiRead = await ctxChoi.request.get(`/api/projects/${projectId}`);
    expect(choiRead.status()).toBe(200);

    // Choi attempting approve_deal_memo → 403 PROJECT_PERMISSION_DENIED.
    const choiApprove = await ctxChoi.request.post(
      `/api/projects/${projectId}/operations`,
      { data: { name: "approve_deal_memo", args: {} } },
    );
    expect(choiApprove.status()).toBe(403);
    expect((await choiApprove.json()).code).toBe("PROJECT_PERMISSION_DENIED");

    // Choi attempting decide_issue → also 403 PROJECT_PERMISSION_DENIED.
    const stateRes2 = await ctxKim.request.get(`/api/projects/${projectId}`);
    const stateBody2 = (await stateRes2.json()) as {
      state: { issue_cards: { issue_id: string; human_decision: string }[] };
    };
    const stillPending = stateBody2.state.issue_cards.find(
      (c) => c.human_decision === "pending",
    );
    if (stillPending) {
      const choiDecide = await ctxChoi.request.post(
        `/api/projects/${projectId}/operations`,
        {
          data: {
            name: "decide_issue",
            args: { issue_id: stillPending.issue_id, decision: "accepted" },
          },
        },
      );
      expect(choiDecide.status()).toBe(403);
      expect((await choiDecide.json()).code).toBe("PROJECT_PERMISSION_DENIED");
    }

    // Kim accepts every remaining pending card so a revision can run.
    const stateRes3 = await ctxKim.request.get(`/api/projects/${projectId}`);
    const stateBody3 = (await stateRes3.json()) as {
      state: { issue_cards: { issue_id: string; human_decision: string }[] };
    };
    for (const c of stateBody3.state.issue_cards.filter(
      (c) => c.human_decision === "pending",
    )) {
      await walkKim({
        name: "decide_issue",
        args: { issue_id: c.issue_id, decision: "accepted" },
      });
    }
    await walkKim({ name: "create_revision", args: {} });
    await walkKim({ name: "approve_final", args: {} });

    // ── 7. choi cannot download commentary DOCX or negotiation_matrix
    // We use the project state returned to choi as the renderer input
    // (per 3A/3B contract). The 403 comes from the export type's
    // permission, not the input shape.
    const choiStateRes = await ctxChoi.request.get(
      `/api/projects/${projectId}`,
    );
    const choiState = ((await choiStateRes.json()) as { state: unknown }).state;
    const choiCommentary = await ctxChoi.request.post(
      "/api/exports/render",
      {
        data: { export_type: "commentary_docx", project_state: choiState },
      },
    );
    expect(choiCommentary.status()).toBe(403);
    expect((await choiCommentary.json()).code).toBe(
      "PROJECT_PERMISSION_DENIED",
    );
    const choiNeg = await ctxChoi.request.post("/api/exports/render", {
      data: { export_type: "negotiation_matrix", project_state: choiState },
    });
    expect(choiNeg.status()).toBe(403);
    expect((await choiNeg.json()).code).toBe("PROJECT_PERMISSION_DENIED");

    // ── 8. clean export remains allowed (matrix grants export_clean
    //       to every project member) — sanity, status not 403.
    const choiClean = await ctxChoi.request.post("/api/exports/render", {
      data: { export_type: "clean_docx", project_state: choiState },
    });
    expect(choiClean.status()).not.toBe(403);

    // ── 9. body.actor_id spoofing still rejected (3I invariant) ────
    const spoof = await ctxChoi.request.post(
      `/api/projects/${projectId}/operations`,
      {
        data: {
          name: "answer_intake",
          args: { question_id: "x", value: "y" },
          actor_id: "lawyer_kim",
        },
      },
    );
    expect(spoof.status()).toBe(400);
    expect((await spoof.json()).code).toBe("OPERATION_ACTOR_ID_FORBIDDEN");

    await ctxKim.close();
    await ctxPark.close();
    await ctxChoi.close();
  });
});
