import { expect, test, type APIRequestContext } from "@playwright/test";
import { answerAllRequiredIntakeQuestions, waitForStoreIdle } from "./helpers";

/**
 * Pilot P1 — Solo Drafting Loop end-to-end (mock-mode).
 *
 * Walks the lawyer through the entire loop on the /draft-loop page:
 *   1. Create project
 *   2. Add synthetic source content + lock pack
 *   3. Confirm contract type + select playbook + answer intake (via API)
 *   4. Approve deal memo + drafting plan (via API)
 *   5. Open /projects/[id]/draft-loop
 *   6. Start iteration 1
 *   7. Generate initial draft (contract_drafter, mock)
 *   8. Run review round (mock — produces 0 cards from default canned)
 *   9. Manually decide some pending issue cards
 *  10. Synthesize revision prompt (review_synthesizer, mock)
 *  11. Batch-accept all non-critical
 *  12. Generate revised draft
 *  13. Verify a new ContractVersion exists
 *  14. Stop the loop
 *  15. Approve final + download clean DOCX from /exports
 *
 * Mock-only: no real network calls. The `nda-happy-path.spec.ts` covers
 * the full UI-driven flow; this spec exercises only the loop-specific
 * surface so it stays fast.
 */

const SYNTHETIC_SOURCE_TEXT = [
  "TERM SHEET (synthetic test fixture — no real party data).",
  "",
  "Counterparty: Example Test Corp, Ltd. (example.test domain).",
  "Subject: Mutual non-disclosure for joint product evaluation.",
  "Term: 12 months, auto-renewing 12 months unless 30-day notice.",
  "Governing law: Republic of Korea.",
].join("\n");

async function walk(
  request: APIRequestContext,
  projectId: string,
  op: { name: string; args: unknown },
): Promise<void> {
  const r = await request.post(`/api/projects/${projectId}/operations`, { data: op });
  if (!r.ok()) {
    throw new Error(`op ${op.name} failed: HTTP ${r.status()} ${await r.text()}`);
  }
}

