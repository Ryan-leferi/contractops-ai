import type {
  AuditLog,
  ContractVersion,
  DealMemo,
  DraftingPlan,
  IssueCard,
  Playbook,
  SourcePack,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface RevisionInputEntry {
  issue_card_id: string;
  recommended_revision: string;
  partial_note: string | null;
}

export interface SkippedIssue {
  issue_card_id: string;
  reason: string;
}

export interface BuildRevisionInputResult {
  inputs: RevisionInputEntry[];
  skipped: SkippedIssue[];
}

export function buildRevisionInputFromIssueCards(
  issue_cards: IssueCard[],
): BuildRevisionInputResult {
  const inputs: RevisionInputEntry[] = [];
  const skipped: SkippedIssue[] = [];
  for (const card of issue_cards) {
    if (card.human_decision === "accepted") {
      inputs.push({
        issue_card_id: card.issue_id,
        recommended_revision: card.recommended_revision,
        partial_note: null,
      });
    } else if (card.human_decision === "partially_accepted") {
      inputs.push({
        issue_card_id: card.issue_id,
        recommended_revision: card.recommended_revision,
        partial_note: card.partial_note,
      });
    } else {
      skipped.push({ issue_card_id: card.issue_id, reason: card.human_decision });
    }
  }
  return { inputs, skipped };
}

export interface CreateRevisionVersionInput {
  project_id: string;
  previous_version: ContractVersion;
  source_pack: SourcePack;
  playbook: Playbook;
  deal_memo: DealMemo;
  drafting_plan: DraftingPlan;
  issue_cards: IssueCard[];
  base_content: string;
  next_version_number: string;
  created_by_agent?: string;
  env: Env;
}

export interface CreateRevisionVersionResult {
  version: ContractVersion;
  updated_issue_cards: IssueCard[];
  applied_issue_card_ids: string[];
  skipped: SkippedIssue[];
  audit: AuditLog;
}

export function createRevisionVersion(
  input: CreateRevisionVersionInput,
): CreateRevisionVersionResult {
  if (!input.source_pack.id) throw errors.missingSourcePackId();
  if (!input.playbook.id) throw errors.missingPlaybookId();
  if (!input.deal_memo.approved) throw errors.dealMemoNotApproved();
  if (!input.drafting_plan.approved) throw errors.draftingPlanNotApproved();

  const { inputs, skipped } = buildRevisionInputFromIssueCards(input.issue_cards);

  const appliedSections = inputs.map((r) =>
    r.partial_note
      ? `[Partial revision for ${r.issue_card_id} (partial_note=${r.partial_note}): ${r.recommended_revision}]`
      : `[Revision for ${r.issue_card_id}: ${r.recommended_revision}]`,
  );
  const content =
    appliedSections.length === 0
      ? input.base_content
      : [input.base_content, ...appliedSections].join("\n\n");

  const now = input.env.now();
  const version: ContractVersion = {
    id: input.env.newId(),
    project_id: input.project_id,
    source_pack_id: input.source_pack.id,
    playbook_id: input.playbook.id,
    version_number: input.next_version_number,
    content,
    created_by_agent: input.created_by_agent ?? "mock_reviser",
    created_at: now,
    final: false,
    final_approved_by: null,
    final_approved_by_role: null,
    final_approved_at: null,
  };

  const appliedIds = new Set(inputs.map((r) => r.issue_card_id));
  const updated_issue_cards = input.issue_cards.map((card) =>
    appliedIds.has(card.issue_id) ? { ...card, applied_version: version.id } : card,
  );

  const audit = createAuditLog({
    project_id: input.project_id,
    actor: "system",
    event_type: "revision_generated",
    ref_id: version.id,
    payload: {
      previous_version_id: input.previous_version.id,
      applied_issue_card_ids: Array.from(appliedIds),
      skipped,
    },
    env: input.env,
  });

  return {
    version,
    updated_issue_cards,
    applied_issue_card_ids: Array.from(appliedIds),
    skipped,
    audit,
  };
}
