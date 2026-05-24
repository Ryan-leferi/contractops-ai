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
  ExportType,
  IntakeAnswer,
  IntakeQuestion,
  IssueLocation,
  IssueRecommendedAction,
  IssueSeverity,
  Playbook,
  SourceType,
} from "@contractops/schemas";

import { createAuditLog } from "./audit-log";
import { classifyContractTypeMock, confirmContractType } from "./classify";
import { createDraftVersion, approveFinalVersion } from "./contract-version";
import { approveDealMemo, createDealMemo } from "./deal-memo";
import { approveDraftingPlan, createDraftingPlan } from "./drafting-plan";
import type { Env } from "./env";
import { createExportPlaceholder } from "./export";
import { runMockFinalQA } from "./final-qa";
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
import { assertStatusAtLeast, assertStatusOneOf, withStatus } from "./project-status";
import { createProject } from "./project";
import { createRevisionVersion } from "./revision";
import { recordMockAgentRun } from "./agent-run";
import {
  addSourceDocument,
  createSourcePack,
  lockSourcePack,
} from "./source";
import { emptyProjectState, type ProjectState } from "./state";

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

export interface AggDraftDealMemoInput {
  content: string;
  drafter: Actor;
  source_agent?: string;
}

export function aggDraftDealMemo(
  state: ProjectState,
  input: AggDraftDealMemoInput,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["intake_in_progress"]);
  const deal_memo = createDealMemo({
    project_id: state.project.id,
    content: input.content,
    env,
  });
  const run = recordMockAgentRun({
    project_id: state.project.id,
    source_agent: input.source_agent ?? "mock_gpt",
    role: "deal_memo_drafter",
    output_json: { deal_memo_id: deal_memo.id, length: input.content.length },
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "deal_memo_drafted"),
      deal_memo,
      agent_runs: [...state.agent_runs, run],
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

export interface AggDraftDraftingPlanInput {
  content: string;
  drafter: Actor;
  source_agent?: string;
}

export function aggDraftDraftingPlan(
  state: ProjectState,
  input: AggDraftDraftingPlanInput,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["deal_memo_approved"]);
  if (!state.playbook) throw new Error("playbook missing despite deal_memo_approved status");
  const drafting_plan = createDraftingPlan({
    project_id: state.project.id,
    content: input.content,
    playbook: state.playbook,
    env,
  });
  const run = recordMockAgentRun({
    project_id: state.project.id,
    source_agent: input.source_agent ?? "mock_gpt",
    role: "drafting_plan_drafter",
    output_json: {
      drafting_plan_id: drafting_plan.id,
      is_custom: drafting_plan.is_custom,
    },
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "drafting_plan_drafted"),
      drafting_plan,
      agent_runs: [...state.agent_runs, run],
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

export interface AggCreateV0Input {
  content: string;
  source_agent?: string;
}

export function aggCreateV0(
  state: ProjectState,
  input: AggCreateV0Input,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["drafting_plan_approved"]);
  if (!state.playbook || !state.deal_memo || !state.drafting_plan) {
    throw new Error("prerequisites missing despite drafting_plan_approved status");
  }
  const version = createDraftVersion({
    project_id: state.project.id,
    source_pack: state.source_pack,
    playbook: state.playbook,
    deal_memo: state.deal_memo,
    drafting_plan: state.drafting_plan,
    content: input.content,
    env,
  });
  const run = recordMockAgentRun({
    project_id: state.project.id,
    source_agent: input.source_agent ?? "mock_gpt_drafter",
    role: "contract_drafter",
    output_json: { version_id: version.id, version_number: version.version_number },
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "draft_v0_created"),
      contract_versions: [...state.contract_versions, version],
      agent_runs: [...state.agent_runs, run],
    },
    audits: [],
  };
}

// ---------- Mock reviews ----------

export interface ReviewSeed {
  source_agent: string;
  severity: IssueSeverity;
  location: IssueLocation;
  issue_type: string;
  problem: string;
  why_it_matters: string;
  recommended_revision: string;
  business_impact: string;
  recommended_action: IssueRecommendedAction;
}

export interface AggRunMockReviewsInput {
  seeds: ReviewSeed[];
  /**
   * Which mock providers produced these findings. Used to create one AgentRun
   * per provider for traceability. Defaults to `["mock_claude", "mock_gemini",
   * "mock_korean_style", "mock_python_qa"]`.
   */
  providers?: { source_agent: string; role: "counterparty_reviewer" | "source_consistency_reviewer" | "legal_style_reviewer" | "deterministic_qa" }[];
}

