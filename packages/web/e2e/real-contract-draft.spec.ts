import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  answerAllRequiredIntakeQuestions,
  setDemoActorCookie,
  waitForStoreIdle,
} from "./helpers";

/**
 * GATED real-mode end-to-end test for contract_drafter + revision_agent
 * (Milestone 4A).
 *
 * Runs ONLY when E2E_REAL_CONTRACT_DRAFT=true. CI must not set this.
 * The Playwright `webServer` in `playwright.config.ts` must additionally
 * be started with all of:
 *
 *   USE_REAL_LLM=true
 *   LLM_PROVIDER_ALLOWLIST=openai
 *   REAL_LLM_ROLE_ALLOWLIST=contract_drafter,revision_agent
 *   OPENAI_API_KEY=sk-...
 *   NEXT_PUBLIC_USE_REAL_LLM=true              (optional UI hint)
 *   NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST=openai  (optional UI hint)
 *
 * Local run:
 *
 *   E2E_REAL_CONTRACT_DRAFT=true \
 *     USE_REAL_LLM=true \
 *     LLM_PROVIDER_ALLOWLIST=openai \
 *     REAL_LLM_ROLE_ALLOWLIST=contract_drafter,revision_agent \
 *     OPENAI_API_KEY=sk-... \
 *     npm run e2e -w @contractops/web -- real-contract-draft.spec.ts
 *
 * Walks:
 *   1. lawyer_kim creates project (auto owner_lawyer membership from 3L).
 *   2. Walk to drafting_plan_approved using only synthetic source text.
 *   3. Generate v0 → real OpenAI provider.
 *   4. Inspect ProjectState: AgentRun for the v0 must have
 *      mode=real + provider_id=openai + role=contract_drafter, and
 *      contract_versions[0].content is non-empty.
 *   5. Decide one Issue Card as accepted, one as rejected (mix).
 *   6. Generate revision → real OpenAI provider.
 *   7. Inspect: revision AgentRun mode=real + role=revision_agent.
 *      The new revised contract content MUST NOT echo the rejected
 *      card's recommended_revision verbatim.
 */

const ENABLED = process.env.E2E_REAL_CONTRACT_DRAFT === "true";

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

