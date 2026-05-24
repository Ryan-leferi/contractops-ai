import {
  contractDraftOutputSchema,
  dealMemoDraftOutputSchema,
  draftingPlanOutputSchema,
  finalQAOutputSchema,
  issueCardListOutputSchema,
  revisionOutputSchema,
  type ContractDraftOutput,
  type DealMemoDraftOutput,
  type DraftingPlanOutput,
  type FinalQAOutput,
  type IssueCardListOutput,
  type RevisionOutput,
} from "@contractops/schemas";
import type { Env } from "../env";
import {
  PROMPT_VERSION,
  loadPromptTemplate,
  renderPromptTemplate,
} from "../prompts";
import type { LLMProvider } from "../provider";
import {
  type ContractDrafterInput,
  type DealMemoDrafterInput,
  type DraftingPlanDrafterInput,
  type FinalQAAssistantInput,
  type ReviewerInput,
  type RevisionAgentInput,
} from "./inputs";
import {
  formatContractContent,
  formatIntake,
  formatIssueCards,
  formatPlaybookSummary,
  formatSourceList,
} from "./render";
import { runAgent, type AgentResult } from "./run-agent";

/**
 * Each role function:
 *  1. Renders its prompt from the template + typed inputs (Playbook-driven).
 *  2. Calls the provider via `runAgent` (records an AgentRun).
 *  3. Returns the schema-validated output paired with the AgentRun.
 *
 * Role functions are provider-agnostic — they accept any `LLMProvider`. Tests
 * pass `createMockProvider()`; production will pass a real provider via
 * `selectProvider(envConfig)` in a later milestone.
 */

interface RoleFnOpts<TInput> {
  provider: LLMProvider;
  input: TInput;
  env: Env;
  /** Optional template override for tests that don't want to read from disk. */
  template?: string;
}

function templateFor(prompt_id: string, override?: string): string {
  return override ?? loadPromptTemplate(prompt_id);
}

export async function runDealMemoDrafter(
  opts: RoleFnOpts<DealMemoDrafterInput>,
): Promise<AgentResult<DealMemoDraftOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("deal_memo_drafter", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    source_list: formatSourceList(input.source_documents, input.source_contents),
    intake: formatIntake(input.intake_questions, input.intake_answers),
  });
  return runAgent({
    provider,
    role: "deal_memo_drafter",
    project_id: input.project_id,
    prompt_id: "deal_memo_drafter",
    prompt_version: PROMPT_VERSION,
    input_id: input.project_id,
    prompt,
    schema: dealMemoDraftOutputSchema,
    env,
  });
}

export async function runDraftingPlanDrafter(
  opts: RoleFnOpts<DraftingPlanDrafterInput>,
): Promise<AgentResult<DraftingPlanOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("drafting_plan_drafter", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    intake: formatIntake(input.intake_questions, input.intake_answers),
  });
  return runAgent({
    provider,
    role: "drafting_plan_drafter",
    project_id: input.project_id,
    prompt_id: "drafting_plan_drafter",
    prompt_version: PROMPT_VERSION,
    input_id: input.project_id,
    prompt,
    schema: draftingPlanOutputSchema,
    env,
  });
}

export async function runContractDrafter(
  opts: RoleFnOpts<ContractDrafterInput>,
): Promise<AgentResult<ContractDraftOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("contract_drafter", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    drafting_plan: input.drafting_plan_content,
    source_list: formatSourceList(input.source_documents, input.source_contents),
    intake: formatIntake([], input.intake_answers),
  });
  return runAgent({
    provider,
    role: "contract_drafter",
    project_id: input.project_id,
    prompt_id: "contract_drafter",
    prompt_version: PROMPT_VERSION,
    input_id: input.project_id,
    prompt,
    schema: contractDraftOutputSchema,
    env,
  });
}

export async function runCounterpartyReviewer(
  opts: RoleFnOpts<ReviewerInput>,
): Promise<AgentResult<IssueCardListOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("counterparty_reviewer", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    draft: formatContractContent(input.draft),
  });
  return runAgent({
    provider,
    role: "counterparty_reviewer",
    project_id: input.project_id,
    prompt_id: "counterparty_reviewer",
    prompt_version: PROMPT_VERSION,
    input_id: input.draft.id,
    prompt,
    schema: issueCardListOutputSchema,
    env,
  });
}

export async function runSourceConsistencyReviewer(
  opts: RoleFnOpts<ReviewerInput>,
): Promise<AgentResult<IssueCardListOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("source_consistency_reviewer", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    draft: formatContractContent(input.draft),
    source_list: formatSourceList(input.source_documents, input.source_contents),
  });
  return runAgent({
    provider,
    role: "source_consistency_reviewer",
    project_id: input.project_id,
    prompt_id: "source_consistency_reviewer",
    prompt_version: PROMPT_VERSION,
    input_id: input.draft.id,
    prompt,
    schema: issueCardListOutputSchema,
    env,
  });
}

export async function runLegalStyleReviewer(
  opts: RoleFnOpts<ReviewerInput>,
): Promise<AgentResult<IssueCardListOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("legal_style_reviewer", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    draft: formatContractContent(input.draft),
  });
  return runAgent({
    provider,
    role: "legal_style_reviewer",
    project_id: input.project_id,
    prompt_id: "legal_style_reviewer",
    prompt_version: PROMPT_VERSION,
    input_id: input.draft.id,
    prompt,
    schema: issueCardListOutputSchema,
    env,
  });
}

export async function runRevisionAgent(
  opts: RoleFnOpts<RevisionAgentInput>,
): Promise<AgentResult<RevisionOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("revision_agent", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    previous_version: formatContractContent(input.previous_version),
    accepted_issue_cards: formatIssueCards(input.accepted_issue_cards),
  });
  return runAgent({
    provider,
    role: "revision_agent",
    project_id: input.project_id,
    prompt_id: "revision_agent",
    prompt_version: PROMPT_VERSION,
    input_id: input.previous_version.id,
    prompt,
    schema: revisionOutputSchema,
    env,
  });
}

export async function runFinalQAAssistant(
  opts: RoleFnOpts<FinalQAAssistantInput>,
): Promise<AgentResult<FinalQAOutput>> {
  const { input, provider, env } = opts;
  const tmpl = templateFor("final_qa_assistant", opts.template);
  const prompt = renderPromptTemplate(tmpl, {
    project_id: input.project_id,
    playbook_summary: formatPlaybookSummary(input.playbook),
    version: formatContractContent(input.version),
  });
  return runAgent({
    provider,
    role: "final_qa_assistant",
    project_id: input.project_id,
    prompt_id: "final_qa_assistant",
    prompt_version: PROMPT_VERSION,
    input_id: input.version.id,
    prompt,
    schema: finalQAOutputSchema,
    env,
  });
}
