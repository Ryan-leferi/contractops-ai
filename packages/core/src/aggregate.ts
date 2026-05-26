/**
 * Aggregate-level operations. Each takes a ProjectState, applies a workflow
 * action, advances Project.status, and returns the new state plus any
 * AuditLog entries the caller must persist into an AppendOnlyRepository.
 *
 * Status guards are explicit (not derived from entity fields), so out-of-order
 * calls fail with a clear `INVALID_TRANSITION` error.
 */
import type {
  Actor,
  AuditLog,
  DraftIteration,
  DraftIterationProviderSummary,
  ExportType,
  Playbook,
  RevisionSynthesisOutput,
  SourceType,
} from "@contractops/schemas";

import { createAuditLog } from "./audit-log";
import { classifyContractTypeMock, confirmContractType } from "./classify";
import { createDraftVersion, approveFinalVersion } from "./contract-version";
import { approveDealMemo, createDealMemo } from "./deal-memo";
import { approveDraftingPlan, createDraftingPlan } from "./drafting-plan";
import type { Env } from "./env";
import { createExportPlaceholder } from "./export";
import {
  answerIntakeQuestion,
  generateRequiredIntakeQuestions,
} from "./intake";
import {
  type IssueDecisionOutcome,
  createIssueCards,
  decideIssueCard,
} from "./issue-card";
import { selectPlaybook } from "./playbook";
import { assertStatusAtLeast, assertStatusOneOf, statusRank, withStatus } from "./project-status";
import { createProject } from "./project";
import { createRevisionVersion } from "./revision";
import {
  addSourceDocument,
  buildSourceContent,
  createSourcePack,
  lockSourcePack,
} from "./source";
import { emptyProjectState, type ProjectState } from "./state";
import { resolveProvider, type AggregateContext } from "./agg-context";
import {
  runContractDrafter,
  runCounterpartyReviewer,
  runDealMemoDrafter,
  runDraftingPlanDrafter,
  runFinalQAAssistant,
  runLegalStyleReviewer,
  runReviewSynthesizer,
  runRevisionAgent,
  runSourceConsistencyReviewer,
} from "./agents/roles";
import type { AgentRun, IssueCardFinding } from "@contractops/schemas";
import { convertQAFindingToIssueCard, runDeterministicQA } from "./qa";

export interface AggregateResult {
  state: ProjectState;
  audits: AuditLog[];
}

// ---------- Project creation ----------

export interface AggCreateProjectInput {
  name: string;
  created_by: Actor;
}

export function aggCreateProject(
  input: AggCreateProjectInput,
  env: Env,
): AggregateResult {
  const { project, audit } = createProject({
    name: input.name,
    created_by: input.created_by,
    env,
  });
  const source_pack = createSourcePack({ project_id: project.id, env });
  return {
    state: emptyProjectState(project, source_pack),
    audits: [audit],
  };
}

// ---------- Sources ----------

export interface AggAddSourceInput {
  file_name: string;
  source_type: SourceType;
  version: string;
  incorporated: boolean;
  source_priority: number;
  uploaded_by: Actor;
}

export function aggAddSource(
  state: ProjectState,
  input: AggAddSourceInput,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["created", "sources_uploaded"]);
  const res = addSourceDocument({
    pack: state.source_pack,
    file_name: input.file_name,
    source_type: input.source_type,
    version: input.version,
    incorporated: input.incorporated,
    source_priority: input.source_priority,
    uploaded_by: input.uploaded_by,
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "sources_uploaded"),
      source_pack: res.pack,
      source_documents: [...state.source_documents, res.document],
    },
    audits: [res.audit],
  };
}

// ---------- Source content ----------

export interface AggAddSourceContentInput {
  source_document_id: string;
  text_content: string;
  language?: string | null;
  is_synthetic?: boolean;
}

/**
 * Attach (or replace) the text body of a SourceDocument. SourceDocumentContent
 * is stored on ProjectState alongside SourceDocument metadata — but the two
 * remain logically distinct entities, keyed independently.
 *
 * Allowed at any pre-final-approval status, including after Source Pack lock:
 * the lock prevents adding or removing documents, but typing the body of an
 * already-uploaded document does not change the pack.
 */
export function aggAddSourceContent(
  state: ProjectState,
  input: AggAddSourceContentInput,
  env: Env,
): AggregateResult {
  assertStatusAtLeast(state.project.status, "sources_uploaded");
  const doc = state.source_documents.find((d) => d.id === input.source_document_id);
  if (!doc) {
    throw new Error(`source document ${input.source_document_id} not found`);
  }
  const content: ReturnType<typeof buildSourceContent> = buildSourceContent({
    source_document_id: input.source_document_id,
    project_id: state.project.id,
    text_content: input.text_content,
    language: input.language ?? null,
    is_synthetic: input.is_synthetic ?? true,
    env,
  });
  const others = state.source_contents.filter(
    (c) => c.source_document_id !== input.source_document_id,
  );
  return {
    state: { ...state, source_contents: [...others, content] },
    audits: [],
  };
}

