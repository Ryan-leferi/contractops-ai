import * as core from "@contractops/core";
import type * as S from "@contractops/schemas";

// Re-export ProjectState from core so pages don't need a second import.
export type { ProjectState } from "@contractops/core";

export interface AppStore {
  projectIds: string[];
  projects: Record<string, core.ProjectState>;
  /**
   * Flat audit collection. Persisted to a separate AppendOnlyRepository in the
   * store provider. Listed in this app-level shape for convenient rendering.
   */
  audits: S.AuditLog[];
}

export function emptyStore(): AppStore {
  return { projectIds: [], projects: {}, audits: [] };
}

export const DEMO_USER: S.Actor = {
  id: "user_demo",
  role: "user",
  display_name: "Demo User",
};

export const DEMO_LAWYER: S.Actor = {
  id: "lawyer_demo",
  role: "human_lawyer",
  display_name: "Demo Lawyer",
};

export function makeEnv(): core.Env {
  return {
    newId: () => {
      if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      }
      return Math.random().toString(36).slice(2, 14);
    },
    now: () => new Date().toISOString(),
  };
}

// ---------- Web action wrappers ----------
//
// Each wrapper returns a `core.AggregateResult` (state + audits). They inject
// demo actors and an env — that's all. No workflow logic lives here.

export function actCreateProject(name: string): core.AggregateResult {
  return core.aggCreateProject({ name, created_by: DEMO_USER }, makeEnv());
}

export interface ActAddSourceArgs {
  file_name: string;
  source_type: S.SourceType;
  version: string;
  incorporated: boolean;
  source_priority: number;
}

export function actAddSource(
  state: core.ProjectState,
  args: ActAddSourceArgs,
): core.AggregateResult {
  return core.aggAddSource(state, { ...args, uploaded_by: DEMO_USER }, makeEnv());
}

export function actLockSourcePack(state: core.ProjectState): core.AggregateResult {
  return core.aggLockSourcePack(state, DEMO_LAWYER, makeEnv());
}

export function actClassifyAndConfirm(
  state: core.ProjectState,
  args: { confirmed_type: string; hint?: string },
): core.AggregateResult {
  return core.aggClassifyAndConfirm(
    state,
    { ...args, confirmed_by: DEMO_LAWYER },
    makeEnv(),
  );
}

export function actSelectPlaybook(
  state: core.ProjectState,
  available_playbooks: S.Playbook[],
): core.AggregateResult {
  return core.aggSelectPlaybook(
    state,
    { available_playbooks, selector: DEMO_LAWYER },
    makeEnv(),
  );
}

export function actAnswerIntake(
  state: core.ProjectState,
  args: { question_id: string; value: string },
): core.AggregateResult {
  return core.aggAnswerIntake(
    state,
    { ...args, answered_by: DEMO_USER },
    makeEnv(),
  );
}

export function actDraftDealMemo(state: core.ProjectState): core.AggregateResult {
  return core.aggDraftDealMemo(
    state,
    { content: mockDealMemoContent(state), drafter: DEMO_USER },
    makeEnv(),
  );
}

export function actApproveDealMemo(state: core.ProjectState): core.AggregateResult {
  return core.aggApproveDealMemo(state, DEMO_LAWYER, makeEnv());
}

export function actDraftDraftingPlan(state: core.ProjectState): core.AggregateResult {
  return core.aggDraftDraftingPlan(
    state,
    { content: mockDraftingPlanContent(state), drafter: DEMO_USER },
    makeEnv(),
  );
}

export function actApproveDraftingPlan(state: core.ProjectState): core.AggregateResult {
  return core.aggApproveDraftingPlan(state, DEMO_LAWYER, makeEnv());
}

export function actCreateV0(state: core.ProjectState): core.AggregateResult {
  return core.aggCreateV0(state, { content: mockV0Content(state) }, makeEnv());
}

export function actRunMockReviews(state: core.ProjectState): core.AggregateResult {
  return core.aggRunMockReviews(state, { seeds: mockReviewSeeds(state) }, makeEnv());
}

