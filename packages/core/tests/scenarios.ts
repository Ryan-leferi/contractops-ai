import type {
  AuditLog,
  ContractType,
  ContractVersion,
  DealMemo,
  DraftingPlan,
  IntakeAnswer,
  IntakeQuestion,
  IssueCard,
  Playbook,
  Project,
  SourceDocument,
  SourcePack,
} from "@contractops/schemas";
import {
  addSourceDocument,
  answerIntakeQuestion,
  approveDealMemo,
  approveDraftingPlan,
  approveFinalVersion,
  classifyContractTypeMock,
  confirmContractType,
  createDealMemo,
  createDraftingPlan,
  createDraftVersion,
  createIssueCards,
  createProject,
  createSourcePack,
  generateRequiredIntakeQuestions,
  lockSourcePack,
  selectPlaybook,
  type Env,
  type IssueCardSeed,
} from "@contractops/core";
import { humanLawyer, loadAllPlaybooks, loadPlaybook, testEnv, user } from "./helpers";

export interface ScenarioState {
  env: Env;
  audits: AuditLog[];
  project: Project;
  source_pack: SourcePack;
  source_documents: SourceDocument[];
  playbooks_available: Playbook[];
  contract_type: ContractType | null;
  playbook: Playbook | null;
  intake_questions: IntakeQuestion[];
  intake_answers: IntakeAnswer[];
  deal_memo: DealMemo | null;
  drafting_plan: DraftingPlan | null;
  v0: ContractVersion | null;
  issue_cards: IssueCard[];
}

export function startScenario(name = "Test project"): ScenarioState {
  const env = testEnv();
  const { project, audit } = createProject({
    name,
    created_by: user,
    env,
  });
  return {
    env,
    audits: [audit],
    project,
    source_pack: createSourcePack({ project_id: project.id, env }),
    source_documents: [],
    playbooks_available: loadAllPlaybooks(),
    contract_type: null,
    playbook: null,
    intake_questions: [],
    intake_answers: [],
    deal_memo: null,
    drafting_plan: null,
    v0: null,
    issue_cards: [],
  };
}

export function addOneSource(state: ScenarioState): ScenarioState {
  const res = addSourceDocument({
    pack: state.source_pack,
    file_name: "proposal.pdf",
    source_type: "proposal",
    version: "1",
    incorporated: true,
    source_priority: 1,
    uploaded_by: user,
    env: state.env,
  });
  return {
    ...state,
    source_pack: res.pack,
    source_documents: [...state.source_documents, res.document],
    audits: [...state.audits, res.audit],
  };
}

export function lockPack(state: ScenarioState): ScenarioState {
  const res = lockSourcePack({
    pack: state.source_pack,
    locked_by: user,
    env: state.env,
  });
  return {
    ...state,
    source_pack: res.pack,
    audits: [...state.audits, res.audit],
  };
}

export function classifyAndConfirm(
  state: ScenarioState,
  confirmedType: string,
  hint?: string,
): ScenarioState {
  const classified = classifyContractTypeMock({
    project_id: state.project.id,
    source_pack: state.source_pack,
    hint,
    env: state.env,
  });
  const { contract_type, audit } = confirmContractType({
    contract_type: classified,
    confirmed_type: confirmedType,
    confirmed_by: humanLawyer,
    env: state.env,
  });
  return { ...state, contract_type, audits: [...state.audits, audit] };
}

export function selectPb(state: ScenarioState): ScenarioState {
  if (!state.contract_type) throw new Error("contract_type missing");
  const { playbook, audit } = selectPlaybook({
    contract_type: state.contract_type,
    available_playbooks: state.playbooks_available,
    selector: humanLawyer,
    env: state.env,
  });
  return { ...state, playbook, audits: [...state.audits, audit] };
}

export function generateIntake(state: ScenarioState): ScenarioState {
  if (!state.playbook) throw new Error("playbook missing");
  const intake_questions = generateRequiredIntakeQuestions({
    project_id: state.project.id,
    playbook: state.playbook,
    env: state.env,
  });
  return { ...state, intake_questions };
}

export function answerAllRequired(state: ScenarioState): ScenarioState {
  const answers = state.intake_questions
    .filter((q) => q.required)
    .map((q) =>
      answerIntakeQuestion({
        question: q,
        value: `answer for ${q.key}`,
        answered_by: user,
        env: state.env,
      }),
    );
  return { ...state, intake_answers: [...state.intake_answers, ...answers] };
}

export function makeDealMemo(state: ScenarioState): ScenarioState {
  const deal_memo = createDealMemo({
    project_id: state.project.id,
    content: "Mock Deal Memo",
    env: state.env,
  });
  return { ...state, deal_memo };
}

export function approveDeal(state: ScenarioState): ScenarioState {
  if (!state.deal_memo) throw new Error("deal_memo missing");
  const { deal_memo, audit } = approveDealMemo({
    deal_memo: state.deal_memo,
    approved_by: humanLawyer,
    required_questions: state.intake_questions,
    answers: state.intake_answers,
    env: state.env,
  });
  return { ...state, deal_memo, audits: [...state.audits, audit] };
}

export function makeDraftingPlan(state: ScenarioState): ScenarioState {
  if (!state.playbook) throw new Error("playbook missing");
  const drafting_plan = createDraftingPlan({
    project_id: state.project.id,
    content: "Mock Drafting Plan",
    playbook: state.playbook,
    env: state.env,
  });
  return { ...state, drafting_plan };
}