export function aggLockSourcePack(
  state: ProjectState,
  locked_by: Actor,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["sources_uploaded"]);
  const res = lockSourcePack({
    pack: state.source_pack,
    locked_by,
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "source_pack_locked"),
      source_pack: res.pack,
    },
    audits: [res.audit],
  };
}

// ---------- Contract type + Playbook ----------

export interface AggClassifyAndConfirmInput {
  confirmed_type: string;
  confirmed_by: Actor;
  hint?: string;
}

export function aggClassifyAndConfirm(
  state: ProjectState,
  input: AggClassifyAndConfirmInput,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["source_pack_locked", "type_suggested"]);
  const classified = classifyContractTypeMock({
    project_id: state.project.id,
    source_pack: state.source_pack,
    hint: input.hint,
    env,
  });
  // Advance through type_suggested first, then type_confirmed.
  const suggestedProject = withStatus(state.project, "type_suggested");
  const res = confirmContractType({
    contract_type: classified,
    confirmed_type: input.confirmed_type,
    confirmed_by: input.confirmed_by,
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(suggestedProject, "type_confirmed"),
      contract_type: res.contract_type,
    },
    audits: [res.audit],
  };
}

export interface AggSelectPlaybookInput {
  available_playbooks: Playbook[];
  selector: Actor;
}

export function aggSelectPlaybook(
  state: ProjectState,
  input: AggSelectPlaybookInput,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["type_confirmed"]);
  if (!state.contract_type) {
    // Defensive — should not happen given the status guard above.
    throw new Error("contract_type missing despite type_confirmed status");
  }
  const res = selectPlaybook({
    contract_type: state.contract_type,
    available_playbooks: input.available_playbooks,
    selector: input.selector,
    env,
  });
  const intake_questions = generateRequiredIntakeQuestions({
    project_id: state.project.id,
    playbook: res.playbook,
    env,
  });
  const advanced = withStatus(state.project, "playbook_selected");
  return {
    state: {
      ...state,
      project: withStatus(advanced, "intake_in_progress"),
      playbook: res.playbook,
      intake_questions,
    },
    audits: [res.audit],
  };
}

// ---------- Intake ----------

export interface AggAnswerIntakeInput {
  question_id: string;
  value: string;
  answered_by: Actor;
}

export function aggAnswerIntake(
  state: ProjectState,
  input: AggAnswerIntakeInput,
  env: Env,
): AggregateResult {
  // Permissive: intake answers may be edited any time before the Deal Memo
  // is approved. Once approved, intake is frozen (the approved memo references
  // a snapshot of the answers used for that approval).
  assertStatusOneOf(state.project.status, ["intake_in_progress", "deal_memo_drafted"]);
  const question = state.intake_questions.find((q) => q.id === input.question_id);
  if (!question) throw new Error(`Intake question ${input.question_id} not found`);
  const answer = answerIntakeQuestion({
    question,
    value: input.value,
    answered_by: input.answered_by,
    env,
  });
  const others = state.intake_answers.filter((a) => a.question_id !== input.question_id);
  return {
    state: { ...state, intake_answers: [...others, answer] },
    audits: [],
  };
}

// ---------- Deal Memo ----------

/**
 * Agent-backed draft: calls `runDealMemoDrafter` which calls the provider.
 * Entity content comes from provider output. Exactly one AgentRun is recorded
 * (via runAgent inside the role function — no double recording).
 */
export async function aggDraftDealMemo(
  state: ProjectState,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertStatusOneOf(state.project.status, ["intake_in_progress"]);
  if (!state.playbook) throw new Error("playbook missing despite intake_in_progress status");

  const result = await runDealMemoDrafter({
    provider: resolveProvider(ctx, "deal_memo_drafter"),
    env: ctx.env,
    input: {
      project_id: state.project.id,
      playbook: state.playbook,
      source_documents: state.source_documents,
      source_contents: state.source_contents,
      intake_questions: state.intake_questions,
      intake_answers: state.intake_answers,
    },
  });
  if (!result.output) {
    throw new Error(
      `Deal Memo drafter failed: ${result.agent_run.error_message ?? "unknown error"}`,
    );
  }

  const deal_memo = createDealMemo({
    project_id: state.project.id,
    content: result.output.content,
    env: ctx.env,
  });

  return {
    state: {
      ...state,
      project: withStatus(state.project, "deal_memo_drafted"),
      deal_memo,
      agent_runs: [...state.agent_runs, result.agent_run],
    },
    audits: [],
  };
}

export function aggApproveDealMemo(
  state: ProjectState,
  approved_by: Actor,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["deal_memo_drafted"]);
  if (!state.deal_memo) throw new Error("deal_memo missing despite deal_memo_drafted status");
  const res = approveDealMemo({
    deal_memo: state.deal_memo,
    approved_by,
    required_questions: state.intake_questions,
    answers: state.intake_answers,
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "deal_memo_approved"),
      deal_memo: res.deal_memo,
    },
    audits: [res.audit],
  };
}