export function actDecideIssue(
  state: core.ProjectState,
  args: { issue_id: string; decision: core.IssueDecisionOutcome; partial_note?: string },
): core.AggregateResult {
  return core.aggDecideIssue(
    state,
    { ...args, decided_by: DEMO_LAWYER },
    makeEnv(),
  );
}

export function actCreateRevision(state: core.ProjectState): core.AggregateResult {
  return core.aggCreateRevision(state, {}, makeEnv());
}

export function actRunMockFinalQA(state: core.ProjectState): core.AggregateResult {
  return core.aggRunMockFinalQA(state, makeEnv());
}

export function actApproveFinal(state: core.ProjectState): core.AggregateResult {
  return core.aggApproveFinal(state, DEMO_LAWYER, makeEnv());
}

export function actCreateExport(
  state: core.ProjectState,
  args: { export_type: S.ExportType; content: string },
): core.AggregateResult {
  return core.aggCreateExport(
    state,
    { ...args, created_by: DEMO_LAWYER },
    makeEnv(),
  );
}

// ---------- Mock content generators (no contract-name hardcoding) ----------

export function mockDealMemoContent(state: core.ProjectState): string {
  const lines: string[] = [];
  lines.push(`# Mock Deal Memo`);
  lines.push(`Project: ${state.project.name}`);
  lines.push(`Contract type: ${state.playbook?.contract_type ?? "(unknown)"}`);
  lines.push(``);
  lines.push(`## Source documents (${state.source_documents.length})`);
  for (const d of state.source_documents) {
    lines.push(`- [${d.source_type}] ${d.file_name} (v${d.version})`);
  }
  lines.push(``);
  lines.push(`## Intake responses`);
  for (const q of state.intake_questions) {
    const a = state.intake_answers.find((x) => x.question_id === q.id);
    lines.push(`- **${q.key}**: ${a?.value ?? "(unanswered)"}`);
  }
  if (state.playbook?.common_risks.length) {
    lines.push(``);
    lines.push(`## Common risks from Playbook`);
    for (const r of state.playbook.common_risks) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}

export function mockDraftingPlanContent(state: core.ProjectState): string {
  const playbook = state.playbook;
  const lines: string[] = [];
  lines.push(`# Mock Drafting Plan`);
  lines.push(`Contract type: ${playbook?.contract_type ?? "(unknown)"}`);
  if (playbook?.is_custom_marker) {
    lines.push(`**Mode: Custom Contract — human-approved Drafting Plan required before drafting.**`);
  } else {
    lines.push(`Mode: Standard Playbook`);
  }
  lines.push(``);
  lines.push(`## Table of Contents`);
  if (playbook?.default_table_of_contents.length) {
    for (const toc of playbook.default_table_of_contents) lines.push(`- ${toc}`);
  } else {
    lines.push(`- (to be defined ad-hoc)`);
  }
  if (playbook?.mandatory_clauses.length) {
    lines.push(``);
    lines.push(`## Mandatory clauses`);
    for (const c of playbook.mandatory_clauses) lines.push(`- ${c.heading} (\`${c.key}\`)`);
  }
  if (playbook?.negotiation_positions.length) {
    lines.push(``);
    lines.push(`## Negotiation positions`);
    for (const p of playbook.negotiation_positions) lines.push(`- ${p}`);
  }
  return lines.join("\n");
}

export function mockV0Content(state: core.ProjectState): string {
  const playbook = state.playbook;
  const toc = playbook?.default_table_of_contents ?? [];
  if (toc.length === 0) {
    return [
      `[MOCK v0 DRAFT — Custom Contract]`,
      ``,
      state.drafting_plan?.content ?? "",
      ``,
      `[Body to be drafted from human-approved Drafting Plan]`,
    ].join("\n");
  }
  const articles = toc
    .map(
      (heading) =>
        `${heading}\n  [Mock body for ${heading} — derived from Playbook + Drafting Plan]`,
    )
    .join("\n\n");
  return `[MOCK v0 DRAFT — ${playbook?.contract_type}]\n\n${articles}`;
}

export function mockReviewSeeds(state: core.ProjectState): core.ReviewSeed[] {
  const playbook = state.playbook;
  const seeds: core.ReviewSeed[] = [];
  const risks = playbook?.common_risks.slice(0, 2) ?? [];
  const flags = playbook?.red_flags.slice(0, 1) ?? [];

  risks.forEach((r, i) => {
    seeds.push({
      source_agent: i === 0 ? "mock_claude" : "mock_gemini",
      severity: i === 0 ? "high" : "medium",
      location: { article: `제${i + 3}조` },
      issue_type: "playbook_risk",
      problem: r,
      why_it_matters: `Playbook common risk: ${r}`,
      recommended_revision: `Tighten language to address: ${r}`,
      business_impact: "moderate",
      recommended_action: "revise",
    });
  });

  flags.forEach((f, i) => {
    seeds.push({
      source_agent: "mock_claude",
      severity: "critical",
      location: { article: `제${i + 7}조` },
      issue_type: "red_flag",
      problem: f,
      why_it_matters: `Playbook red flag: ${f}`,
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
    problem: "Confirm Korean numbering 제·①·1.·가.",
    why_it_matters: "Korean drafting convention (PLATFORM_BRIEF.md §6).",
    recommended_revision: "Apply Korean article/paragraph/item numbering throughout.",
    business_impact: "low",
    recommended_action: "accept",
  });

  return seeds;
}

// ---------- Export content placeholders (no commentary in clean) ----------

export function mockCleanExportContent(
  state: core.ProjectState,
  finalVersion: S.ContractVersion,
): string {
  return [
    `[CLEAN EXTERNAL CONTRACT — ${state.playbook?.contract_type ?? "Contract"}]`,
    `Project: ${state.project.name}`,
    `Version: ${finalVersion.version_number}`,
    ``,
    finalVersion.content,
  ].join("\n");
}

export function mockCommentaryExportContent(
  state: core.ProjectState,
  finalVersion: S.ContractVersion,
): string {
  const lines: string[] = [];
  lines.push(`[COMMENTARY] Internal legal commentary — DO NOT SEND EXTERNALLY`);
  lines.push(`Project: ${state.project.name}`);
  lines.push(`Version: ${finalVersion.version_number}`);
  lines.push(``);
  lines.push(`[COMMENTARY] Issue Card decisions:`);
  for (const c of state.issue_cards) {
    lines.push(
      `[INTERNAL] - ${c.issue_id} (${c.source_agent}, ${c.severity}): ${c.human_decision}${c.partial_note ? ` — partial_note: ${c.partial_note}` : ""}`,
    );
  }
  lines.push(``);
  lines.push(`[REDLINE_RATIONALE]`);
  lines.push(`Why the accepted revisions were applied: see Issue Cards above.`);
  return lines.join("\n");
}

export function mockNegotiationMatrixContent(state: core.ProjectState): string {
  const lines: string[] = ["[NEGOTIATION_GUIDANCE] Negotiation Matrix (internal)"];
  lines.push(``);
  for (const c of state.issue_cards.filter((x) => x.human_decision !== "rejected")) {
    lines.push(
      `- ${c.location.article ?? "?"} — ${c.issue_type} (${c.severity}): proposed=${c.recommended_revision}`,
    );
  }
  return lines.join("\n");
}

export function mockCoverEmailContent(
  state: core.ProjectState,
  finalVersion: S.ContractVersion,
): string {
  return [
    `Subject: ${state.playbook?.contract_type ?? "Contract"} 검토본 송부`,
    ``,
    `안녕하십니까,`,
    ``,
    `${state.playbook?.contract_type ?? "계약서"} ${finalVersion.version_number} 버전을 송부드립니다.`,
    `검토 후 회신 부탁드립니다.`,
    ``,
    `감사합니다.`,
  ].join("\n");
}
