/**
 * scripts/run-fixture.ts
 *
 * Drives the entire mock workflow end-to-end against a sanitized fixture,
 * without going through the web UI. Proves the workflow logic is not
 * dependent on the browser — the same aggregate ops the UI calls run here
 * via Node, against the same MockProvider abstraction.
 *
 * Usage:  npm run fixture
 *
 * The fixture under fixtures/ MUST be synthetic. Do not point this script at
 * real source documents.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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
import {
  playbookSchema,
  type Actor,
  type AuditLog,
  type IssueSeverity,
  type Playbook,
  type SourceType,
} from "@contractops/schemas";

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

const USER: Actor = { id: "fixture_user", role: "user", display_name: "Fixture User" };
const LAWYER: Actor = { id: "fixture_lawyer", role: "human_lawyer", display_name: "Fixture Lawyer" };

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

async function run() {
  const fixturePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(repoRoot, "fixtures", "synthetic-booth-event.json");

  console.log(`Loading fixture: ${fixturePath}`);
  const fixture = loadFixture(fixturePath);
  console.log(`Fixture: ${fixture.name}`);
  console.log(`  project: ${fixture.project_name}`);
  console.log(`  contract type: ${fixture.contract_type}`);
  console.log(`  sources: ${fixture.source_documents.length}`);
  console.log(`  source contents: ${Object.keys(fixture.source_contents ?? {}).length}`);
  console.log();

  const env = {
    newId: createCounterIdGenerator("fx"),
    now: createFixedClock("2026-06-01T00:00:00.000Z"),
  };
  const playbooks = loadPlaybooks();
  const projectRepo = createInMemoryRepository<ProjectState>((p) => p.project.id);
  const auditRepo = createInMemoryAppendOnlyRepository<AuditLog>((a) => a.id);

  function persist(state: ProjectState, audits: AuditLog[]) {
    projectRepo.put(state);
    for (const a of audits) auditRepo.append(a);
  }

  function apply(state: ProjectState, label: string, op: () => AggregateResult): ProjectState {
    const res = op();
    persist(res.state, res.audits);
    console.log(`✓ ${label}  (status: ${res.state.project.status}, audits: +${res.audits.length})`);
    return res.state;
  }

  async function applyAsync(
    state: ProjectState,
    label: string,
    op: () => Promise<AggregateResult>,
  ): Promise<ProjectState> {
    const res = await op();
    persist(res.state, res.audits);
    console.log(`✓ ${label}  (status: ${res.state.project.status}, audits: +${res.audits.length}, agent_runs: ${res.state.agent_runs.length})`);
    return res.state;
  }

  // 1. Create project
  const created = aggCreateProject({ name: fixture.project_name, created_by: USER }, env);
  persist(created.state, created.audits);
  console.log(`✓ project_created  (status: ${created.state.project.status})`);
  let s = created.state;

  // 2. Add sources
  for (const sd of fixture.source_documents) {
    s = apply(s, `source_uploaded: ${sd.file_name}`, () =>
      aggAddSource(s, { ...sd, uploaded_by: USER }, env),
    );
  }

  // 2a. Attach synthetic source contents
  const contents = fixture.source_contents ?? {};
  for (const doc of s.source_documents) {
    const text = contents[doc.file_name];
    if (!text) continue;
    s = apply(s, `source_content_attached: ${doc.file_name}`, () =>
      aggAddSourceContent(
        s,
        { source_document_id: doc.id, text_content: text, is_synthetic: true },
        env,
      ),
    );
  }

  // 3. Lock pack
  s = apply(s, "source_pack_locked", () => aggLockSourcePack(s, LAWYER, env));

  // 4. Confirm type
  s = apply(s, "contract_type_confirmed", () =>
    aggClassifyAndConfirm(
      s,
      { confirmed_type: fixture.contract_type, confirmed_by: LAWYER, hint: fixture.contract_type },
      env,
    ),
  );

  // 5. Select playbook + generate intake
  s = apply(s, "playbook_selected", () =>
    aggSelectPlaybook(s, { available_playbooks: playbooks, selector: LAWYER }, env),
  );
  if (!s.playbook) throw new Error("playbook missing after selection");
  console.log(`  → matched Playbook: ${s.playbook.contract_type} (is_custom=${s.playbook.is_custom_marker})`);

  // 6. Answer intake (use low-level direct mutation for brevity — semantics identical)
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
    console.log(`  · intake answered: ${q.key} = ${value}`);
  }
  projectRepo.put(s);

  // Build an AggregateContext for agent-backed ops. Inject the per-state
  // canned MockProvider so reviewer findings derive from the Playbook.
  function makeCtx(state: ProjectState): AggregateContext {
    return createMockAggregateContext({
      env,
      actor: LAWYER,
      provider: createMockProvider({
        json_responses: buildFixtureCannedResponses(state),
      }),
    });
  }

  // 7. Deal Memo (agent-backed)
  s = await applyAsync(s, "deal_memo_drafted", () => aggDraftDealMemo(s, makeCtx(s)));
  s = apply(s, "deal_memo_approved", () => aggApproveDealMemo(s, LAWYER, env));

  // 8. Drafting Plan
  s = await applyAsync(s, "drafting_plan_drafted", () => aggDraftDraftingPlan(s, makeCtx(s)));
  s = apply(s, "drafting_plan_approved", () => aggApproveDraftingPlan(s, LAWYER, env));

  // 9. v0
  s = await applyAsync(s, "draft_v0_created", () => aggCreateV0(s, makeCtx(s)));

  // 10. Reviews
  s = await applyAsync(s, "reviews_in_progress → issues_open", () =>
    aggRunMockReviews(s, makeCtx(s)),
  );
  console.log(`  → ${s.issue_cards.length} Issue Cards seeded`);

  // 11. Decide issues per fixture rules
  const seenSeverities = new Set<string>();
  for (const card of s.issue_cards) {
    const { decision, partial_note } = pickIssueDecision(card, fixture, seenSeverities);
    s = apply(s, `issue ${card.issue_id} → ${decision}`, () =>
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

  // 12. Final QA + revision
  s = await applyAsync(s, "mock_final_qa_run", () => aggRunMockFinalQA(s, makeCtx(s)));
  s = await applyAsync(s, "revision_generated", () => aggCreateRevision(s, makeCtx(s)));

  // 13. Approve final
  s = apply(s, "final_approved", () => aggApproveFinal(s, LAWYER, env));

  // 14. Exports
  const finalVersion = s.contract_versions.find((v) => v.final)!;
  s = apply(s, "exported clean_docx", () =>
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
  s = apply(s, "exported commentary_docx", () =>
    aggCreateExport(
      s,
      {
        export_type: "commentary_docx",
        content: `[COMMENTARY] internal notes for ${s.project.name}\n\n[INTERNAL] all Issue Card decisions captured in audit log`,
        created_by: LAWYER,
      },
      env,
    ),
  );

  // ----- Summary + invariants -----
  console.log();
  console.log("===== Run summary =====");
  console.log(`Project status:          ${s.project.status}`);
  console.log(`Versions:                ${s.contract_versions.length}`);
  console.log(`Final approved:          ${s.contract_versions.find((v) => v.final) ? "yes" : "no"}`);
  console.log(`Issue Cards:             ${s.issue_cards.length}`);
  console.log(`  accepted:              ${s.issue_cards.filter((c) => c.human_decision === "accepted").length}`);
  console.log(`  partially_accepted:    ${s.issue_cards.filter((c) => c.human_decision === "partially_accepted").length}`);
  console.log(`  rejected:              ${s.issue_cards.filter((c) => c.human_decision === "rejected").length}`);
  console.log(`Agent runs:              ${s.agent_runs.length}`);
  console.log(`Source contents:         ${s.source_contents.length}`);
  console.log(`Exports:                 ${s.exports.length}`);
  console.log(`Audit entries (repo):    ${auditRepo.list().length}`);

  // Invariants
  const rejected = s.issue_cards.filter((c) => c.human_decision === "rejected");
  for (const r of rejected) {
    if (r.applied_version) {
      throw new Error(`Invariant violated: rejected Issue Card ${r.issue_id} has applied_version`);
    }
    if (finalVersion.content.includes(r.issue_id)) {
      throw new Error(`Invariant violated: rejected Issue Card ${r.issue_id} content leaked into final version`);
    }
  }

  const cleanExport = s.exports.find((e) => e.export_type === "clean_docx");
  if (cleanExport) {
    for (const marker of ["[COMMENTARY]", "[INTERNAL]", "[REDLINE_RATIONALE]", "[NEGOTIATION_GUIDANCE]"]) {
      if (cleanExport.content.includes(marker)) {
        throw new Error(`Invariant violated: clean_docx contains commentary marker "${marker}"`);
      }
    }
  }

  // Provider-provenance on audit logs (Milestone 2B requirement)
  const draftCreatedAudits = auditRepo.list().filter((a) => a.event_type === "draft_created");
  for (const a of draftCreatedAudits) {
    const payload = a.payload as Record<string, unknown>;
    if (!payload.provider_id || !payload.mode || !payload.agent_run_id) {
      throw new Error(`Invariant violated: draft_created audit missing provider provenance`);
    }
  }
  const revisionAudits = auditRepo.list().filter((a) => a.event_type === "revision_generated");
  for (const a of revisionAudits) {
    const payload = a.payload as Record<string, unknown>;
    if (!payload.provider_id || !payload.mode || !payload.agent_run_id) {
      throw new Error(`Invariant violated: revision_generated audit missing provider provenance`);
    }
  }

  console.log();
  console.log("All workflow invariants held. ✓");
}

// Build per-state canned mock provider responses for the CLI fixture. Mirrors
// the web's buildPlaybookCannedResponses but lives in the script so the CLI is
// self-contained.
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

try {
  await run();
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