// ---------- Drafting Plan ----------

export async function aggDraftDraftingPlan(
  state: ProjectState,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertStatusOneOf(state.project.status, ["deal_memo_approved"]);
  if (!state.playbook) throw new Error("playbook missing despite deal_memo_approved status");

  const result = await runDraftingPlanDrafter({
    provider: resolveProvider(ctx, "drafting_plan_drafter"),
    env: ctx.env,
    input: {
      project_id: state.project.id,
      playbook: state.playbook,
      intake_questions: state.intake_questions,
      intake_answers: state.intake_answers,
    },
  });
  if (!result.output) {
    throw new Error(
      `Drafting Plan drafter failed: ${result.agent_run.error_message ?? "unknown error"}`,
    );
  }

  const drafting_plan = createDraftingPlan({
    project_id: state.project.id,
    content: result.output.content,
    playbook: state.playbook,
    env: ctx.env,
  });

  return {
    state: {
      ...state,
      project: withStatus(state.project, "drafting_plan_drafted"),
      drafting_plan,
      agent_runs: [...state.agent_runs, result.agent_run],
    },
    audits: [],
  };
}

export function aggApproveDraftingPlan(
  state: ProjectState,
  approved_by: Actor,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["drafting_plan_drafted"]);
  if (!state.drafting_plan) throw new Error("drafting_plan missing despite drafting_plan_drafted status");
  if (!state.deal_memo) throw new Error("deal_memo missing despite drafting_plan_drafted status");
  const res = approveDraftingPlan({
    plan: state.drafting_plan,
    deal_memo: state.deal_memo,
    approved_by,
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "drafting_plan_approved"),
      drafting_plan: res.plan,
    },
    audits: [res.audit],
  };
}

// ---------- v0 draft ----------

export async function aggCreateV0(
  state: ProjectState,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertStatusOneOf(state.project.status, ["drafting_plan_approved"]);
  if (!state.playbook || !state.deal_memo || !state.drafting_plan) {
    throw new Error("prerequisites missing despite drafting_plan_approved status");
  }

  const result = await runContractDrafter({
    provider: resolveProvider(ctx, "contract_drafter"),
    env: ctx.env,
    input: {
      project_id: state.project.id,
      playbook: state.playbook,
      drafting_plan_content: state.drafting_plan.content,
      source_documents: state.source_documents,
      source_contents: state.source_contents,
      intake_answers: state.intake_answers,
    },
  });
  if (!result.output) {
    throw new Error(
      `Contract drafter failed: ${result.agent_run.error_message ?? "unknown error"}`,
    );
  }

  const version = createDraftVersion({
    project_id: state.project.id,
    source_pack: state.source_pack,
    playbook: state.playbook,
    deal_memo: state.deal_memo,
    drafting_plan: state.drafting_plan,
    content: result.output.content,
    created_by_agent: result.agent_run.source_agent,
    env: ctx.env,
  });

  // Agent-backed audit: payload carries provider provenance so a lawyer can
  // later distinguish mock-mode and real-mode draft origins.
  const audit = createAuditLog({
    project_id: state.project.id,
    actor: ctx.actor,
    event_type: "draft_created",
    ref_id: version.id,
    payload: {
      version_id: version.id,
      version_number: version.version_number,
      provider_id: result.agent_run.provider_id,
      mode: result.agent_run.mode,
      role: result.agent_run.role,
      agent_run_id: result.agent_run.id,
    },
    env: ctx.env,
  });

  return {
    state: {
      ...state,
      project: withStatus(state.project, "draft_v0_created"),
      contract_versions: [...state.contract_versions, version],
      agent_runs: [...state.agent_runs, result.agent_run],
    },
    audits: [audit],
  };
}

// ---------- Reviews ----------

/**
 * Run all three LLM reviewer agents (counterparty, source consistency, legal
 * style) against the latest contract version. Each reviewer's findings become
 * IssueCards. Exactly one AgentRun per reviewer.
 *
 * `deterministic_qa` (Python) is intentionally NOT invoked here — it is a
 * separate non-LLM pass that will be added in a later milestone.
 */