test.describe("Real contract_drafter + revision_agent (gated)", () => {
  test.skip(!ENABLED, "skipped: set E2E_REAL_CONTRACT_DRAFT=true to run");

  test("real v0 + revision flow records AgentRun mode=real and excludes rejected cards", async ({
    browser,
    request,
  }) => {
    // Real OpenAI calls take a few seconds each; v0 + revision + reviews
    // can easily total > 60s. Be generous.
    test.setTimeout(180_000);

    await request.post("/api/projects/reset");

    const ctxKim = await browser.newContext();
    await setDemoActorCookie(ctxKim, "lawyer_kim");
    const pageKim = await ctxKim.newPage();
    await pageKim.goto("/projects/new");
    await pageKim.fill("input#name", "Real draft demo");
    await pageKim.click('button[type="submit"]');
    await expect(pageKim.getByTestId("project-name")).toHaveText("Real draft demo");
    const projectId = pageKim.url().split("/projects/")[1]!;

    // 1. Sources — synthetic only.
    await pageKim.goto(`/projects/${projectId}/sources`);
    await waitForStoreIdle(pageKim);
    await pageKim.fill('[data-testid="source-file-name"]', "synthetic_term_sheet.pdf");
    await pageKim.locator('select#stype').selectOption("term_sheet");
    await pageKim.click('[data-testid="add-source-btn"]');
    await waitForStoreIdle(pageKim);
    // Add synthetic content for the just-added source.
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
    await walkAsKim(ctxKim.request, projectId, {
      name: "lock_source_pack",
      args: {},
    });

    // 2. Confirm contract type + select playbook + intake (UI for
    // intake; API for the others — same as other specs).
    await walkAsKim(ctxKim.request, projectId, {
      name: "classify_and_confirm",
      args: { confirmed_type: "NDA" },
    });
    await walkAsKim(ctxKim.request, projectId, { name: "select_playbook", args: {} });
    await pageKim.goto(`/projects/${projectId}/intake`);
    await answerAllRequiredIntakeQuestions(pageKim);

    // 3. Deal Memo + Drafting Plan via API (these may also hit real
    // OpenAI in the deal-memo case; that's the 2C behavior — fine).
    await walkAsKim(ctxKim.request, projectId, { name: "draft_deal_memo", args: {} });
    await walkAsKim(ctxKim.request, projectId, { name: "approve_deal_memo", args: {} });
    await walkAsKim(ctxKim.request, projectId, { name: "draft_drafting_plan", args: {} });
    await walkAsKim(ctxKim.request, projectId, { name: "approve_drafting_plan", args: {} });

    // 4. Generate v0 — this goes through real contract_drafter.
    await walkAsKim(ctxKim.request, projectId, { name: "create_v0", args: {} });

    // 5. Inspect v0 + its AgentRun.
    const afterV0Res = await ctxKim.request.get(`/api/projects/${projectId}`);
    const afterV0 = (await afterV0Res.json()) as {
      state: {
        contract_versions: { id: string; content: string; final: boolean }[];
        agent_runs: { role: string; mode: string; provider_id: string; status: string }[];
      };
    };
    expect(afterV0.state.contract_versions.length).toBeGreaterThanOrEqual(1);
    const v0 = afterV0.state.contract_versions[0]!;
    expect(v0.content.length).toBeGreaterThan(200); // contract body, not empty
    expect(v0.content).toMatch(/제\s?\d+\s?조|Article\s?\d+/i); // looks like a contract

    const v0Run = afterV0.state.agent_runs.find(
      (r) => r.role === "contract_drafter" && r.status === "completed",
    );
    expect(v0Run).toBeDefined();
    expect(v0Run!.mode).toBe("real");
    expect(v0Run!.provider_id).toBe("openai");

    // 6. Reviews + mixed decisions.
    await walkAsKim(ctxKim.request, projectId, { name: "run_mock_reviews", args: {} });
    const afterReviewsRes = await ctxKim.request.get(`/api/projects/${projectId}`);
    const afterReviews = (await afterReviewsRes.json()) as {
      state: {
        issue_cards: {
          issue_id: string;
          human_decision: string;
          recommended_revision: string;
        }[];
      };
    };
    expect(afterReviews.state.issue_cards.length).toBeGreaterThanOrEqual(2);
    const pending = afterReviews.state.issue_cards.filter(
      (c) => c.human_decision === "pending",
    );
    expect(pending.length).toBeGreaterThanOrEqual(2);
    // Accept first, reject second. Capture the rejected card's
    // recommended_revision text so we can verify it's NOT in the
    // revision output.
    const accepted = pending[0]!;
    const rejected = pending[1]!;
    await walkAsKim(ctxKim.request, projectId, {
      name: "decide_issue",
      args: {
        issue_id: accepted.issue_id,
        decision: "accepted",
        reason_note: "kim accepts",
      },
    });
    await walkAsKim(ctxKim.request, projectId, {
      name: "decide_issue",
      args: {
        issue_id: rejected.issue_id,
        decision: "rejected",
        reason_note: "kim rejects — this clause is unacceptable",
      },
    });
    // Decide every remaining pending so revision can run.
    for (let i = 2; i < pending.length; i++) {
      await walkAsKim(ctxKim.request, projectId, {
        name: "decide_issue",
        args: { issue_id: pending[i]!.issue_id, decision: "accepted" },
      });
    }

    // 7. Generate revision — real revision_agent.
    await walkAsKim(ctxKim.request, projectId, { name: "create_revision", args: {} });

    const afterRevisionRes = await ctxKim.request.get(`/api/projects/${projectId}`);
    const afterRevision = (await afterRevisionRes.json()) as {
      state: {
        contract_versions: { id: string; content: string; version_number: string }[];
        agent_runs: { role: string; mode: string; provider_id: string; status: string }[];
      };
    };
    expect(afterRevision.state.contract_versions.length).toBeGreaterThan(
      afterV0.state.contract_versions.length,
    );
    const revision =
      afterRevision.state.contract_versions[
        afterRevision.state.contract_versions.length - 1
      ]!;
    expect(revision.content.length).toBeGreaterThan(200);

    const revRun = afterRevision.state.agent_runs.find(
      (r) => r.role === "revision_agent" && r.status === "completed",
    );
    expect(revRun).toBeDefined();
    expect(revRun!.mode).toBe("real");
    expect(revRun!.provider_id).toBe("openai");

    // 8. Rejected card's recommended_revision verbatim text must NOT
    // appear in the revision content. (Heuristic — real LLM might
    // paraphrase, so we check for a substantial substring match,
    // not exact equality.)
    if (rejected.recommended_revision.length > 50) {
      const probe = rejected.recommended_revision.slice(0, 50);
      expect(revision.content).not.toContain(probe);
    }

    await ctxKim.close();
  });
});