const DEFAULT_PROVIDERS: NonNullable<AggRunMockReviewsInput["providers"]> = [
  { source_agent: "mock_claude", role: "counterparty_reviewer" },
  { source_agent: "mock_gemini", role: "source_consistency_reviewer" },
  { source_agent: "mock_gpt_korean_style", role: "legal_style_reviewer" },
  { source_agent: "mock_python_qa", role: "deterministic_qa" },
];

export function aggRunMockReviews(
  state: ProjectState,
  input: AggRunMockReviewsInput,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["draft_v0_created", "reviews_in_progress", "issues_open"]);
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) throw new Error("no version to review");
  // Advance reviews_in_progress (if we are still at draft_v0_created)
  let project = withStatus(state.project, "reviews_in_progress");

  const cards = createIssueCards({
    seeds: input.seeds.map((s) => ({ ...s, project_id: state.project.id })),
    env,
  });

  const providers = input.providers ?? DEFAULT_PROVIDERS;
  const runs = providers.map((p) =>
    recordMockAgentRun({
      project_id: state.project.id,
      source_agent: p.source_agent,
      role: p.role,
      output_json: {
        version_id: latest.id,
        issue_count: cards.filter((c) => c.source_agent === p.source_agent).length,
      },
      env,
    }),
  );

  project = withStatus(project, "issues_open");

  return {
    state: {
      ...state,
      project,
      issue_cards: [...state.issue_cards, ...cards],
      agent_runs: [...state.agent_runs, ...runs],
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
    env,
  });
  return {
    state: {
      ...state,
      issue_cards: state.issue_cards.map((c) =>
        c.issue_id === input.issue_id ? res.issue_card : c,
      ),
    },
    audits: [res.audit],
  };
}

// ---------- Revision + final QA ----------

export interface AggReviseInput {
  base_content?: string;
  source_agent?: string;
}

export function aggCreateRevision(
  state: ProjectState,
  input: AggReviseInput,
  env: Env,
): AggregateResult {
  assertStatusAtLeast(state.project.status, "issues_open");
  const prev = state.contract_versions[state.contract_versions.length - 1];
  if (!prev) throw new Error("no previous version to revise");
  if (!state.playbook || !state.deal_memo || !state.drafting_plan) {
    throw new Error("prerequisites missing for revision");
  }
  const res = createRevisionVersion({
    project_id: state.project.id,
    previous_version: prev,
    source_pack: state.source_pack,
    playbook: state.playbook,
    deal_memo: state.deal_memo,
    drafting_plan: state.drafting_plan,
    issue_cards: state.issue_cards,
    base_content: input.base_content ?? prev.content,
    next_version_number: `v${state.contract_versions.length}`,
    env,
  });
  const run = recordMockAgentRun({
    project_id: state.project.id,
    source_agent: input.source_agent ?? "mock_reviser",
    role: "revision_agent",
    output_json: {
      version_id: res.version.id,
      applied_issue_card_ids: res.applied_issue_card_ids,
      skipped: res.skipped,
    },
    env,
  });
  return {
    state: {
      ...state,
      project: withStatus(state.project, "revised"),
      contract_versions: [...state.contract_versions, res.version],
      issue_cards: res.updated_issue_cards,
      agent_runs: [...state.agent_runs, run],
    },
    audits: [res.audit],
  };
}

export function aggRunMockFinalQA(
  state: ProjectState,
  env: Env,
): AggregateResult {
  assertStatusOneOf(state.project.status, ["revised", "issues_open"]);
  const latest = state.contract_versions[state.contract_versions.length - 1];
  if (!latest) throw new Error("no version for final QA");
  const res = runMockFinalQA({ version: latest, env, seeds: [] });
  const run = recordMockAgentRun({
    project_id: state.project.id,
    source_agent: "mock_python_qa_final",
    role: "final_qa_assistant",
    output_json: {
      version_id: latest.id,
      findings_count: res.issue_cards.length,
    },
    env,
  });
  return {
    state: {
      ...state,
      issue_cards: [...state.issue_cards, ...res.issue_cards],
      agent_runs: [...state.agent_runs, run],
    },
    audits: [],
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

// Re-export so callers don't need to know which low-level helper to import.
export { type IntakeAnswer, type IntakeQuestion };