export async function aggRunMockReviews(
  state: ProjectState,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertStatusOneOf(state.project.status, [
    "draft_v0_created",
    "reviews_in_progress",
    "issues_open",
  ]);
  if (!state.playbook) throw new Error("playbook missing");
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) throw new Error("no version to review");

  let project = withStatus(state.project, "reviews_in_progress");

  const reviewerInput = {
    project_id: state.project.id,
    playbook: state.playbook,
    draft: latest,
    source_documents: state.source_documents,
    source_contents: state.source_contents,
  };

  const [counterRes, sourceRes, styleRes] = await Promise.all([
    runCounterpartyReviewer({
      provider: resolveProvider(ctx, "counterparty_reviewer"),
      env: ctx.env,
      input: reviewerInput,
    }),
    runSourceConsistencyReviewer({
      provider: resolveProvider(ctx, "source_consistency_reviewer"),
      env: ctx.env,
      input: reviewerInput,
    }),
    runLegalStyleReviewer({
      provider: resolveProvider(ctx, "legal_style_reviewer"),
      env: ctx.env,
      input: reviewerInput,
    }),
  ]);

  const allRuns: AgentRun[] = [counterRes.agent_run, sourceRes.agent_run, styleRes.agent_run];
  const allFindings: IssueCardFinding[] = [
    ...(counterRes.output?.findings ?? []),
    ...(sourceRes.output?.findings ?? []),
    ...(styleRes.output?.findings ?? []),
  ];

  const cards = createIssueCards({
    seeds: allFindings.map((f) => ({ ...f, project_id: state.project.id })),
    env: ctx.env,
  });

  project = withStatus(project, "issues_open");

  return {
    state: {
      ...state,
      project,
      issue_cards: [...state.issue_cards, ...cards],
      agent_runs: [...state.agent_runs, ...allRuns],
    },
    audits: [],
  };
}

// ---------- Issue decisions ----------

export interface AggDecideIssueInput {
  issue_id: string;
  decision: IssueDecisionOutcome;
  decided_by: Actor;
  partial_note?: string;
  /**
   * Optional short rationale captured at decision time (Milestone 3C).
   * Persisted to both the IssueCard.reason_note (latest) and to the new
   * decision_history entry. Never required by core; UI may collect it
   * for any decision.
   */
  reason_note?: string;
}

export function aggDecideIssue(
  state: ProjectState,
  input: AggDecideIssueInput,
  env: Env,
): AggregateResult {
  assertStatusAtLeast(state.project.status, "issues_open");
  const card = state.issue_cards.find((c) => c.issue_id === input.issue_id);
  if (!card) throw new Error(`issue ${input.issue_id} not found`);
  const res = decideIssueCard({
    issue_card: card,
    decision: input.decision,
    decided_by: input.decided_by,
    partial_note: input.partial_note,
    reason_note: input.reason_note,
    env,
  });
  return {
    state: {
      ...state,
      issue_cards: state.issue_cards.map((c) =>
        c.issue_id === input.issue_id ? res.issue_card : c,
      ),
      // Append-only: NEVER overwrite, NEVER reorder. The history grows
      // monotonically with every decision change. (PLATFORM_BRIEF.md §12
      // rule 4 — audit trail.)
      decision_history: [...state.decision_history, res.history_entry],
    },
    audits: [res.audit],
  };
}

// ---------- Revision + final QA ----------

/**
 * Agent-backed revision. The Revision Agent applies ONLY accepted /
 * partially-accepted Issue Cards. Rejected and deferred cards are excluded
 * by `createRevisionVersion` (low-level), regardless of what the agent
 * returns. The agent's output content becomes the new version body.
 */
export async function aggCreateRevision(
  state: ProjectState,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertStatusAtLeast(state.project.status, "issues_open");
  const prev = state.contract_versions[state.contract_versions.length - 1];
  if (!prev) throw new Error("no previous version to revise");
  if (!state.playbook || !state.deal_memo || !state.drafting_plan) {
    throw new Error("prerequisites missing for revision");
  }

  const acceptedOrPartial = state.issue_cards.filter(
    (c) => c.human_decision === "accepted" || c.human_decision === "partially_accepted",
  );

  const result = await runRevisionAgent({
    provider: resolveProvider(ctx, "revision_agent"),
    env: ctx.env,
    input: {
      project_id: state.project.id,
      playbook: state.playbook,
      previous_version: prev,
      accepted_issue_cards: acceptedOrPartial,
    },
  });
  if (!result.output) {
    throw new Error(
      `Revision agent failed: ${result.agent_run.error_message ?? "unknown error"}`,
    );
  }

  // Low-level `createRevisionVersion` is the workflow's invariant gate — even
  // if the agent's output suggested applying a rejected card, this layer
  // filters it out. The agent's `applied_issue_card_ids` is informational.
  const res = createRevisionVersion({
    project_id: state.project.id,
    previous_version: prev,
    source_pack: state.source_pack,
    playbook: state.playbook,
    deal_memo: state.deal_memo,
    drafting_plan: state.drafting_plan,
    issue_cards: state.issue_cards,
    base_content: result.output.content,
    next_version_number: `v${state.contract_versions.length}`,
    created_by_agent: result.agent_run.source_agent,
    env: ctx.env,
  });

  // Enhanced revision_generated audit carries provider provenance.
  const enhancedAudit = createAuditLog({
    project_id: state.project.id,
    actor: ctx.actor,
    event_type: "revision_generated",
    ref_id: res.version.id,
    payload: {
      previous_version_id: prev.id,
      applied_issue_card_ids: res.applied_issue_card_ids,
      skipped: res.skipped,
      provider_id: result.agent_run.provider_id,
      mode: result.agent_run.mode,
      role: result.agent_run.role,
      agent_run_id: result.agent_run.id,
    },
    env: ctx.env,
  });

  return {
    state: {
      ...state,
      project: withStatus(state.project, "revised"),
      contract_versions: [...state.contract_versions, res.version],
      issue_cards: res.updated_issue_cards,
      agent_runs: [...state.agent_runs, result.agent_run],
    },
    // Replace the low-level audit (from createRevisionVersion) with the
    // enhanced one. createRevisionVersion's audit lacks provider provenance.
    audits: [enhancedAudit],
  };
}

