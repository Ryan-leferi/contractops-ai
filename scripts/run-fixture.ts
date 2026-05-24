/**
 * scripts/run-fixture.ts
 *
 * Drives the entire mock workflow end-to-end against a sanitized fixture,
 * without going through the web UI. This proves workflow logic is not
 * dependent on the browser — the same aggregate ops the UI calls run here
 * via Node.
 *
 * Usage:  npm run fixture
 *
 * The fixture under fixtures/ MUST be synthetic. Do not point this script at
 * real source documents.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  aggAddSource,
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
  type AggregateResult,
  type Env,
  type ProjectState,
  type ReviewSeed,
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

function makeEnv(): Env {
  return {
    newId: createCounterIdGenerator("fx"),
    now: createFixedClock("2026-06-01T00:00:00.000Z"),
  };
}

function pickIssueDecision(
  card: { severity: IssueSeverity },
  fixture: FixtureDef,
  seenSeverities: Set<string>,
): { decision: string; partial_note?: string } {
  // "first_<severity>" rules apply once per severity bucket; "default" applies
  // to anything else.
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

function mockSeedsFromPlaybook(playbook: Playbook): ReviewSeed[] {
  const seeds: ReviewSeed[] = [];
  (playbook.common_risks.slice(0, 2)).forEach((r, i) => {
    seeds.push({
      source_agent: i === 0 ? "mock_claude" : "mock_gemini",
      severity: i === 0 ? "high" : "medium",
      location: { article: `제${i + 3}조` },
      issue_type: "playbook_risk",
      problem: r,
      why_it_matters: r,
      recommended_revision: `Tighten language to address: ${r}`,
      business_impact: "moderate",
      recommended_action: "revise",
    });
  });
  (playbook.red_flags.slice(0, 1)).forEach((f) => {
    seeds.push({
      source_agent: "mock_claude",
      severity: "critical",
      location: { article: `제7조` },
      issue_type: "red_flag",
      problem: f,
      why_it_matters: f,
      recommended_revision: `Remove or limit: ${f}`,
      business_impact: "high",
      recommended_action: "revise",
    });
  });
  seeds.push({
    source_agent: "mock_python_qa",
    severity: "low",
    location: {},
    issue_type: "numbering",
    problem: "Confirm Korean numbering",
    why_it_matters: "drafting convention",
    recommended_revision: "Apply Korean numbering",
    business_impact: "low",
    recommended_action: "accept",
  });
  return seeds;
}

function run() {
  const fixturePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(repoRoot, "fixtures", "synthetic-booth-event.json");

  console.log(`Loading fixture: ${fixturePath}`);
  const fixture = loadFixture(fixturePath);
  console.log(`Fixture: ${fixture.name}`);
  console.log(`  project: ${fixture.project_name}`);
  console.log(`  contract type: ${fixture.contract_type}`);
  console.log(`  sources: ${fixture.source_documents.length}`);
  console.log();

  const env = makeEnv();
  const playbooks = loadPlaybooks();
  const projectRepo = createInMemoryRepository<ProjectState>((p) => p.project.id);
  const auditRepo = createInMemoryAppendOnlyRepository<AuditLog>((a) => a.id);

  // Helper to apply an aggregate op and persist.
  function apply(state: ProjectState, label: string, op: () => AggregateResult): ProjectState {
    const res = op();
    projectRepo.put(res.state);
    for (const a of res.audits) auditRepo.append(a);
    console.log(`✓ ${label}  (status: ${res.state.project.status}, audits: +${res.audits.length})`);
    return res.state;
  }

  // 1. Create project
  const created = aggCreateProject({ name: fixture.project_name, created_by: USER }, env);
  projectRepo.put(created.state);
  for (const a of created.audits) auditRepo.append(a);
  console.log(`✓ project_created  (status: ${created.state.project.status})`);
  let s = created.state;

  // 2. Add sources
  for (const sd of fixture.source_documents) {
    s = apply(s, `source_uploaded: ${sd.file_name}`, () =>
      aggAddSource(s, { ...sd, uploaded_by: USER }, env),
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

  // 6. Answer intake
  for (const q of s.intake_questions.filter((q) => q.required)) {
    const value = fixture.intake_answers[q.key] ?? `[fixture: missing value for ${q.key}]`;
    const answered = aggAnswerIntakeDirect(s, q.id, value, env);
    s = answered;
    console.log(`  · intake answered: ${q.key} = ${value}`);
  }

  // 7. Deal Memo
  s = apply(s, "deal_memo_drafted", () =>
    aggDraftDealMemo(s, { content: `Mock memo for ${s.project.name}`, drafter: USER }, env),
  );
  s = apply(s, "deal_memo_approved", () => aggApproveDealMemo(s, LAWYER, env));

  // 8. Drafting Plan
  s = apply(s, "drafting_plan_drafted", () =>
    aggDraftDraftingPlan(s, { content: `Mock drafting plan for ${s.project.name}`, drafter: USER }, env),
  );
  s = apply(s, "drafting_plan_approved", () => aggApproveDraftingPlan(s, LAWYER, env));

  // 9. v0
  s = apply(s, "draft_v0_created", () =>
    aggCreateV0(s, { content: `[MOCK v0 — ${s.playbook!.contract_type}]\n\nbody from fixture` }, env),
  );

  // 10. Mock reviews
  s = apply(s, "reviews_in_progress → issues_open", () =>
    aggRunMockReviews(s, { seeds: mockSeedsFromPlaybook(s.playbook!) }, env),
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
  s = apply(s, "mock_final_qa_run", () => aggRunMockFinalQA(s, env));
  s = apply(s, "revision_generated", () => aggCreateRevision(s, {}, env));

  // 13. Approve final
  s = apply(s, "final_approved", () => aggApproveFinal(s, LAWYER, env));

  // 14. Exports — produce all four artifacts
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

  // ----- Summary -----
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
  console.log(`Exports:                 ${s.exports.length}`);
  console.log(`Audit entries (repo):    ${auditRepo.list().length}`);

  // Invariant checks (executed BEFORE process exit)
  const rejected = s.issue_cards.filter((c) => c.human_decision === "rejected");
  for (const r of rejected) {
    if (r.applied_version) {
      throw new Error(`Invariant violated: rejected Issue Card ${r.issue_id} has applied_version`);
    }
    const finalContent = finalVersion.content;
    if (finalContent.includes(r.issue_id)) {
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

  console.log();
  console.log("All workflow invariants held. ✓");
}

// Direct intake answer (not via aggAnswerIntake, since the fixture asks us to
// keep this script straightforward and aggAnswerIntake does the same thing).
import { aggAnswerIntake } from "@contractops/core";
function aggAnswerIntakeDirect(
  state: ProjectState,
  question_id: string,
  value: string,
  env: Env,
): ProjectState {
  const { state: next } = aggAnswerIntake(
    state,
    { question_id, value, answered_by: USER },
    env,
  );
  return next;
}

try {
  run();
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}
