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
  // Pilot P1 — minimum-valid synthesis shape. Per-state overrides
  // produced by `buildPlaybookCannedResponses` (web) preserve the
  // actual pending Issue Card ids; this default is only used when no
  // override matches.
  review_synthesizer: {
    summary: "[MOCK review synthesis — placeholder]",
    priority_ordered_issues: [],
    merged_revision_instructions: [],
    conflicts_between_reviewers: [],
    instructions_for_gpt_revision: "[MOCK revision instructions — placeholder]",
    excluded_or_low_confidence_items: [],
    source_issue_card_ids: [],
  },
  revision_agent: {
    content: "[MOCK revised contract body — placeholder]",
    applied_issue_card_ids: [],
    notes: [],
  },
  final_qa_assistant: { findings: [], passes: [] },
};