/**
 * Agent-backed final QA. Findings (if any) become IssueCards and the workflow
 * status stays at `revised` (or `issues_open` if any pending findings remain).
 * The LLM final-QA assistant does NOT replace deterministic Python QA — that
 * is a separate non-LLM pass — see `aggRunDeterministicQA`. `aggRunMockFinalQA`
 * runs deterministic QA FIRST so its findings are always produced even if the
 * LLM call fails.
 */

/**
 * Deterministic-QA aggregate op. Code-based checks only — no LLM, no
 * provider, no AgentRun. Emits a `deterministic_qa_run` audit entry with
 * which checks ran and how many findings each produced.
 *
 * Findings are seeded as IssueCards with source_agent = "deterministic_qa"
 * so the existing decision flow (accept / reject / partially_accept / defer)
 * applies. Rejected cards remain excluded from revision per the workflow's
 * invariants (PLATFORM_BRIEF.md §5 rule 5).
 */
export function aggRunDeterministicQA(
  state: ProjectState,
  env: Env,
  actor: Actor,
): AggregateResult {
  assertStatusAtLeast(state.project.status, "draft_v0_created");
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) throw new Error("no version for deterministic QA");

  const qa = runDeterministicQA({
    contract_content: latest.content,
    playbook: state.playbook,
    source_pack: state.source_pack,
    source_documents: state.source_documents,
    source_contents: state.source_contents,
    contract_version: latest,
  });

  const cards = createIssueCards({
    seeds: qa.findings.map((f) => convertQAFindingToIssueCard(f, state.project.id)),
    env,
  });

  // Advance status to at least `issues_open` so the freshly seeded cards can
  // be decided. If the project is already past `issues_open` (revised, etc.)
  // leave it alone — withStatus is idempotent for that case.
  let project = state.project;
  if (statusRank(project.status) < statusRank("issues_open")) {
    project = withStatus(project, "reviews_in_progress");
    project = withStatus(project, "issues_open");
  }

  const audit = createAuditLog({
    project_id: state.project.id,
    actor,
    event_type: "deterministic_qa_run",
    ref_id: latest.id,
    payload: {
      qa_engine: "deterministic",
      finding_count: qa.findings.length,
      check_ids: qa.checks_run.map((c) => c.check_id),
      per_check: qa.checks_run,
    },
    env,
  });

  return {
    state: {
      ...state,
      project,
      issue_cards: [...state.issue_cards, ...cards],
      qa_runs: [...state.qa_runs, qa],
    },
    audits: [audit],
  };
}

export async function aggRunMockFinalQA(
  state: ProjectState,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertStatusOneOf(state.project.status, ["revised", "issues_open"]);
  if (!state.playbook) throw new Error("playbook missing");
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) throw new Error("no version for final QA");

  // 1. Deterministic QA FIRST. Code-based, no LLM — guaranteed to run even
  // if the LLM call fails. Emits its own audit entry.
  const det = aggRunDeterministicQA(state, ctx.env, ctx.actor);

  // 2. LLM final QA assistant SECOND. Does not replace deterministic QA.
  const result = await runFinalQAAssistant({
    provider: resolveProvider(ctx, "final_qa_assistant"),
    env: ctx.env,
    input: {
      project_id: det.state.project.id,
      playbook: det.state.playbook!,
      version: latest,
    },
  });
  if (!result.output) {
    throw new Error(
      `Final QA assistant failed: ${result.agent_run.error_message ?? "unknown error"}`,
    );
  }

  const llmFindings = result.output.findings;
  const llmCards = createIssueCards({
    seeds: llmFindings.map((f) => ({
      source_agent: result.agent_run.source_agent,
      severity: f.severity,
      location: f.location,
      issue_type: f.issue_type,
      problem: f.problem,
      why_it_matters: f.problem,
      recommended_revision: f.recommended_revision,
      business_impact: "final QA",
      recommended_action: "revise",
      project_id: det.state.project.id,
    })),
    env: ctx.env,
  });

  return {
    state: {
      ...det.state,
      issue_cards: [...det.state.issue_cards, ...llmCards],
      agent_runs: [...det.state.agent_runs, result.agent_run],
    },
    audits: det.audits, // deterministic QA audit only; LLM emits no audit
  };
}