async function getState(
  request: APIRequestContext,
  projectId: string,
): Promise<{
  contract_versions: { id: string; version_number: string; final: boolean }[];
  issue_cards: {
    issue_id: string;
    severity: string;
    human_decision: string;
  }[];
  draft_iterations: {
    id: string;
    iteration_number: number;
    status: string;
    synthesis_agent_run_id: string | null;
  }[];
  agent_runs: { role: string; mode: string; provider_id: string; status: string }[];
  decision_history: { issue_id: string; to_decision: string }[];
}> {
  const r = await request.get(`/api/projects/${projectId}`);
  const body = (await r.json()) as { state: unknown };
  return body.state as ReturnType<typeof Object> as never;
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/projects/reset");
  await page.goto("/projects");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("Solo Drafting Loop — mock end-to-end (P1)", async ({ page, request }) => {
  test.setTimeout(120_000);

  // 1. Create project
  await page.goto("/projects/new");
  await page.fill("input#name", "E2E draft loop project");
  await page.click('button[type="submit"]');
  await expect(page.getByTestId("project-name")).toHaveText("E2E draft loop project");
  const projectId = page.url().split("/projects/")[1]!;

  // 2. Sources — add one + attach synthetic text + lock pack
  await page.goto(`/projects/${projectId}/sources`);
  await waitForStoreIdle(page);
  await page.fill('[data-testid="source-file-name"]', "synthetic_nda.pdf");
  await page.locator("select#stype").selectOption("term_sheet");
  await page.click('[data-testid="add-source-btn"]');
  await waitForStoreIdle(page);
  const stateForSource = await getState(request, projectId);
  // Add content via API for brevity (the UI version is already covered in nda-happy-path).
  const firstSourceId = (
    stateForSource as unknown as { source_documents: { id: string }[] }
  ).source_documents[0]!.id;
  await walk(request, projectId, {
    name: "add_source_content",
    args: {
      source_document_id: firstSourceId,
      text_content: SYNTHETIC_SOURCE_TEXT,
    },
  });
  await walk(request, projectId, { name: "lock_source_pack", args: {} });

  // 3. Classify + playbook + intake
  await walk(request, projectId, {
    name: "classify_and_confirm",
    args: { confirmed_type: "NDA" },
  });
  await walk(request, projectId, { name: "select_playbook", args: {} });
  await page.goto(`/projects/${projectId}/intake`);
  await answerAllRequiredIntakeQuestions(page);

  // 4. Deal memo + drafting plan (approved via API to keep the spec short).
  await walk(request, projectId, { name: "draft_deal_memo", args: {} });
  await walk(request, projectId, { name: "approve_deal_memo", args: {} });
  await walk(request, projectId, { name: "draft_drafting_plan", args: {} });
  await walk(request, projectId, { name: "approve_drafting_plan", args: {} });

  // 5. Open /draft-loop
  await page.goto(`/projects/${projectId}/draft-loop`);
  await expect(page.getByTestId("draft-loop-page")).toBeVisible();

  // 6. Source summary visible; warning hidden (we attached content).
  await expect(page.getByTestId("warning-missing-source")).toHaveCount(0);

  // 7. Start iteration 1
  await page.click('[data-testid="btn-create-iteration"]');
  await expect(page.getByTestId("active-iteration-label")).toContainText("Active iteration: #1");
  let s = await getState(request, projectId);
  expect(s.draft_iterations).toHaveLength(1);
  expect(s.draft_iterations[0]!.iteration_number).toBe(1);

  // 8. Generate initial draft (mock contract_drafter)
  await page.click('[data-testid="btn-create-v0"]');
  await waitForStoreIdle(page);
  s = await getState(request, projectId);
  expect(s.contract_versions.length).toBeGreaterThanOrEqual(1);
  const v0Run = s.agent_runs.find((r) => r.role === "contract_drafter");
  expect(v0Run).toBeDefined();
  expect(v0Run!.mode).toBe("mock");

  // 9. Run review round (mock canned reviewer responses come from
  // buildPlaybookCannedResponses + NDA playbook risks/red_flags).
  await page.click('[data-testid="btn-run-reviews"]');
  await waitForStoreIdle(page);
  s = await getState(request, projectId);
  expect(s.issue_cards.length).toBeGreaterThanOrEqual(1);
  // The 3 reviewer roles produced AgentRuns.
  expect(s.agent_runs.filter((r) => r.role === "counterparty_reviewer").length).toBeGreaterThanOrEqual(1);
  expect(s.agent_runs.filter((r) => r.role === "source_consistency_reviewer").length).toBeGreaterThanOrEqual(1);
  expect(s.agent_runs.filter((r) => r.role === "legal_style_reviewer").length).toBeGreaterThanOrEqual(1);

  // 10. Synthesize revision prompt (review_synthesizer, mock)
  await page.click('[data-testid="btn-synthesize"]');
  await waitForStoreIdle(page);
  s = await getState(request, projectId);
  const it1 = s.draft_iterations[0]!;
  expect(it1.status).toBe("synthesized");
  expect(it1.synthesis_agent_run_id).not.toBeNull();
  const synthRun = s.agent_runs.find((r) => r.id === it1.synthesis_agent_run_id);
  expect(synthRun).toBeDefined();
  expect(synthRun!.role).toBe("review_synthesizer");
  expect(synthRun!.mode).toBe("mock");
  // Comparison panel now shows iteration 1.
  await expect(page.getByTestId("iteration-row-1")).toBeVisible();

  // 11. Capture a "to be rejected" card BEFORE batch accept so we can
  // verify it is NOT applied to the revision later.
  const cardsBeforeReject = s.issue_cards.filter(
    (c) => c.human_decision === "pending" && c.severity !== "critical",
  );
  expect(cardsBeforeReject.length).toBeGreaterThanOrEqual(2);
  const rejectId = cardsBeforeReject[0]!.issue_id;
  await walk(request, projectId, {
    name: "decide_issue",
    args: { issue_id: rejectId, decision: "rejected", reason_note: "drafted loop rejection" },
  });

  // Reload the page so the React tree picks up the updated state.
  await page.reload();
  await waitForStoreIdle(page);

  // 12. Decide any critical pending cards individually first (batch accept
  // refuses them). We accept them so the revision can run later.
  s = await getState(request, projectId);
  for (const card of s.issue_cards) {
    if (card.human_decision === "pending" && card.severity === "critical") {
      await walk(request, projectId, {
        name: "decide_issue",
        args: { issue_id: card.issue_id, decision: "accepted", reason_note: "critical accept" },
      });
    }
  }
  await page.reload();
  await waitForStoreIdle(page);

  // 13. Batch accept all remaining non-critical pending.
  s = await getState(request, projectId);
  const remainingNonCritical = s.issue_cards.filter(
    (c) => c.human_decision === "pending" && c.severity !== "critical",
  );
  if (remainingNonCritical.length > 0) {
    await page.click('[data-testid="btn-batch-accept"]');
    await waitForStoreIdle(page);
  }
  s = await getState(request, projectId);
  // Every accepted card has a decision_history entry; the rejected one
  // we created earlier also has its own entry — total ≥ number of
  // pending cards we touched.
  expect(s.decision_history.length).toBeGreaterThanOrEqual(remainingNonCritical.length);
  // The rejected card stayed rejected (not silently overwritten).
  expect(
    s.issue_cards.find((c) => c.issue_id === rejectId)!.human_decision,
  ).toBe("rejected");

  // 14. Generate revised draft (revision_agent, mock). All Issue Cards
  // are now decided so the "decide remaining first" guard is satisfied.
  s = await getState(request, projectId);
  expect(s.issue_cards.every((c) => c.human_decision !== "pending")).toBe(true);
  await page.click('[data-testid="btn-revise"]');
  await waitForStoreIdle(page);
  s = await getState(request, projectId);
  expect(s.contract_versions.length).toBeGreaterThanOrEqual(2);
  const revised = s.contract_versions[s.contract_versions.length - 1]!;
  // The rejected card id MUST NOT appear in the revision body.
  expect(JSON.stringify(revised)).not.toContain(rejectId);

  // 15. Stop the loop.
  await page.click('[data-testid="btn-stop-loop"]');
  await waitForStoreIdle(page);
  s = await getState(request, projectId);
  expect(s.draft_iterations[0]!.status).toBe("stopped");

  // 16. Final approve + clean DOCX export from /exports page (proves the
  // existing export path still works on top of the loop output).
  await walk(request, projectId, { name: "approve_final", args: {} });
  await page.goto(`/projects/${projectId}/exports`);
  await expect(page.getByTestId("export-card-clean_docx")).toBeVisible();
  const cleanDownload = page.waitForEvent("download");
  await page.click('[data-testid="create-export-clean_docx-btn"]');
  const dl = await cleanDownload;
  expect(dl.suggestedFilename()).toMatch(/_clean\.docx$/);
});
