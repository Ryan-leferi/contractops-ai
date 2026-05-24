import * as core from "@contractops/core";
import type * as S from "@contractops/schemas";

// Re-export ProjectState from core so pages don't need a second import.
export type { ProjectState } from "@contractops/core";

export interface AppStore {
  projectIds: string[];
  projects: Record<string, core.ProjectState>;
  /** Flat audit collection. Persisted via AppendOnlyRepository. */
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

/**
 * Build a per-call AggregateContext. The MockProvider is configured with
 * Playbook-driven canned responses so the UI demo shows richer content than
 * the bare DEFAULT_MOCK_JSON_RESPONSES would produce.
 *
 * Milestone 2C: the Deal Memo drafter optionally routes to a server-side
 * OpenAI provider via a browser-side HTTP proxy. Activation requires:
 *   - NEXT_PUBLIC_USE_REAL_LLM=true
 *   - NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST contains "openai"
 *
 * The real OPENAI_API_KEY is consulted only on the server (the route handler);
 * it never reaches the browser. All other roles stay on the mock.
 */
import { createOpenAIProxyProvider } from "./openai-proxy-provider";
import { createAnthropicProxyProvider } from "./anthropic-proxy-provider";

function realModeOn(): boolean {
  const useReal = (process.env.NEXT_PUBLIC_USE_REAL_LLM ?? "false").toLowerCase();
  return useReal === "true" || useReal === "1";
}

function allowlist(): string[] {
  return (process.env.NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function buildAggregateContext(state: core.ProjectState): core.AggregateContext {
  const mockProvider = core.createMockProvider({
    json_responses: buildPlaybookCannedResponses(state),
  });

  // Real-mode provider seams. Each role only escalates when:
  //   1. NEXT_PUBLIC_USE_REAL_LLM is true (build-time switch),
  //   2. its provider id is on NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST.
  // The actual API keys live ONLY on the server; the browser proxy POSTs to
  // the matching /api/agent/<role> route which calls selectProviderByName.
  const allow = realModeOn() ? allowlist() : [];

  const realDealMemoProvider: core.LLMProvider | null = allow.includes("openai")
    ? createOpenAIProxyProvider({
        endpoint: "/api/agent/deal-memo",
        model_id_hint: process.env.NEXT_PUBLIC_OPENAI_MODEL || "openai-remote",
      })
    : null;

  const realCounterpartyProvider: core.LLMProvider | null = allow.includes("anthropic")
    ? createAnthropicProxyProvider({
        endpoint: "/api/agent/counterparty-reviewer",
        model_id_hint: process.env.NEXT_PUBLIC_ANTHROPIC_MODEL || "anthropic-remote",
      })
    : null;

  return {
    provider: mockProvider,
    env_config: core.DEFAULT_ENV_CONFIG, // server is authoritative for real env
    env: makeEnv(),
    actor: DEMO_LAWYER,
    getProvider: (role) => {
      if (role === "deal_memo_drafter" && realDealMemoProvider) {
        return realDealMemoProvider;
      }
      if (role === "counterparty_reviewer" && realCounterpartyProvider) {
        return realCounterpartyProvider;
      }
      return mockProvider;
    },
  };
}

// ---------- Web action wrappers ----------
//
// Sync ops (no agent) — direct pass-through. Async ops (agent-backed) build a
// fresh AggregateContext each call.

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

export function actAddSourceContent(
  state: core.ProjectState,
  args: { source_document_id: string; text_content: string; language?: string | null },
): core.AggregateResult {
  return core.aggAddSourceContent(
    state,
    {
      source_document_id: args.source_document_id,
      text_content: args.text_content,
      language: args.language ?? null,
      is_synthetic: true,
    },
    makeEnv(),
  );
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

// Agent-backed (async) wrappers — each builds a fresh AggregateContext so the
// per-project canned mock responses reflect the latest state.

export async function actDraftDealMemo(state: core.ProjectState): Promise<core.AggregateResult> {
  return core.aggDraftDealMemo(state, buildAggregateContext(state));
}

export function actApproveDealMemo(state: core.ProjectState): core.AggregateResult {
  return core.aggApproveDealMemo(state, DEMO_LAWYER, makeEnv());
}

export async function actDraftDraftingPlan(state: core.ProjectState): Promise<core.AggregateResult> {
  return core.aggDraftDraftingPlan(state, buildAggregateContext(state));
}

export function actApproveDraftingPlan(state: core.ProjectState): core.AggregateResult {
  return core.aggApproveDraftingPlan(state, DEMO_LAWYER, makeEnv());
}

export async function actCreateV0(state: core.ProjectState): Promise<core.AggregateResult> {
  return core.aggCreateV0(state, buildAggregateContext(state));
}

export async function actRunMockReviews(state: core.ProjectState): Promise<core.AggregateResult> {
  return core.aggRunMockReviews(state, buildAggregateContext(state));
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

export async function actCreateRevision(state: core.ProjectState): Promise<core.AggregateResult> {
  return core.aggCreateRevision(state, buildAggregateContext(state));
}

export async function actRunMockFinalQA(state: core.ProjectState): Promise<core.AggregateResult> {
  return core.aggRunMockFinalQA(state, buildAggregateContext(state));
}

export function actApproveFinal(state: core.ProjectState): core.AggregateResult {
  return core.aggApproveFinal(state, DEMO_LAWYER, makeEnv());
}

export function actCreateExport(
  state: core.ProjectState,
  args: { export_type: S.ExportType; content: string; file_name?: string },
): core.AggregateResult {
  return core.aggCreateExport(
    state,
    { ...args, created_by: DEMO_LAWYER },
    makeEnv(),
  );
}

// ---------- Playbook-driven canned mock responses ----------
//
// Build per-call MockProvider responses that derive richer placeholder content
// from the project's current ProjectState. None of this hardcodes any contract
// product name — everything is read from the loaded Playbook.

function rid(prompt_id: string, input_id: string): string {
  return `${prompt_id}::${input_id}`;
}

export function buildPlaybookCannedResponses(
  state: core.ProjectState,
): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  const playbook = state.playbook;
  const project_id = state.project.id;
  const latest = state.contract_versions[state.contract_versions.length - 1];

  if (!playbook) return responses;

  // Deal Memo
  responses[rid("deal_memo_drafter", project_id)] = {
    content: composeDealMemo(state),
    warnings: state.intake_questions
      .filter((q) => q.required)
      .filter((q) => !state.intake_answers.some((a) => a.question_id === q.id))
      .map((q) => `missing intake: ${q.key}`),
  };

  // Drafting Plan
  responses[rid("drafting_plan_drafter", project_id)] = {
    content: composeDraftingPlan(state),
    table_of_contents: playbook.default_table_of_contents,
    is_custom: playbook.is_custom_marker,
    open_questions: [],
  };

  // v0 draft
  responses[rid("contract_drafter", project_id)] = {
    content: composeV0Draft(state),
    version_number: "v0",
    notes: [],
  };

  // Reviewers (only meaningful once a draft exists)
  if (latest) {
    const risks = playbook.common_risks.slice(0, 2);
    const flags = playbook.red_flags.slice(0, 1);

    responses[rid("counterparty_reviewer", latest.id)] = {
      findings: [
        ...risks.slice(0, 1).map((text, i) => ({
          source_agent: "mock_counterparty",
          severity: "high" as const,
          location: { article: `제${i + 3}조` },
          issue_type: "playbook_risk",
          problem: text,
          why_it_matters: `Playbook common_risks #${i + 1}: ${text}`,
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
          why_it_matters: `Playbook red_flags: ${text}`,
          recommended_revision: `Remove or limit: ${text}`,
          business_impact: "high",
          recommended_action: "revise" as const,
        })),
      ],
    };

    responses[rid("source_consistency_reviewer", latest.id)] = {
      findings: risks.slice(1).map((text, i) => ({
        source_agent: "mock_source_consistency",
        severity: "medium" as const,
        location: { article: `제${i + 6}조` },
        issue_type: "source_inconsistency",
        problem: text,
        why_it_matters: "Cross-checked against source documents (mock).",
        recommended_revision: `Reconcile against sources for: ${text}`,
        business_impact: "low",
        recommended_action: "revise" as const,
      })),
    };

    responses[rid("legal_style_reviewer", latest.id)] = {
      findings: [
        {
          source_agent: "mock_legal_style",
          severity: "low" as const,
          location: {},
          issue_type: "numbering",
          problem: "Confirm Korean numbering 제·①·1.·가.",
          why_it_matters: "Korean drafting convention (PLATFORM_BRIEF.md §6).",
          recommended_revision: "Apply Korean article/paragraph/item numbering throughout.",
          business_impact: "low",
          recommended_action: "accept" as const,
        },
      ],
    };

    // Revision: synthesize a body that includes the rendered version + applied cards.
    const accepted = state.issue_cards.filter(
      (c) => c.human_decision === "accepted" || c.human_decision === "partially_accepted",
    );
    responses[rid("revision_agent", latest.id)] = {
      content: composeRevisionBody(state, latest, accepted),
      applied_issue_card_ids: accepted.map((c) => c.issue_id),
      notes: [],
    };

    // Final QA: empty findings by default.
    responses[rid("final_qa_assistant", latest.id)] = {
      findings: [],
      passes: playbook.final_qa_checklist,
    };
  }

  return responses;
}

function composeDealMemo(state: core.ProjectState): string {
  const playbook = state.playbook!;
  const lines: string[] = [];
  lines.push(`# Mock Deal Memo`);
  lines.push(`Project: ${state.project.name}`);
  lines.push(`Contract type: ${playbook.contract_type}`);
  lines.push(``);
  lines.push(`## Source documents (${state.source_documents.length})`);
  for (const d of state.source_documents) {
    const hasContent = state.source_contents.some((c) => c.source_document_id === d.id);
    lines.push(`- [${d.source_type}] ${d.file_name} (v${d.version})${hasContent ? " · content attached" : ""}`);
  }
  lines.push(``);
  lines.push(`## Intake responses`);
  for (const q of state.intake_questions) {
    const a = state.intake_answers.find((x) => x.question_id === q.id);
    lines.push(`- **${q.key}**: ${a?.value ?? "(unanswered)"}`);
  }
  if (playbook.common_risks.length) {
    lines.push(``);
    lines.push(`## Common risks from Playbook`);
    for (const r of playbook.common_risks) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}

function composeDraftingPlan(state: core.ProjectState): string {
  const playbook = state.playbook!;
  const lines: string[] = [];
  lines.push(`# Mock Drafting Plan`);
  lines.push(`Contract type: ${playbook.contract_type}`);
  if (playbook.is_custom_marker) {
    lines.push(`**Mode: Custom Contract — human-approved Drafting Plan required before drafting.**`);
  } else {
    lines.push(`Mode: Standard Playbook`);
  }
  lines.push(``);
  lines.push(`## Table of Contents`);
  if (playbook.default_table_of_contents.length) {
    for (const toc of playbook.default_table_of_contents) lines.push(`- ${toc}`);
  } else {
    lines.push(`- (to be defined ad-hoc)`);
  }
  if (playbook.mandatory_clauses.length) {
    lines.push(``);
    lines.push(`## Mandatory clauses`);
    for (const c of playbook.mandatory_clauses) lines.push(`- ${c.heading} (\`${c.key}\`)`);
  }
  if (playbook.negotiation_positions.length) {
    lines.push(``);
    lines.push(`## Negotiation positions`);
    for (const p of playbook.negotiation_positions) lines.push(`- ${p}`);
  }
  return lines.join("\n");
}

function composeV0Draft(state: core.ProjectState): string {
  const playbook = state.playbook!;
  const toc = playbook.default_table_of_contents;
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
    .map((heading) => `${heading}\n  [Mock body for ${heading} — derived from Playbook + Drafting Plan]`)
    .join("\n\n");
  return `[MOCK v0 DRAFT — ${playbook.contract_type}]\n\n${articles}`;
}

function composeRevisionBody(
  state: core.ProjectState,
  prev: S.ContractVersion,
  appliedCards: S.IssueCard[],
): string {
  const sections = appliedCards.map((c) =>
    c.partial_note
      ? `[Partial revision for ${c.issue_id} (partial_note=${c.partial_note}): ${c.recommended_revision}]`
      : `[Revision for ${c.issue_id}: ${c.recommended_revision}]`,
  );
  if (sections.length === 0) return prev.content;
  return [prev.content, ...sections].join("\n\n");
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