export function aggApproveFinal(
  state: ProjectState,
  approved_by: Actor,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["revised", "draft_v0_created"]);
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) throw new Error("no version to approve");
  const pending = state.issue_cards.filter((c) => c.human_decision === "pending");
  if (pending.length > 0) {
    throw new Error(
      `Cannot approve final while ${pending.length} Issue Card(s) are still pending`,
    );
  }
  const res = approveFinalVersion({
    version: latest,
    approved_by,
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "final_approved"),
      contract_versions: state.contract_versions.map((v) =>
        v.id === latest.id ? res.version : v,
      ),
    },
    audits: [res.audit],
  };
}

// ---------- Exports ----------

export interface AggCreateExportInput {
  export_type: ExportType;
  content: string;
  created_by: Actor;
  /**
   * Optional metadata captured into ExportFile + AuditLog (Milestone 3A).
   * The DOCX exports page passes these from the rendered file so the audit
   * trail records exactly which binary was downloaded.
   */
  file_name?: string;
}

export function aggCreateExport(
  state: ProjectState,
  input: AggCreateExportInput,
  env: Env,
): AggregateResult {
  assertStatusAtLeast(state.project.status, "final_approved");
  const final = state.contract_versions.find((v) => v.final);
  if (!final) throw new Error("no final-approved version to export");
  const res = createExportPlaceholder({
    version: final,
    export_type: input.export_type,
    content: input.content,
    created_by: input.created_by,
    env,
    file_name: input.file_name,
    source_pack_id: final.source_pack_id,
    playbook_id: final.playbook_id,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "exported"),
      exports: [...state.exports, res.file],
    },
    audits: [res.audit],
  };
}

// ════════════════════════════════════════════════════════════════════
// Pilot P1 — Solo Drafting Loop aggregate ops
// ════════════════════════════════════════════════════════════════════
//
// Each op is a thin wrapper around existing aggregate machinery:
//
//   aggCreateDraftIteration    — append a `DraftIteration` receipt to
//                                state.draft_iterations. No agent call.
//                                Lawyer-only.
//   aggSynthesizeReviews       — run the `review_synthesizer` role
//                                against the iteration's pending
//                                Issue Cards + current draft; store the
//                                resulting AgentRun + synthesis output
//                                on the iteration. Lawyer-only.
//   aggBatchAcceptReviewIssues — convenience for the solo lawyer:
//                                accept a chosen subset of pending
//                                Issue Cards in one click. Refuses to
//                                touch CRITICAL cards (they must be
//                                decided one at a time). Lawyer-only;
//                                routes through `decideIssueCard` per
//                                card so decision_history + audit
//                                entries are preserved per card.
//   aggStopDraftLoop           — mark the latest iteration `stopped` so
//                                the loop UI shows "ready for final
//                                review". Pure state transition; no
//                                effect on contract_versions. Lawyer-only.
//
// No new ContractVersion is ever created by these ops. The existing
// `aggCreateV0` / `aggCreateRevision` pipeline is reused by the
// loop UI; these ops only add structure ON TOP, not parallel to.
//
// See ADR-022.

function emptyDraftIterations(state: ProjectState): DraftIteration[] {
  return state.draft_iterations ?? [];
}

function nextIterationNumber(state: ProjectState): number {
  const iters = emptyDraftIterations(state);
  if (iters.length === 0) return 1;
  return Math.max(...iters.map((it) => it.iteration_number)) + 1;
}

function assertLawyer(actor: Actor, op: string): void {
  if (actor.role !== "human_lawyer") {
    throw new Error(`${op} requires human_lawyer actor (got ${actor.role})`);
  }
}

// ---------- 1. Create draft iteration ----------

export interface AggCreateDraftIterationInput {
  /** Optional short note from the lawyer at open time. Currently unused
   * by the schema; reserved for future "why am I starting this round" UX. */
  note?: string;
}

/**
 * Open a new loop iteration. Pins the current latest `ContractVersion`
 * (if any) as the base. Lawyer-only.
 */
export function aggCreateDraftIteration(
  state: ProjectState,
  ctx: AggregateContext,
  _input: AggCreateDraftIterationInput = {},
): AggregateResult {
  assertLawyer(ctx.actor, "aggCreateDraftIteration");
  const iterationNumber = nextIterationNumber(state);
  const latest = state.contract_versions[state.contract_versions.length - 1];
  const iteration: DraftIteration = {
    id: ctx.env.newId(),
    project_id: state.project.id,
    iteration_number: iterationNumber,
    base_contract_version_id: latest ? latest.id : null,
    resulting_contract_version_id: null,
    review_issue_card_ids: [],
    synthesis_agent_run_id: null,
    synthesis_output: null,
    status: latest ? "drafted" : "planned",
    created_at: ctx.env.now(),
    created_by: ctx.actor.id,
    stopped_at: null,
    stop_note: null,
    provider_summary: null,
  };
  const audit = createAuditLog({
    project_id: state.project.id,
    actor: ctx.actor,
    event_type: "draft_iteration_created",
    ref_id: iteration.id,
    payload: {
      iteration_number: iteration.iteration_number,
      base_contract_version_id: iteration.base_contract_version_id,
      status: iteration.status,
    },
    env: ctx.env,
  });
  return {
    state: {
      ...state,
      draft_iterations: [...emptyDraftIterations(state), iteration],
    },
    audits: [audit],
  };
}

