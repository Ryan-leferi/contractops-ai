import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  formatContractContent,
  formatIntake,
  formatIssueCards,
  formatPlaybookSummary,
  formatSourceList,
  loadPromptTemplate,
  PROMPT_FILE_INDEX,
  renderPromptTemplate,
} from "@contractops/core";
import { loadPlaybook, testEnv } from "./helpers";
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
 * Render every prompt template against a typical Playbook + intake +
 * source-content fixture. Assertions:
 *   - all known prompt ids load from disk;
 *   - rendered output contains no unresolved `{{...}}` placeholders;
 *   - the rendered text contains no contract-product literals (we use Playbook
 *     contract_type strings — those are data — but we check for any names that
 *     ADR-003 prohibits leaking into platform code).
 */

function makeFixture(): {
  playbook: Playbook;
  source_documents: SourceDocument[];
  source_contents: SourceDocumentContent[];
  intake_questions: IntakeQuestion[];
  intake_answers: IntakeAnswer[];
  draft: ContractVersion;
  issue_cards: IssueCard[];
} {
  const playbook = loadPlaybook("event-booth-entry.json");
  const env = testEnv();
  const source_documents: SourceDocument[] = [
    {
      id: "doc1",
      project_id: "p1",
      file_name: "synthetic_proposal.pdf",
      upload_date: env.now(),
      source_type: "proposal",
      version: "1",
      incorporated: true,
      source_priority: 1,
    },
  ];
  const source_contents: SourceDocumentContent[] = [
    {
      source_document_id: "doc1",
      project_id: "p1",
      content_type: "text",
      text_content: "[synthetic] proposal body for fixture",
      language: "ko",
      is_synthetic: true,
      created_at: env.now(),
    },
  ];
  const intake_questions: IntakeQuestion[] = playbook.required_intake_questions.map((q, i) => ({
    id: `q${i}`,
    project_id: "p1",
    playbook_id: playbook.id,
    key: q.key,
    text: q.text,
    required: q.required,
  }));
  const intake_answers: IntakeAnswer[] = intake_questions.map((q) => ({
    id: `a-${q.id}`,
    project_id: "p1",
    question_id: q.id,
    value: `answer for ${q.key}`,
    answered_by: "user_demo",
    answered_at: env.now(),
  }));
  const draft: ContractVersion = {
    id: "v0",
    project_id: "p1",
    source_pack_id: "sp1",
    playbook_id: playbook.id,
    version_number: "v0",
    content: "[mock draft body]",
    created_by_agent: "mock_drafter",
    created_at: env.now(),
    final: false,
    final_approved_by: null,
    final_approved_by_role: null,
    final_approved_at: null,
  };
  const issue_cards: IssueCard[] = [];
  return {
    playbook,
    source_documents,
    source_contents,
    intake_questions,
    intake_answers,
    draft,
    issue_cards,
  };
}

describe("Prompt template rendering", () => {
  it("every known prompt template loads from disk", () => {
    for (const id of Object.keys(PROMPT_FILE_INDEX)) {
      const text = loadPromptTemplate(id);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("renders each template with no unresolved {{...}} placeholders", () => {
    const fx = makeFixture();
    const allVars: Record<string, string> = {
      project_id: "p1",
      playbook_summary: formatPlaybookSummary(fx.playbook),
      source_list: formatSourceList(fx.source_documents, fx.source_contents),
      intake: formatIntake(fx.intake_questions, fx.intake_answers),
      drafting_plan: "[mock drafting plan body]",
      draft: formatContractContent(fx.draft),
      previous_version: formatContractContent(fx.draft),
      accepted_issue_cards: formatIssueCards(fx.issue_cards),
      version: formatContractContent(fx.draft),
    };
    for (const id of Object.keys(PROMPT_FILE_INDEX)) {
      const template = loadPromptTemplate(id);
      const rendered = renderPromptTemplate(template, allVars);
      const remaining = rendered.match(/{{\s*[\w.]+\s*}}/g);
      expect(remaining, `unresolved placeholders in ${id}: ${JSON.stringify(remaining)}`).toBeNull();
    }
  });

  it("rendered prompts contain no specific contract-product names (ADR-003)", () => {
    const fx = makeFixture();
    const allVars: Record<string, string> = {
      project_id: "p1",
      playbook_summary: formatPlaybookSummary(fx.playbook),
      source_list: formatSourceList(fx.source_documents, fx.source_contents),
      intake: formatIntake(fx.intake_questions, fx.intake_answers),
      drafting_plan: "[mock drafting plan body]",
      draft: formatContractContent(fx.draft),
      previous_version: formatContractContent(fx.draft),
      accepted_issue_cards: formatIssueCards(fx.issue_cards),
      version: formatContractContent(fx.draft),
    };

    // Substrings that must not appear in the static template body.
    // (Playbook data legitimately contains contract_type strings; those flow
    // through `{{playbook_summary}}` as data and are allowed.)
    const forbiddenInStaticBody = [/\bBOF\b/, /\bNDA\b/, /Service Agreement/];

    for (const id of Object.keys(PROMPT_FILE_INDEX)) {
      const template = loadPromptTemplate(id);
      // Body = template with placeholders removed entirely
      const staticBody = template.replace(/{{\s*[\w.]+\s*}}/g, "");
      for (const re of forbiddenInStaticBody) {
        expect(re.test(staticBody), `${id} static body contains ${re}`).toBe(false);
      }
      // Sanity: the rendered output isn't empty
      const rendered = renderPromptTemplate(template, allVars);
      expect(rendered.length).toBeGreaterThan(50);
    }
  });
});
