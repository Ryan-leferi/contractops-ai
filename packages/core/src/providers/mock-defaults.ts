/**
 * Default canned JSON responses for the MockProvider. Keyed by `prompt_id`.
 *
 * These are minimum-valid structures for each agent role's output schema —
 * they parse cleanly under Zod but contain no actual contract content. Tests
 * and the fixture harness can register richer per-input responders on top.
 *
 * Importantly: no specific contract product names appear here. These shapes
 * are generic across contract types (ADR-003).
 */

export const DEFAULT_MOCK_JSON_RESPONSES: Record<string, unknown> = {
  deal_memo_drafter: {
    content: "[MOCK deal memo body — placeholder]",
    warnings: [],
  },
  drafting_plan_drafter: {
    content: "[MOCK drafting plan body — placeholder]",
    table_of_contents: [],
    is_custom: false,
    open_questions: [],
  },
  contract_drafter: {
    content: "[MOCK contract draft body — placeholder]",
    notes: [],
  },
  counterparty_reviewer: { findings: [] },
  source_consistency_reviewer: { findings: [] },
  legal_style_reviewer: { findings: [] },
  revision_agent: {
    content: "[MOCK revised contract body — placeholder]",
    applied_issue_card_ids: [],
    notes: [],
  },
  final_qa_assistant: { findings: [], passes: [] },
};