// ---------- 2. Synthesize reviews ----------

export interface AggSynthesizeReviewsInput {
  iteration_id: string;
}

/**
 * Run the `review_synthesizer` role against the iteration's pending
 * Issue Cards + current draft. The agent call goes through whatever
 * provider `ctx.getProvider("review_synthesizer")` returns — in P1 the
 * mock provider; a future Gemini provider plugs in via the same seam.
 *
 * Side effects:
 *   - appends an `AgentRun` row;
 *   - updates the iteration record with `synthesis_output` +
 *     `synthesis_agent_run_id`;
 *   - records a `review_issue_card_ids` snapshot of every pending Issue
 *     Card id at synthesis time;
 *   - emits a `draft_iteration_synthesized` audit log.
 *
 * Does NOT create any `ContractVersion`. Does NOT decide Issue Cards.
 */
export async function aggSynthesizeReviews(
  state: ProjectState,
  input: AggSynthesizeReviewsInput,
  ctx: AggregateContext,
): Promise<AggregateResult> {
  assertLawyer(ctx.actor, "aggSynthesizeReviews");
  if (!state.playbook) throw new Error("playbook missing");
  const iteration = emptyDraftIterations(state).find((it) => it.id === input.iteration_id);
  if (!iteration) throw new Error(`draft iteration ${input.iteration_id} not found`);
  if (iteration.status === "stopped") {
    throw new Error(`draft iteration ${input.iteration_id} is already stopped`);
  }
  const draft = state.contract_versions[state.contract_versions.length - 1];
  if (!draft) throw new Error("no draft to synthesize reviews against");

  // Only pending Issue Cards are fed to the synthesizer — already-decided
  // cards reflect the lawyer's authoritative judgment and are excluded
  // from synthesis (synthesis is a recommendation layer, not a re-decider).
  const pending = state.issue_cards.filter((c) => c.human_decision === "pending");

  const result = await runReviewSynthesizer({
    provider: resolveProvider(ctx, "review_synthesizer"),
    env: ctx.env,
    input: {
      project_id: state.project.id,
      iteration_number: iteration.iteration_number,
      playbook: state.playbook,
      draft,
      pending_issue_cards: pending,
    },
  });
  if (!result.output) {
    throw new Error(
      `Review synthesizer failed: ${result.agent_run.error_message ?? "unknown error"}`,
    );
  }

  // Provenance guard: the synthesizer's `source_issue_card_ids` must
  // cover every pending card (LLMs sometimes silently drop items —
  // we'd lose audit traceability if we let that pass).
  const expectedIds = new Set(pending.map((c) => c.issue_id));
  const seenIds = new Set(result.output.source_issue_card_ids);
  for (const id of expectedIds) {
    if (!seenIds.has(id)) {
      throw new Error(
        `synthesizer dropped pending Issue Card ${id} from source_issue_card_ids ` +
          `(provenance broken — refusing to persist synthesis)`,
      );
    }
  }

  const providerSummary: DraftIterationProviderSummary = {
    drafter_provider_id: iteration.provider_summary?.drafter_provider_id ?? null,
    drafter_mode: iteration.provider_summary?.drafter_mode ?? null,
    synthesizer_provider_id: result.agent_run.provider_id,
    synthesizer_mode: result.agent_run.mode,
    reviewer_run_count:
      (iteration.provider_summary?.reviewer_run_count ?? 0) +
      countNewReviewerRuns(state, iteration),
  };

  const updatedIteration: DraftIteration = {
    ...iteration,
    review_issue_card_ids: pending.map((c) => c.issue_id),
    synthesis_agent_run_id: result.agent_run.id,
    synthesis_output: result.output as unknown,
    status: "synthesized",
    provider_summary: providerSummary,
  };

  const audit = createAuditLog({
    project_id: state.project.id,
    actor: ctx.actor,
    event_type: "draft_iteration_synthesized",
    ref_id: iteration.id,
    payload: {
      iteration_number: iteration.iteration_number,
      synthesis_agent_run_id: result.agent_run.id,
      provider_id: result.agent_run.provider_id,
      mode: result.agent_run.mode,
      pending_issue_card_count: pending.length,
    },
    env: ctx.env,
  });

  return {
    state: {
      ...state,
      agent_runs: [...state.agent_runs, result.agent_run],
      draft_iterations: emptyDraftIterations(state).map((it) =>
        it.id === iteration.id ? updatedIteration : it,
      ),
    },
    audits: [audit],
  };
}

function countNewReviewerRuns(state: ProjectState, _iteration: DraftIteration): number {
  return state.agent_runs.filter(
    (r) =>
      r.role === "counterparty_reviewer" ||
      r.role === "source_consistency_reviewer" ||
      r.role === "legal_style_reviewer",
  ).length;
}

