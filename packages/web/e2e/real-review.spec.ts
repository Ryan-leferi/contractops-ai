import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  answerAllRequiredIntakeQuestions,
  setDemoActorCookie,
  waitForStoreIdle,
} from "./helpers";

/**
 * GATED real-mode end-to-end test for the three review roles
 * (Milestone 4B):
 *
 *   - counterparty_reviewer       → Anthropic
 *   - source_consistency_reviewer → OpenAI
 *   - legal_style_reviewer        → OpenAI
 *
 * Runs ONLY when E2E_REAL_REVIEW=true. CI must not set this. The
 * Playwright `webServer` in `playwright.config.ts` must additionally
 * be started with all of:
 *
 *   USE_REAL_LLM=true
 *   LLM_PROVIDER_ALLOWLIST=openai,anthropic
 *   REAL_LLM_ROLE_ALLOWLIST=counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer
 *   OPENAI_API_KEY=sk-...
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   NEXT_PUBLIC_USE_REAL_LLM=true                       (optional UI hint)
 *   NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST=openai,anthropic (optional UI hint)
 *
 * Local run:
 *
 *   E2E_REAL_REVIEW=true \
 *     USE_REAL_LLM=true \
 *     LLM_PROVIDER_ALLOWLIST=openai,anthropic \
 *     REAL_LLM_ROLE_ALLOWLIST=counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer \
 *     OPENAI_API_KEY=sk-... \
 *     ANTHROPIC_API_KEY=sk-ant-... \
 *     npm run e2e -w @contractops/web -- real-review.spec.ts
 *
 * Walks:
 *   1. lawyer_kim creates project (auto owner_lawyer membership from 3L).
 *   2. Synthetic source pack → drafting_plan_approved → v0 (v0 is mock —
 *      contract_drafter is intentionally NOT on the role allowlist for
 *      this spec so the cost of v0 stays low; the test focuses on the
 *      three review roles).
 *   3. run_mock_reviews → three real reviewer calls in parallel.
 *   4. Inspect ProjectState: there must be exactly one completed
 *      AgentRun for each of the three review roles, each with mode=real
 *      and the correct provider_id (anthropic / openai / openai).
 *   5. Issue Cards must reference all three reviewers as source_agent
 *      (i.e. each reviewer actually produced findings — or at minimum
 *      its AgentRun ran successfully with status=completed).
 */

const ENABLED = process.env.E2E_REAL_REVIEW === "true";

// Sanitized fake source — IANA `example.test` org names + obviously
// invented amounts. NEVER use real client data here.
const SYNTHETIC_SOURCE_TEXT = [
  "TERM SHEET (synthetic test fixture — no real party data).",
  "",
  "Counterparty: Example Test Corp, Ltd. (example.test domain).",
  "Subject: Mutual non-disclosure for joint product evaluation.",
  "Term: 12 months, auto-renewing 12 months unless 30-day notice.",
  "Confidential info: written, oral, electronic forms.",
  "Carve-outs: independently developed; publicly known; lawfully obtained.",
  "Governing law: Republic of Korea. Forum: Seoul Central District Court.",
].join("\n");

async function walkAsKim(
  request: APIRequestContext,
  projectId: string,
  op: { name: string; args: unknown },
): Promise<void> {
  const r = await request.post(`/api/projects/${projectId}/operations`, { data: op });
  if (!r.ok()) {
    throw new Error(`op ${op.name} failed: HTTP ${r.status()} ${await r.text()}`);
  }
}

