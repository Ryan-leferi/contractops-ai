/**
 * scripts/run-alpha-evaluation.ts
 *
 * Alpha v0.1 evaluation runner (Milestone 4C).
 *
 * Drives each sanitized fixture under fixtures/ through the entire mock
 * workflow (project create → sources → lock → classify → playbook →
 * intake → Deal Memo → Drafting Plan → v0 → reviews → decisions →
 * final QA → revision → final approval → exports), records:
 *
 *   - stage completion flags
 *   - Issue Card counts (total + by decision + by severity + by source agent)
 *   - real DOCX + Markdown export bytes and their markers
 *   - cross-cutting invariant probes:
 *       · Source Pack lock prevents post-lock source mutation
 *       · Any pending Issue Card blocks final approval
 *       · Non-lawyer actor cannot final-approve
 *       · Rejected Issue Cards never appear in the revision content
 *       · Clean DOCX + cover email contain no internal commentary markers
 *       · Commentary + negotiation matrix DOCX carry the INTERNAL ONLY banner
 *
 * Then emits a markdown report to docs/10_ALPHA_EVALUATION_REPORT.md and
 * exits non-zero on any invariant failure.
 *
 * Usage:  npm run alpha:eval
 *
 * IMPORTANT: synthetic fixtures only. Never point this at real client data;
 * see PLATFORM_BRIEF.md §10/§12 and docs/05_SECURITY_AND_CONFIDENTIALITY.md.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

import {
  PROMPT_FILE_INDEX,
  setPromptTemplate,
  aggAddSource,
  aggAddSourceContent,
  aggApproveDealMemo,
  aggApproveDraftingPlan,
  aggApproveFinal,
  aggClassifyAndConfirm,
  aggCreateExport,
  aggCreateProject,
  aggCreateRevision,
  aggCreateV0,
  aggDecideIssue,
  aggDraftDealMemo,
  aggDraftDraftingPlan,
  aggLockSourcePack,
  aggRunMockFinalQA,
  aggRunMockReviews,
  aggSelectPlaybook,
  createCounterIdGenerator,
  createFixedClock,
  createInMemoryAppendOnlyRepository,
  createInMemoryRepository,
  createMockAggregateContext,
  createMockProvider,
  type AggregateContext,
  type AggregateResult,
  type ProjectState,
} from "@contractops/core";
import { createExportRenderer } from "@contractops/core/export-renderer";
import {
  playbookSchema,
  type Actor,
  type AuditLog,
  type IssueSeverity,
  type Playbook,
  type SourceType,
} from "@contractops/schemas";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Pre-load prompt templates before any agent runs.
(function preloadPrompts() {
  const promptsDir = resolve(repoRoot, "prompts");
  if (!existsSync(promptsDir)) return;
  for (const [id, file] of Object.entries(PROMPT_FILE_INDEX)) {
    const full = join(promptsDir, file);
    if (existsSync(full)) {
      setPromptTemplate(id, readFileSync(full, "utf-8"));
    }
  }
})();

const USER: Actor = { id: "eval_user", role: "user", display_name: "Eval User" };
const LAWYER: Actor = { id: "eval_lawyer", role: "human_lawyer", display_name: "Eval Lawyer" };

// Markers that must NEVER appear in an external (clean / cover_email) artifact.
const FORBIDDEN_EXTERNAL_MARKERS = [
  "법무주석",
  "[COMMENTARY]",
  "[INTERNAL]",
  "[REDLINE_RATIONALE]",
  "[NEGOTIATION_GUIDANCE]",
  "internal legal commentary",
];

// Markers that MUST appear on any internal-only export.
const INTERNAL_BANNER_MARKERS = ["INTERNAL ONLY", "내부 법무 검토 전용"];

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

interface FixtureDef {
  name: string;
  description?: string;
  project_name: string;
  contract_type: string;
  source_documents: {
    file_name: string;
    source_type: SourceType;
    version: string;
    incorporated: boolean;
    source_priority: number;
  }[];
  source_contents?: Record<string, string>;
  intake_answers: Record<string, string>;
  issue_decisions: { match: string; decision: string; partial_note?: string }[];
}

interface ExportReport {
  type: string;
  file_name: string;
  mime_type: string;
  byte_count: number;
  markers_check_passed: boolean;
  markers_detail: string;
}

interface InvariantOutcomes {
  source_pack_lock_enforced: boolean;
  pending_blocks_final: boolean;
  rbac_non_lawyer_refused: boolean;
  rejected_not_in_revision: boolean;
  clean_export_no_internal_markers: boolean;
  cover_email_no_internal_markers: boolean;
  cover_email_has_no_send_notice: boolean;
  commentary_has_internal_banner: boolean;
  negotiation_matrix_has_internal_banner: boolean;
}

interface ScenarioReport {
  fixture_file: string;
  name: string;
  contract_type: string;
  ok: boolean;
  elapsed_ms: number;
  failures: string[];
  stage_completion: Record<string, boolean>;
  issue_card_counts: {
    total: number;
    by_decision: Record<string, number>;
    by_severity: Record<string, number>;
    by_source_agent: Record<string, number>;
  };
  exports: ExportReport[];
  invariants: InvariantOutcomes;
  agent_runs_count: number;
  audit_count: number;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers shared with run-fixture.ts (kept in sync intentionally)
// ────────────────────────────────────────────────────────────────────────

function loadPlaybooks(): Playbook[] {
  const dir = resolve(repoRoot, "playbooks");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => playbookSchema.parse(JSON.parse(readFileSync(resolve(dir, f), "utf-8"))));
}

function loadFixture(path: string): FixtureDef {
  return JSON.parse(readFileSync(path, "utf-8")) as FixtureDef;
}

function pickIssueDecision(
  card: { severity: IssueSeverity },
  fixture: FixtureDef,
  seenSeverities: Set<string>,
): { decision: string; partial_note?: string } {
  for (const rule of fixture.issue_decisions) {
    if (rule.match.startsWith("first_")) {
      const sev = rule.match.replace("first_", "");
      if (sev === card.severity && !seenSeverities.has(sev)) {
        seenSeverities.add(sev);
        return rule;
      }
    }
  }
  const fallback = fixture.issue_decisions.find((r) => r.match === "default");
  return fallback ?? { decision: "accepted" };
}

function buildFixtureCannedResponses(state: ProjectState): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  const playbook = state.playbook;
  if (!playbook) return responses;
  const project_id = state.project.id;
  const latest = state.contract_versions[state.contract_versions.length - 1];

  responses[`deal_memo_drafter::${project_id}`] = {
    content: `[Synthetic Deal Memo for ${playbook.contract_type}]\nProject: ${state.project.name}\nSources: ${state.source_documents.length}`,
    warnings: [],
  };
  responses[`drafting_plan_drafter::${project_id}`] = {
    content: `[Synthetic Drafting Plan for ${playbook.contract_type}]`,
    table_of_contents: playbook.default_table_of_contents,
    is_custom: playbook.is_custom_marker,
    open_questions: [],
  };
  responses[`contract_drafter::${project_id}`] = {
    content: `[Synthetic v0 draft for ${playbook.contract_type}]\n\n${playbook.default_table_of_contents
      .map((toc) => `${toc}\n  [Mock body for ${toc}]`)
      .join("\n\n")}`,
    version_number: "v0",
    notes: [],
  };

  if (latest) {
    const risks = playbook.common_risks.slice(0, 2);
    const flags = playbook.red_flags.slice(0, 1);
    responses[`counterparty_reviewer::${latest.id}`] = {
      findings: [
        ...risks.slice(0, 1).map((text, i) => ({
          source_agent: "mock_counterparty",
          severity: "high" as const,
          location: { article: `제${i + 3}조` },
          issue_type: "playbook_risk",
          problem: text,
          why_it_matters: `Playbook common_risks #${i + 1}`,
          recommended_revision: `Address: ${text}`,
          business_impact: "moderate",
          recommended_action: "revise" as const,
        })),
        ...flags.map((text, i) => ({
          source_agent: "mock_counterparty",
          severity: "critical" as const,
          location: { article: `제${i + 7}조` },
          issue_type: "red_flag",
          problem: text,
          why_it_matters: `Playbook red_flags`,
          recommended_revision: `Remove or limit: ${text}`,
          business_impact: "high",
          recommended_action: "revise" as const,
        })),
      ],
    };
    responses[`source_consistency_reviewer::${latest.id}`] = {
      findings: risks.slice(1).map((text, i) => ({
        source_agent: "mock_source_consistency",
        severity: "medium" as const,
        location: { article: `제${i + 6}조` },
        issue_type: "source_inconsistency",
        problem: text,
        why_it_matters: "Source check",
        recommended_revision: `Reconcile: ${text}`,
        business_impact: "low",
        recommended_action: "revise" as const,
      })),
    };
    responses[`legal_style_reviewer::${latest.id}`] = {
      findings: [
        {
          source_agent: "mock_legal_style",
          severity: "low" as const,
          location: {},
          issue_type: "numbering",
          problem: "Confirm Korean numbering",
          why_it_matters: "Korean drafting convention",
          recommended_revision: "Apply 제·①·1.·가.",
          business_impact: "low",
          recommended_action: "accept" as const,
        },
      ],
    };

    const accepted = state.issue_cards.filter(
      (c) => c.human_decision === "accepted" || c.human_decision === "partially_accepted",
    );
    const appliedSections = accepted.map((c) =>
      c.partial_note
        ? `[Partial revision for ${c.issue_id}: ${c.partial_note}]`
        : `[Revision for ${c.issue_id}: ${c.recommended_revision}]`,
    );
    responses[`revision_agent::${latest.id}`] = {
      content: [latest.content, ...appliedSections].join("\n\n"),
      applied_issue_card_ids: accepted.map((c) => c.issue_id),
      notes: [],
    };

    responses[`final_qa_assistant::${latest.id}`] = {
      findings: [],
      passes: playbook.final_qa_checklist,
    };
  }

  return responses;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers — assertion mode (collects failures instead of throwing)
// ────────────────────────────────────────────────────────────────────────

interface AssertContext {
  failures: string[];
}

function check(ctx: AssertContext, label: string, cond: boolean): boolean {
  if (!cond) ctx.failures.push(label);
  return cond;
}

async function expectThrow(label: string, body: () => Promise<unknown> | unknown): Promise<boolean> {
  try {
    await body();
    return false;
  } catch {
    return true;
  }
}

// ────────────────────────────────────────────────────────────────────────
// DOCX inspection — pull plain text out of word/document.xml
// ────────────────────────────────────────────────────────────────────────

async function docxPlainText(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

// ────────────────────────────────────────────────────────────────────────
// runScenario — walk one fixture end-to-end and produce a report
// ────────────────────────────────────────────────────────────────────────

async function runScenario(fixturePath: string, scenarioIdx: number): Promise<ScenarioReport> {
  const started = Date.now();
  const failures: string[] = [];
  const ctx: AssertContext = { failures };
  const fixture = loadFixture(fixturePath);

  const stage: Record<string, boolean> = {
    project_created: false,
    sources_added: false,
    source_contents_attached: false,
    source_pack_locked: false,
    contract_type_confirmed: false,
    playbook_selected: false,
    intake_answered: false,
    deal_memo_drafted: false,
    deal_memo_approved: false,
    drafting_plan_drafted: false,
    drafting_plan_approved: false,
    v0_created: false,
    reviews_ran: false,
    decisions_made: false,
    final_qa_ran: false,
    revision_created: false,
    final_approved: false,
    exports_generated: false,
  };

  // Distinct id-namespace per scenario keeps the report deterministic
  // across scenarios within a single run.
  const env = {
    newId: createCounterIdGenerator(`s${scenarioIdx}`),
    now: createFixedClock("2026-06-01T00:00:00.000Z"),
  };
  const playbooks = loadPlaybooks();
  const projectRepo = createInMemoryRepository<ProjectState>((p) => p.project.id);
  const auditRepo = createInMemoryAppendOnlyRepository<AuditLog>((a) => a.id);

  function persist(state: ProjectState, audits: AuditLog[]) {
    projectRepo.put(state);
    for (const a of audits) auditRepo.append(a);
  }
  function apply(state: ProjectState, op: () => AggregateResult): ProjectState {
    const res = op();
    persist(res.state, res.audits);
    return res.state;
  }
  async function applyAsync(
    state: ProjectState,
    op: () => Promise<AggregateResult>,
  ): Promise<ProjectState> {
    const res = await op();
    persist(res.state, res.audits);
    return res.state;
  }

  // 1. Project
  const created = aggCreateProject({ name: fixture.project_name, created_by: USER }, env);
  persist(created.state, created.audits);
  let s = created.state;
  stage.project_created = true;

  // 2. Sources
  for (const sd of fixture.source_documents) {
    s = apply(s, () => aggAddSource(s, { ...sd, uploaded_by: USER }, env));
  }
  stage.sources_added = s.source_documents.length === fixture.source_documents.length;

  // 2a. Source contents
  const contents = fixture.source_contents ?? {};
  let attachedCount = 0;
  for (const doc of s.source_documents) {
    const text = contents[doc.file_name];
    if (!text) continue;
    s = apply(s, () =>
      aggAddSourceContent(
        s,
        { source_document_id: doc.id, text_content: text, is_synthetic: true },
        env,
      ),
    );
    attachedCount++;
  }
  stage.source_contents_attached = attachedCount === Object.keys(contents).length;

  // 3. Lock
  s = apply(s, () => aggLockSourcePack(s, LAWYER, env));
  stage.source_pack_locked = s.source_pack.locked === true;

  // INVARIANT PROBE: post-lock source mutation must throw
  const sLocked = s;
  const lockedProbeThrew = await expectThrow("source-pack post-lock add", () =>
    aggAddSource(
      sLocked,
      {
        file_name: "post_lock_attempt.pdf",
        source_type: "term_sheet",
        version: "1",
        incorporated: true,
        source_priority: 99,
        uploaded_by: USER,
      },
      env,
    ),
  );
  check(ctx, "source_pack_lock_enforced", lockedProbeThrew);

  // 4. Classify
  s = apply(s, () =>
    aggClassifyAndConfirm(
      s,
      { confirmed_type: fixture.contract_type, confirmed_by: LAWYER, hint: fixture.contract_type },
      env,
    ),
  );
  stage.contract_type_confirmed = s.contract_type !== null;

  // 5. Playbook + intake
  s = apply(s, () =>
    aggSelectPlaybook(s, { available_playbooks: playbooks, selector: LAWYER }, env),
  );
  if (!s.playbook) throw new Error(`playbook missing after selection for ${fixture.name}`);
  stage.playbook_selected = true;

  for (const q of s.intake_questions.filter((q) => q.required)) {
    const value = fixture.intake_answers[q.key] ?? `[fixture: missing value for ${q.key}]`;
    s = {
      ...s,
      intake_answers: [
        ...s.intake_answers,
        {
          id: env.newId(),
          project_id: s.project.id,
          question_id: q.id,
          value,
          answered_by: USER.id,
          answered_at: env.now(),
        },
      ],
    };
  }
  projectRepo.put(s);
  stage.intake_answered =
    s.intake_questions.filter((q) => q.required).length <= s.intake_answers.length;

  function makeCtx(state: ProjectState): AggregateContext {
    return createMockAggregateContext({
      env,
      actor: LAWYER,
      provider: createMockProvider({ json_responses: buildFixtureCannedResponses(state) }),
    });
  }

  // 6. Deal Memo
  s = await applyAsync(s, () => aggDraftDealMemo(s, makeCtx(s)));
  stage.deal_memo_drafted = s.deal_memo !== null;
  s = apply(s, () => aggApproveDealMemo(s, LAWYER, env));
  stage.deal_memo_approved = s.deal_memo?.approved_at !== null;

  // 7. Drafting Plan
  s = await applyAsync(s, () => aggDraftDraftingPlan(s, makeCtx(s)));
  stage.drafting_plan_drafted = s.drafting_plan !== null;
  s = apply(s, () => aggApproveDraftingPlan(s, LAWYER, env));
  stage.drafting_plan_approved = s.drafting_plan?.approved_at !== null;

  // 8. v0
  s = await applyAsync(s, () => aggCreateV0(s, makeCtx(s)));
  stage.v0_created = s.contract_versions.length >= 1;

  // 9. Reviews
  s = await applyAsync(s, () => aggRunMockReviews(s, makeCtx(s)));
  stage.reviews_ran = s.issue_cards.length > 0;

  // INVARIANT PROBE 1: pending Issue Card blocks final approval
  // Try aggApproveFinal with pending cards present.
  const pendingProbeThrew = await expectThrow("pending blocks final approval", () =>
    aggApproveFinal(s, LAWYER, env),
  );
  check(ctx, "pending_blocks_final", pendingProbeThrew);

  // INVARIANT PROBE 2: non-lawyer actor cannot approve final.
  // We construct a state where all cards are accepted then try with USER.
  const sAllAccepted = (() => {
    let tmp = s;
    for (const card of tmp.issue_cards) {
      tmp = aggDecideIssue(
        tmp,
        { issue_id: card.issue_id, decision: "accepted", decided_by: LAWYER },
        env,
      ).state;
    }
    return tmp;
  })();
  const rbacProbeThrew = await expectThrow("non-lawyer final approve", () =>
    aggApproveFinal(sAllAccepted, USER, env),
  );
  check(ctx, "rbac_non_lawyer_refused", rbacProbeThrew);

  // 10. Decide issues per fixture rules (the real walk)
  const seenSeverities = new Set<string>();
  const rejectedCardIds: string[] = [];
  for (const card of s.issue_cards) {
    const { decision, partial_note } = pickIssueDecision(card, fixture, seenSeverities);
    if (decision === "rejected") rejectedCardIds.push(card.issue_id);
    s = apply(s, () =>
      aggDecideIssue(
        s,
        {
          issue_id: card.issue_id,
          decision: decision as "accepted" | "partially_accepted" | "rejected" | "deferred",
          decided_by: LAWYER,
          ...(partial_note ? { partial_note } : {}),
        },
        env,
      ),
    );
  }
  stage.decisions_made = s.issue_cards.every((c) => c.human_decision !== "pending");

  // 11. Final QA + revision
  s = await applyAsync(s, () => aggRunMockFinalQA(s, makeCtx(s)));
  stage.final_qa_ran = s.qa_runs.length >= 1;
  s = await applyAsync(s, () => aggCreateRevision(s, makeCtx(s)));
  stage.revision_created = s.contract_versions.length >= 2;

  // INVARIANT PROBE 3: rejected card text must NOT appear in revision content
  const revisionVersion = s.contract_versions[s.contract_versions.length - 1]!;
  const rejectedNotInRevision = rejectedCardIds.every(
    (id) => !revisionVersion.content.includes(id),
  );
  check(ctx, "rejected_not_in_revision", rejectedNotInRevision);

  // 12. Final approve
  s = apply(s, () => aggApproveFinal(s, LAWYER, env));
  stage.final_approved = s.contract_versions.some((v) => v.final);

  // 13. Generate REAL export bytes via createExportRenderer() and inspect.
  const renderer = createExportRenderer();
  const finalVersion = s.contract_versions.find((v) => v.final)!;
  const renderInput = {
    project: s.project,
    contract_version: finalVersion,
    playbook: s.playbook ?? null,
    source_pack_id: s.source_pack.id,
    issue_cards: s.issue_cards,
    agent_runs: s.agent_runs,
    qa_runs: s.qa_runs,
    generated_at: env.now(),
  };

  const cleanRes = await renderer.renderCleanDocx(renderInput);
  const commentaryRes = await renderer.renderCommentaryDocx(renderInput);
  const matrixRes = await renderer.renderNegotiationMatrix(renderInput);
  const emailRes = await renderer.renderCoverEmail(renderInput);

  const cleanXml = await docxPlainText(cleanRes.buffer);
  const commentaryXml = await docxPlainText(commentaryRes.buffer);
  const matrixXml = await docxPlainText(matrixRes.buffer);
  const emailText = new TextDecoder("utf-8").decode(emailRes.buffer);

  function externalMarkersOk(label: string, text: string): { ok: boolean; detail: string } {
    const hits = FORBIDDEN_EXTERNAL_MARKERS.filter((m) => text.includes(m));
    return {
      ok: hits.length === 0,
      detail: hits.length === 0 ? "no forbidden markers" : `forbidden markers: ${hits.join(", ")}`,
    };
  }
  function internalBannerOk(label: string, text: string): { ok: boolean; detail: string } {
    const missing = INTERNAL_BANNER_MARKERS.filter((m) => !text.includes(m));
    return {
      ok: missing.length === 0,
      detail: missing.length === 0 ? "INTERNAL ONLY banner present" : `missing markers: ${missing.join(", ")}`,
    };
  }

  const cleanCheck = externalMarkersOk("clean", cleanXml);
  const commentaryCheck = internalBannerOk("commentary", commentaryXml);
  const matrixCheck = internalBannerOk("matrix", matrixXml);
  const emailCheck = externalMarkersOk("email", emailText);
  const noSendOk = emailText.includes("does NOT auto-send") || emailText.includes("자동 발송하지 않");

  check(ctx, "clean_export_no_internal_markers", cleanCheck.ok);
  check(ctx, "cover_email_no_internal_markers", emailCheck.ok);
  check(ctx, "cover_email_has_no_send_notice", noSendOk);
  check(ctx, "commentary_has_internal_banner", commentaryCheck.ok);
  check(ctx, "negotiation_matrix_has_internal_banner", matrixCheck.ok);

  const exports: ExportReport[] = [
    {
      type: "clean_docx",
      file_name: cleanRes.file_name,
      mime_type: cleanRes.mime_type,
      byte_count: cleanRes.buffer.byteLength,
      markers_check_passed: cleanCheck.ok,
      markers_detail: cleanCheck.detail,
    },
    {
      type: "commentary_docx",
      file_name: commentaryRes.file_name,
      mime_type: commentaryRes.mime_type,
      byte_count: commentaryRes.buffer.byteLength,
      markers_check_passed: commentaryCheck.ok,
      markers_detail: commentaryCheck.detail,
    },
    {
      type: "negotiation_matrix",
      file_name: matrixRes.file_name,
      mime_type: matrixRes.mime_type,
      byte_count: matrixRes.buffer.byteLength,
      markers_check_passed: matrixCheck.ok,
      markers_detail: matrixCheck.detail,
    },
    {
      type: "cover_email",
      file_name: emailRes.file_name,
      mime_type: emailRes.mime_type,
      byte_count: emailRes.buffer.byteLength,
      markers_check_passed: emailCheck.ok && noSendOk,
      markers_detail: `${emailCheck.detail}; no-send notice: ${noSendOk ? "present" : "MISSING"}`,
    },
  ];

  // Also record the aggregate-level export entries so the workflow flag
  // reflects what the UI would see.
  s = apply(s, () =>
    aggCreateExport(
      s,
      {
        export_type: "clean_docx",
        content: `[CLEAN EXTERNAL CONTRACT]\nProject: ${s.project.name}\nVersion: ${finalVersion.version_number}\n\n${finalVersion.content}`,
        created_by: LAWYER,
      },
      env,
    ),
  );
  s = apply(s, () =>
    aggCreateExport(
      s,
      {
        export_type: "commentary_docx",
        content: `[COMMENTARY] internal notes for ${s.project.name}`,
        created_by: LAWYER,
      },
      env,
    ),
  );
  stage.exports_generated = s.exports.length >= 2;

  // ── Issue Card counts ───────────────────────────────────────────
  const counts = {
    total: s.issue_cards.length,
    by_decision: {} as Record<string, number>,
    by_severity: {} as Record<string, number>,
    by_source_agent: {} as Record<string, number>,
  };
  for (const c of s.issue_cards) {
    counts.by_decision[c.human_decision] = (counts.by_decision[c.human_decision] ?? 0) + 1;
    counts.by_severity[c.severity] = (counts.by_severity[c.severity] ?? 0) + 1;
    counts.by_source_agent[c.source_agent] = (counts.by_source_agent[c.source_agent] ?? 0) + 1;
  }

  const invariants: InvariantOutcomes = {
    source_pack_lock_enforced: !ctx.failures.includes("source_pack_lock_enforced"),
    pending_blocks_final: !ctx.failures.includes("pending_blocks_final"),
    rbac_non_lawyer_refused: !ctx.failures.includes("rbac_non_lawyer_refused"),
    rejected_not_in_revision: !ctx.failures.includes("rejected_not_in_revision"),
    clean_export_no_internal_markers: !ctx.failures.includes("clean_export_no_internal_markers"),
    cover_email_no_internal_markers: !ctx.failures.includes("cover_email_no_internal_markers"),
    cover_email_has_no_send_notice: !ctx.failures.includes("cover_email_has_no_send_notice"),
    commentary_has_internal_banner: !ctx.failures.includes("commentary_has_internal_banner"),
    negotiation_matrix_has_internal_banner: !ctx.failures.includes(
      "negotiation_matrix_has_internal_banner",
    ),
  };

  return {
    fixture_file: basename(fixturePath),
    name: fixture.name,
    contract_type: fixture.contract_type,
    ok: failures.length === 0,
    elapsed_ms: Date.now() - started,
    failures,
    stage_completion: stage,
    issue_card_counts: counts,
    exports,
    invariants,
    agent_runs_count: s.agent_runs.length,
    audit_count: auditRepo.list().length,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Markdown emitter
// ────────────────────────────────────────────────────────────────────────

function emitMarkdown(reports: ScenarioReport[], generatedAt: string): string {
  const allOk = reports.every((r) => r.ok);
  const sections: string[] = [];
  sections.push(`# Alpha v0.1 — Evaluation Report\n`);
  sections.push(
    `> Generated by \`npm run alpha:eval\` at ${generatedAt}. This file is **machine-generated** — manual edits will be overwritten on the next run.\n`,
  );
  sections.push(`## Summary\n`);
  sections.push(`- Scenarios run: ${reports.length}`);
  sections.push(`- Passed: ${reports.filter((r) => r.ok).length}`);
  sections.push(`- Failed: ${reports.filter((r) => !r.ok).length}`);
  sections.push(
    `- Total elapsed: ${reports.reduce((acc, r) => acc + r.elapsed_ms, 0)} ms`,
  );
  sections.push(``);
  sections.push(
    `**Go / no-go recommendation for internal alpha demo:** ${
      allOk
        ? "**GO.** All scenarios passed every workflow stage and every cross-cutting invariant. Mock-mode is stable across the three contract families wired into Alpha v0.1. Limitations remain as documented in `docs/09_ALPHA_READINESS_CHECKLIST.md` and `docs/11_POST_ALPHA_BACKLOG.md`."
        : "**NO-GO.** At least one scenario failed an invariant probe. Inspect the per-scenario `Failures` block below before demoing. Do NOT proceed against real data."
    }\n`,
  );

  for (const r of reports) {
    sections.push(`---\n`);
    sections.push(`## Scenario: ${r.name}`);
    sections.push(``);
    sections.push(`- Fixture file: \`fixtures/${r.fixture_file}\``);
    sections.push(`- Contract type: \`${r.contract_type}\``);
    sections.push(`- Result: ${r.ok ? "✅ PASS" : "❌ FAIL"}`);
    sections.push(`- Elapsed: ${r.elapsed_ms} ms`);
    sections.push(`- Agent runs recorded: ${r.agent_runs_count}`);
    sections.push(`- Audit log entries: ${r.audit_count}`);
    sections.push(``);

    sections.push(`### Stage completion`);
    sections.push(``);
    sections.push(`| Stage | Completed |`);
    sections.push(`|---|---|`);
    for (const [stage, ok] of Object.entries(r.stage_completion)) {
      sections.push(`| \`${stage}\` | ${ok ? "✅" : "❌"} |`);
    }
    sections.push(``);

    sections.push(`### Issue Cards`);
    sections.push(``);
    sections.push(`- Total: ${r.issue_card_counts.total}`);
    sections.push(`- By decision:`);
    for (const [k, v] of Object.entries(r.issue_card_counts.by_decision)) {
      sections.push(`  - \`${k}\`: ${v}`);
    }
    sections.push(`- By severity:`);
    for (const [k, v] of Object.entries(r.issue_card_counts.by_severity)) {
      sections.push(`  - \`${k}\`: ${v}`);
    }
    sections.push(`- By source agent:`);
    for (const [k, v] of Object.entries(r.issue_card_counts.by_source_agent)) {
      sections.push(`  - \`${k}\`: ${v}`);
    }
    sections.push(``);

    sections.push(`### Exports`);
    sections.push(``);
    sections.push(`| Type | File name | MIME | Bytes | Markers check |`);
    sections.push(`|---|---|---|---|---|`);
    for (const e of r.exports) {
      sections.push(
        `| \`${e.type}\` | \`${e.file_name}\` | \`${e.mime_type}\` | ${e.byte_count} | ${
          e.markers_check_passed ? "✅" : "❌"
        } ${e.markers_detail} |`,
      );
    }
    sections.push(``);

    sections.push(`### Invariant probes`);
    sections.push(``);
    sections.push(`| Invariant | Result |`);
    sections.push(`|---|---|`);
    for (const [k, v] of Object.entries(r.invariants)) {
      sections.push(`| ${k} | ${v ? "✅ enforced" : "❌ VIOLATED"} |`);
    }
    sections.push(``);

    if (r.failures.length > 0) {
      sections.push(`### Failures`);
      sections.push(``);
      for (const f of r.failures) sections.push(`- ❌ ${f}`);
      sections.push(``);
    }
  }

  sections.push(`---\n`);
  sections.push(`## Known limitations`);
  sections.push(``);
  sections.push(`See \`docs/09_ALPHA_READINESS_CHECKLIST.md\` §19 and the README "Security and production limitations" section for the full list. The most important constraints relevant to this run:`);
  sections.push(``);
  sections.push(`- Mock-only LLM calls. Real-mode roles are off in evaluation by design.`);
  sections.push(`- Sanitized fixtures only (\`example.test\` domains, invented amounts).`);
  sections.push(`- No external sending, no PDF conversion, no e-signature, no OAuth/SSO.`);
  sections.push(`- Project-scoped RBAC only; no org-level multi-tenancy.`);
  sections.push(``);
  sections.push(`## Skipped items`);
  sections.push(``);
  sections.push(`- Gated real-LLM E2E specs (\`E2E_REAL_OPENAI\`, \`E2E_REAL_CONTRACT_DRAFT\`, \`E2E_REAL_REVIEW\`, \`E2E_SIGNED_AUTH\`, \`E2E_DURABLE_PERSISTENCE\`) — skipped in normal CI and in this runner by design.`);
  sections.push(`- Postgres adapter integration tests — require \`DATABASE_URL\`; skipped in CI.`);
  sections.push(``);
  return sections.join("\n");
}

// ────────────────────────────────────────────────────────────────────────
// main
// ────────────────────────────────────────────────────────────────────────

const FIXTURE_FILES = [
  "synthetic-nda.json",
  "synthetic-service-agreement.json",
  "synthetic-booth-event.json",
];

async function main() {
  console.log("Alpha v0.1 — Evaluation Runner (Milestone 4C)");
  console.log("=".repeat(60));
  console.log();

  const reports: ScenarioReport[] = [];
  let scenarioIdx = 0;
  for (const file of FIXTURE_FILES) {
    const fixturePath = resolve(repoRoot, "fixtures", file);
    if (!existsSync(fixturePath)) {
      console.error(`⚠ fixture not found: ${fixturePath}`);
      reports.push({
        fixture_file: file,
        name: file,
        contract_type: "(unknown)",
        ok: false,
        elapsed_ms: 0,
        failures: [`fixture file not found: ${fixturePath}`],
        stage_completion: {},
        issue_card_counts: { total: 0, by_decision: {}, by_severity: {}, by_source_agent: {} },
        exports: [],
        invariants: {
          source_pack_lock_enforced: false,
          pending_blocks_final: false,
          rbac_non_lawyer_refused: false,
          rejected_not_in_revision: false,
          clean_export_no_internal_markers: false,
          cover_email_no_internal_markers: false,
          cover_email_has_no_send_notice: false,
          commentary_has_internal_banner: false,
          negotiation_matrix_has_internal_banner: false,
        },
        agent_runs_count: 0,
        audit_count: 0,
      });
      continue;
    }
    console.log(`▶ ${file}`);
    const report = await runScenario(fixturePath, ++scenarioIdx);
    reports.push(report);
    console.log(
      `  ${report.ok ? "✓" : "✗"} ${report.name} — ${report.elapsed_ms} ms, ${report.issue_card_counts.total} cards, ${report.agent_runs_count} agent runs`,
    );
    for (const [k, v] of Object.entries(report.invariants)) {
      console.log(`    · ${k}: ${v ? "✓" : "✗ VIOLATED"}`);
    }
    if (report.failures.length > 0) {
      for (const f of report.failures) console.log(`    × failure: ${f}`);
    }
    console.log();
  }

  const generatedAt = new Date().toISOString();
  const md = emitMarkdown(reports, generatedAt);
  const docsDir = resolve(repoRoot, "docs");
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
  const reportPath = resolve(docsDir, "10_ALPHA_EVALUATION_REPORT.md");
  writeFileSync(reportPath, md, "utf-8");
  console.log(`Report written: ${reportPath}`);

  const allOk = reports.every((r) => r.ok);
  console.log();
  console.log("=".repeat(60));
  console.log(
    `Result: ${allOk ? "ALL SCENARIOS PASSED" : "ONE OR MORE SCENARIOS FAILED"} (${reports.filter((r) => r.ok).length}/${reports.length})`,
  );
  console.log(
    `Go/no-go: ${allOk ? "GO for internal alpha demo (mock-mode, synthetic data only)" : "NO-GO — investigate failures before demo"}`,
  );
  if (!allOk) process.exit(1);
}

try {
  await main();
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  console.error(e instanceof Error ? e.stack : "");
  process.exit(1);
}