// ---------- 3. Batch accept review issues ----------

export interface AggBatchAcceptReviewIssuesInput {
  issue_ids: string[];
  /** Optional shared reason note carried into each appended history entry. */
  reason_note?: string;
}

/**
 * Convenience action for the solo lawyer: accept a chosen list of
 * pending Issue Cards in one click. Each card flows through
 * `aggDecideIssue` so:
 *
 *   - `decision_history` gets ONE append per card (reversible by a
 *     later decision change, NEVER by deletion);
 *   - one `issue_card_decided` audit log per card;
 *   - non-lawyer actors are rejected per `decideIssueCard`.
 *
 * Additionally:
 *
 *   - CRITICAL Issue Cards are REFUSED — the lawyer must decide them
 *     one at a time so a click cannot auto-accept the most dangerous
 *     items.
 *   - Cards already decided (not pending) are silently skipped (the
 *     lawyer's existing decision wins).
 *   - Issue ids that don't exist throw immediately (typo guard).
 *
 * Emits a single summary `review_issues_batch_accepted` audit log on
 * top of the per-card audits so the loop UI has a coarse-grained event
 * to display.
 */
export function aggBatchAcceptReviewIssues(
  state: ProjectState,
  actor: Actor,
  input: AggBatchAcceptReviewIssuesInput,
  env: Env,
): AggregateResult {
  assertLawyer(actor, "aggBatchAcceptReviewIssues");
  if (input.issue_ids.length === 0) {
    throw new Error("aggBatchAcceptReviewIssues: issue_ids must not be empty");
  }

  // Guard: every id must exist; critical cards must not be in the batch.
  for (const id of input.issue_ids) {
    const card = state.issue_cards.find((c) => c.issue_id === id);
    if (!card) throw new Error(`Issue Card ${id} not found`);
    if (card.severity === "critical" && card.human_decision === "pending") {
      throw new Error(
        `Issue Card ${id} is CRITICAL — must be decided individually, not via batch accept`,
      );
    }
  }

  let s = state;
  const allAudits: AuditLog[] = [];
  const acceptedIds: string[] = [];
  const skippedIds: string[] = [];

  for (const id of input.issue_ids) {
    const card = s.issue_cards.find((c) => c.issue_id === id);
    if (!card) continue; // already validated above
    if (card.human_decision !== "pending") {
      skippedIds.push(id);
      continue;
    }
    const res = aggDecideIssue(
      s,
      {
        issue_id: id,
        decision: "accepted",
        decided_by: actor,
        reason_note: input.reason_note,
      },
      env,
    );
    s = res.state;
    allAudits.push(...res.audits);
    acceptedIds.push(id);
  }

  // Coarse-grained summary audit on top of the per-card audits.
  const summaryAudit = createAuditLog({
    project_id: state.project.id,
    actor,
    event_type: "review_issues_batch_accepted",
    ref_id: state.project.id,
    payload: {
      requested_ids: input.issue_ids,
      accepted_ids: acceptedIds,
      skipped_already_decided_ids: skippedIds,
      reason_note: input.reason_note ?? null,
    },
    env,
  });

  return {
    state: s,
    audits: [...allAudits, summaryAudit],
  };
}

// ---------- 4. Stop draft loop ----------

export interface AggStopDraftLoopInput {
  iteration_id: string;
  stop_note?: string;
}

/**
 * Mark the named iteration `stopped`. Convenience signal from the
 * solo lawyer that the loop is done for this project — final approval
 * + exports happen via the existing `aggApproveFinal` / `aggCreateExport`
 * ops. Lawyer-only.
 */
export function aggStopDraftLoop(
  state: ProjectState,
  actor: Actor,
  input: AggStopDraftLoopInput,
  env: Env,
): AggregateResult {
  assertLawyer(actor, "aggStopDraftLoop");
  const iteration = emptyDraftIterations(state).find((it) => it.id === input.iteration_id);
  if (!iteration) throw new Error(`draft iteration ${input.iteration_id} not found`);
  if (iteration.status === "stopped") {
    throw new Error(`draft iteration ${input.iteration_id} is already stopped`);
  }
  const updated: DraftIteration = {
    ...iteration,
    status: "stopped",
    stopped_at: env.now(),
    stop_note: input.stop_note?.trim() ? input.stop_note.trim() : null,
  };
  const audit = createAuditLog({
    project_id: state.project.id,
    actor,
    event_type: "draft_iteration_stopped",
    ref_id: iteration.id,
    payload: {
      iteration_number: iteration.iteration_number,
      stop_note: updated.stop_note,
    },
    env,
  });
  return {
    state: {
      ...state,
      draft_iterations: emptyDraftIterations(state).map((it) =>
        it.id === iteration.id ? updated : it,
      ),
    },
    audits: [audit],
  };
}

// Suppress unused-import lint until the synthesis output type is
// consumed by a downstream helper in P1.5.
void ({} as RevisionSynthesisOutput);