export function approvePlan(state: ScenarioState): ScenarioState {
  if (!state.drafting_plan) throw new Error("drafting_plan missing");
  if (!state.deal_memo) throw new Error("deal_memo missing");
  const { plan, audit } = approveDraftingPlan({
    plan: state.drafting_plan,
    deal_memo: state.deal_memo,
    approved_by: humanLawyer,
    env: state.env,
  });
  return { ...state, drafting_plan: plan, audits: [...state.audits, audit] };
}

export function makeV0(state: ScenarioState, content = "BASE CONTRACT TEXT"): ScenarioState {
  if (!state.playbook || !state.deal_memo || !state.drafting_plan) {
    throw new Error("prerequisites missing");
  }
  const v0 = createDraftVersion({
    project_id: state.project.id,
    source_pack: state.source_pack,
    playbook: state.playbook,
    deal_memo: state.deal_memo,
    drafting_plan: state.drafting_plan,
    content,
    env: state.env,
  });
  return { ...state, v0 };
}

export function seedIssues(state: ScenarioState, seeds: Omit<IssueCardSeed, "project_id">[]): ScenarioState {
  const issue_cards = createIssueCards({
    seeds: seeds.map((s) => ({ ...s, project_id: state.project.id })),
    env: state.env,
  });
  return { ...state, issue_cards: [...state.issue_cards, ...issue_cards] };
}

export function approveV0AsFinal(state: ScenarioState): ScenarioState {
  if (!state.v0) throw new Error("v0 missing");
  const { version, audit } = approveFinalVersion({
    version: state.v0,
    approved_by: humanLawyer,
    env: state.env,
  });
  return { ...state, v0: version, audits: [...state.audits, audit] };
}

/** Convenience: build state all the way up to v0 with a real Playbook (NDA by default). */
export function buildToV0(playbookFile = "nda.json"): ScenarioState {
  const pb = loadPlaybook(playbookFile);
  let s = startScenario();
  s = addOneSource(s);
  s = lockPack(s);
  s = classifyAndConfirm(s, pb.contract_type, pb.contract_type);
  s = selectPb(s);
  s = generateIntake(s);
  s = answerAllRequired(s);
  s = makeDealMemo(s);
  s = approveDeal(s);
  s = makeDraftingPlan(s);
  s = approvePlan(s);
  s = makeV0(s);
  return s;
}

// ---------- Aggregate-based scenario helpers (Milestone 1C) ----------

import {
  aggAddSource,
  aggApproveDealMemo,
  aggApproveDraftingPlan,
  aggClassifyAndConfirm,
  aggCreateProject,
  aggCreateV0,
  aggDraftDealMemo,
  aggDraftDraftingPlan,
  aggLockSourcePack,
  aggSelectPlaybook,
  type ProjectState,
} from "@contractops/core";

/**
 * Build a ProjectState (aggregate, no auditLogs field) up through the point
 * just after v0 is created, i.e. ready for mock reviews and Issue Card flow.
 * Returns the state, the env, and any audits emitted.
 */
export function buildToReadyForReviews(playbookFile = "nda.json"): {
  s: ProjectState;
  env: ReturnType<typeof testEnv>;
  audits: import("@contractops/schemas").AuditLog[];
} {
  const env = testEnv();
  const playbooks = loadAllPlaybooks();
  const pb = loadPlaybook(playbookFile);
  const audits: import("@contractops/schemas").AuditLog[] = [];

  const created = aggCreateProject({ name: "Aggregate test", created_by: user }, env);
  audits.push(...created.audits);
  let s = created.state;

  const added = aggAddSource(s, {
    file_name: "proposal.pdf",
    source_type: "proposal",
    version: "1",
    incorporated: true,
    source_priority: 1,
    uploaded_by: user,
  }, env);
  audits.push(...added.audits);
  s = added.state;

  const locked = aggLockSourcePack(s, user, env);
  audits.push(...locked.audits);
  s = locked.state;

  const confirmed = aggClassifyAndConfirm(s, {
    confirmed_type: pb.contract_type,
    confirmed_by: humanLawyer,
    hint: pb.contract_type,
  }, env);
  audits.push(...confirmed.audits);
  s = confirmed.state;

  const selected = aggSelectPlaybook(s, {
    available_playbooks: playbooks,
    selector: humanLawyer,
  }, env);
  audits.push(...selected.audits);
  s = selected.state;

  // Answer every required intake question via direct mutation (aggAnswerIntake
  // is also valid; using direct here is shorter for the test helper).
  for (const q of s.intake_questions.filter((q) => q.required)) {
    s = {
      ...s,
      intake_answers: [
        ...s.intake_answers,
        {
          id: env.newId(),
          project_id: s.project.id,
          question_id: q.id,
          value: `answer for ${q.key}`,
          answered_by: user.id,
          answered_at: env.now(),
        },
      ],
    };
  }

  const draftedMemo = aggDraftDealMemo(s, { content: "memo", drafter: user }, env);
  audits.push(...draftedMemo.audits);
  s = draftedMemo.state;

  const approvedMemo = aggApproveDealMemo(s, humanLawyer, env);
  audits.push(...approvedMemo.audits);
  s = approvedMemo.state;

  const draftedPlan = aggDraftDraftingPlan(s, { content: "plan", drafter: user }, env);
  audits.push(...draftedPlan.audits);
  s = draftedPlan.state;

  const approvedPlan = aggApproveDraftingPlan(s, humanLawyer, env);
  audits.push(...approvedPlan.audits);
  s = approvedPlan.state;

  const v0 = aggCreateV0(s, { content: "[MOCK v0]" }, env);
  audits.push(...v0.audits);
  s = v0.state;

  return { s, env, audits };
}