test.describe("Real review roles — counterparty + source_consistency + legal_style (gated)", () => {
  test.skip(!ENABLED, "skipped: set E2E_REAL_REVIEW=true to run");

  test("three review AgentRuns record mode=real with correct provider_id per role", async ({
    browser,
    request,
  }) => {
    // Three reviewer calls in parallel + everything else can total 60s+;
    // allow plenty of headroom.
    test.setTimeout(180_000);

    await request.post("/api/projects/reset");

    const ctxKim = await browser.newContext();
    await setDemoActorCookie(ctxKim, "lawyer_kim");
    const pageKim = await ctxKim.newPage();
    await pageKim.goto("/projects/new");
    await pageKim.fill("input#name", "Real review demo");
    await pageKim.click('button[type="submit"]');
    await expect(pageKim.getByTestId("project-name")).toHaveText("Real review demo");
    const projectId = pageKim.url().split("/projects/")[1]!;

    // 1. Sources — synthetic only.
    await pageKim.goto(`/projects/${projectId}/sources`);
    await waitForStoreIdle(pageKim);
    await pageKim.fill('[data-testid="source-file-name"]', "synthetic_term_sheet.pdf");
    await pageKim.locator('select#stype').selectOption("term_sheet");
    await pageKim.click('[data-testid="add-source-btn"]');
    await waitForStoreIdle(pageKim);
    const stateForSource = await ctxKim.request.get(`/api/projects/${projectId}`);
    const stateBodyForSource = (await stateForSource.json()) as {
      state: { source_documents: { id: string }[] };
    };
    const sourceDocId = stateBodyForSource.state.source_documents[0]!.id;
    await walkAsKim(ctxKim.request, projectId, {
      name: "add_source_content",
      args: {
        source_document_id: sourceDocId,
        text_content: SYNTHETIC_SOURCE_TEXT,
      },
    });
    await walkAsKim(ctxKim.request, projectId, { name: "lock_source_pack", args: {} });

    // 2. Classify + playbook + intake.
    await walkAsKim(ctxKim.request, projectId, {
      name: "classify_and_confirm",
      args: { confirmed_type: "NDA" },
    });
    await walkAsKim(ctxKim.request, projectId, { name: "select_playbook", args: {} });
    await pageKim.goto(`/projects/${projectId}/intake`);
    await answerAllRequiredIntakeQuestions(pageKim);

    // 3. Deal Memo + Drafting Plan.
    await walkAsKim(ctxKim.request, projectId, { name: "draft_deal_memo", args: {} });
    await walkAsKim(ctxKim.request, projectId, { name: "approve_deal_memo", args: {} });
    await walkAsKim(ctxKim.request, projectId, { name: "draft_drafting_plan", args: {} });
    await walkAsKim(ctxKim.request, projectId, { name: "approve_drafting_plan", args: {} });

    // 4. v0 — this one stays MOCK in this spec (contract_drafter is not
    // on the role allowlist for the real-review env). The test target
    // is the review roles only.
    await walkAsKim(ctxKim.request, projectId, { name: "create_v0", args: {} });

    // 5. Run reviews — this triggers all three real reviewers in
    // parallel via aggRunMockReviews.
    await walkAsKim(ctxKim.request, projectId, { name: "run_mock_reviews", args: {} });

    // 6. Inspect ProjectState — three review AgentRuns must exist with
    // the right provider per role.
    const afterReviewsRes = await ctxKim.request.get(`/api/projects/${projectId}`);
    const afterReviews = (await afterReviewsRes.json()) as {
      state: {
        agent_runs: {
          role: string;
          mode: string;
          provider_id: string;
          status: string;
        }[];
        issue_cards: { source_agent: string }[];
      };
    };

    const counterRun = afterReviews.state.agent_runs.find(
      (r) => r.role === "counterparty_reviewer" && r.status === "completed",
    );
    const sourceRun = afterReviews.state.agent_runs.find(
      (r) => r.role === "source_consistency_reviewer" && r.status === "completed",
    );
    const styleRun = afterReviews.state.agent_runs.find(
      (r) => r.role === "legal_style_reviewer" && r.status === "completed",
    );

    expect(counterRun, "counterparty_reviewer AgentRun missing").toBeDefined();
    expect(counterRun!.mode).toBe("real");
    expect(counterRun!.provider_id).toBe("anthropic");

    expect(sourceRun, "source_consistency_reviewer AgentRun missing").toBeDefined();
    expect(sourceRun!.mode).toBe("real");
    expect(sourceRun!.provider_id).toBe("openai");

    expect(styleRun, "legal_style_reviewer AgentRun missing").toBeDefined();
    expect(styleRun!.mode).toBe("real");
    expect(styleRun!.provider_id).toBe("openai");

    // 7. Issue Cards exist (real reviewers usually produce ≥1; we don't
    // require any specific count, only that the flow completed and the
    // source_agent values come from the reviewer set).
    const allowedAgents = new Set([
      "counterparty_reviewer",
      "source_consistency_reviewer",
      "legal_style_reviewer",
      // deterministic QA can also produce cards depending on env wiring
      // but is not run by run_mock_reviews — keep it as an allowed
      // value only if it appears.
      "deterministic_qa",
    ]);
    for (const card of afterReviews.state.issue_cards) {
      expect(allowedAgents.has(card.source_agent)).toBe(true);
    }

    await ctxKim.close();
  });
});
