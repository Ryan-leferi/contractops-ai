import { describe, expect, it } from "vitest";
import {
  createMockProvider,
  runContractDrafter,
  runCounterpartyReviewer,
  runDealMemoDrafter,
  runDraftingPlanDrafter,
  runFinalQAAssistant,
  runLegalStyleReviewer,
  runRevisionAgent,
  runSourceConsistencyReviewer,
} from "@contractops/core";
import { humanLawyer, loadPlaybook, testEnv, user } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";
import type {
  ContractVersion,
  IntakeAnswer,
  IntakeQuestion,
  IssueCard,
  Playbook,
  SourceDocument,
  SourceDocumentContent,
} from "@contractops/schemas";

/**
 * Each role agent function:
 *   - calls the provider exactly once (via runAgent);
 *   - returns an AgentRun marked mode=mock when the mock provider was passed;
 *   - returns a schema-valid output (or `output:null` + status=failed).
 *
 * The agents intentionally do NOT mutate any aggregate state — they return
 * the output + AgentRun for callers to persist. Aggregate integration is
 * Milestone 2B work.
 */

function makePlaybook(): Playbook {
  return loadPlaybook("nda.json");
}

function tinyTemplate(prompt_id: string): string {
  return `prompt_id=${prompt_id}\nproject={{project_id}}\nplaybook={{playbook_summary}}`;
}

function fakeDraft(project_id: string): ContractVersion {
  return {
    id: "v0_id",
    project_id,
    source_pack_id: "sp_id",
    playbook_id: "pb_id",
    version_number: "v0",
    content: "[mock draft body]",
    created_by_agent: "mock_drafter",
    created_at: "2026-01-01T00:00:00.000Z",
    final: false,
    final_approved_by: null,
    final_approved_by_role: null,
    final_approved_at: null,
  };
}

describe("Role agent functions (provider-agnostic)", () => {
  it("runDealMemoDrafter produces a DealMemoDraftOutput + completed AgentRun", async () => {
    const env = testEnv();
    const provider = createMockProvider();
    const playbook = makePlaybook();
    const res = await runDealMemoDrafter({
      provider,
      env,
      template: tinyTemplate("deal_memo_drafter"),
      input: {
        project_id: "p1",
        playbook,
        source_documents: [],
        source_contents: [],
        intake_questions: [],
        intake_answers: [],
      },
    });
    expect(res.output).not.toBeNull();
    expect(res.output!.content).toBeTruthy();
    expect(res.agent_run.status).toBe("completed");
    expect(res.agent_run.role).toBe("deal_memo_drafter");
    expect(res.agent_run.mode).toBe("mock");
    expect(res.agent_run.provider_id).toBe("mock");
    expect(res.agent_run.prompt_version).toBe("v1");
  });

  it("runDraftingPlanDrafter produces a DraftingPlanOutput", async () => {
    const env = testEnv();
    const provider = createMockProvider();
    const res = await runDraftingPlanDrafter({
      provider,
      env,
      template: tinyTemplate("drafting_plan_drafter"),
      input: {
        project_id: "p1",
        playbook: makePlaybook(),
        intake_questions: [],
        intake_answers: [],
      },
    });
    expect(res.output?.table_of_contents).toEqual([]);
    expect(res.agent_run.role).toBe("drafting_plan_drafter");
  });

  it("runContractDrafter produces a ContractDraftOutput", async () => {
    const env = testEnv();
    const provider = createMockProvider();
    const res = await runContractDrafter({
      provider,
      env,
      template: tinyTemplate("contract_drafter"),
      input: {
        project_id: "p1",
        playbook: makePlaybook(),
        drafting_plan_content: "plan body",
        source_documents: [],
        source_contents: [],
        intake_answers: [],
      },
    });
    expect(res.output?.content).toBeTruthy();
    expect(res.agent_run.role).toBe("contract_drafter");
  });

  it("the three reviewer agents each produce an IssueCardListOutput", async () => {
    const env = testEnv();
    const provider = createMockProvider();
    const playbook = makePlaybook();
    const draft = fakeDraft("p1");
    const reviewerInput = {
      project_id: "p1",
      playbook,
      draft,
      source_documents: [] as SourceDocument[],
      source_contents: [] as SourceDocumentContent[],
    };
    for (const [role, fn] of [
      ["counterparty_reviewer", runCounterpartyReviewer],
      ["source_consistency_reviewer", runSourceConsistencyReviewer],
      ["legal_style_reviewer", runLegalStyleReviewer],
    ] as const) {
      const res = await fn({
        provider,
        env,
        template: tinyTemplate(role),
        input: reviewerInput,
      });
      expect(res.output?.findings).toEqual([]);
      expect(res.agent_run.role).toBe(role);
      expect(res.agent_run.mode).toBe("mock");
    }
  });

  it("runRevisionAgent produces a RevisionOutput", async () => {
    const env = testEnv();
    const provider = createMockProvider();
    const res = await runRevisionAgent({
      provider,
      env,
      template: tinyTemplate("revision_agent"),
      input: {
        project_id: "p1",
        playbook: makePlaybook(),
        previous_version: fakeDraft("p1"),
        accepted_issue_cards: [] as IssueCard[],
      },
    });
    expect(res.output?.content).toBeTruthy();
    expect(res.output?.applied_issue_card_ids).toEqual([]);
    expect(res.agent_run.role).toBe("revision_agent");
  });

  it("runFinalQAAssistant produces a FinalQAOutput", async () => {
    const env = testEnv();
    const provider = createMockProvider();
    const res = await runFinalQAAssistant({
      provider,
      env,
      template: tinyTemplate("final_qa_assistant"),
      input: {
        project_id: "p1",
        playbook: makePlaybook(),
        version: fakeDraft("p1"),
      },
    });
    expect(res.output?.findings).toEqual([]);
    expect(res.agent_run.role).toBe("final_qa_assistant");
  });

  it("returns AgentRun with status=failed and error_message when provider fails", async () => {
    const env = testEnv();
    const provider = createMockProvider({ force_invalid_json: true });
    const res = await runDealMemoDrafter({
      provider,
      env,
      template: tinyTemplate("deal_memo_drafter"),
      input: {
        project_id: "p1",
        playbook: makePlaybook(),
        source_documents: [],
        source_contents: [],
        intake_questions: [],
        intake_answers: [],
      },
    });
    expect(res.output).toBeNull();
    expect(res.agent_run.status).toBe("failed");
    expect(res.agent_run.error_message).toBeTruthy();
  });
});
