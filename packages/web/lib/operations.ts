/**
 * Operation descriptors (Milestone 3D).
 *
 * Workflow operations are no longer JavaScript closures shipped from the
 * browser; they are serializable `{ name, args }` descriptors POSTed to
 * the server's /api/projects/[id]/operations route. The server dispatches
 * each descriptor to the matching `core.agg*` function, so the workflow
 * logic still lives in @contractops/core and the API route is purely a
 * thin boundary.
 *
 * This file is the single source of truth for the descriptor union and
 * is imported by both the client `act*` builders and the server
 * dispatcher. Both sides MUST agree on the shape — the discriminated
 * union makes it a compile error to forget a case in the dispatcher.
 */
import type * as S from "@contractops/schemas";
import type { IssueDecisionOutcome } from "@contractops/core";

export type Operation =
  | {
      name: "add_source";
      args: {
        file_name: string;
        source_type: S.SourceType;
        version: string;
        incorporated: boolean;
        source_priority: number;
      };
    }
  | {
      name: "add_source_content";
      args: {
        source_document_id: string;
        text_content: string;
        language?: string | null;
      };
    }
  | { name: "lock_source_pack"; args: Record<string, never> }
  | {
      name: "classify_and_confirm";
      args: { confirmed_type: string; hint?: string };
    }
  | { name: "select_playbook"; args: Record<string, never> }
  | { name: "answer_intake"; args: { question_id: string; value: string } }
  | { name: "draft_deal_memo"; args: Record<string, never> }
  | { name: "approve_deal_memo"; args: Record<string, never> }
  | { name: "draft_drafting_plan"; args: Record<string, never> }
  | { name: "approve_drafting_plan"; args: Record<string, never> }
  | { name: "create_v0"; args: Record<string, never> }
  | { name: "run_mock_reviews"; args: Record<string, never> }
  | {
      name: "decide_issue";
      args: {
        issue_id: string;
        decision: IssueDecisionOutcome;
        partial_note?: string;
        reason_note?: string;
      };
    }
  | { name: "run_mock_final_qa"; args: Record<string, never> }
  | { name: "create_revision"; args: Record<string, never> }
  | { name: "approve_final"; args: Record<string, never> }
  | {
      name: "create_export";
      args: { export_type: S.ExportType; content: string; file_name?: string };
    };

export type OperationName = Operation["name"];

export const OPERATION_NAMES: readonly OperationName[] = [
  "add_source",
  "add_source_content",
  "lock_source_pack",
  "classify_and_confirm",
  "select_playbook",
  "answer_intake",
  "draft_deal_memo",
  "approve_deal_memo",
  "draft_drafting_plan",
  "approve_drafting_plan",
  "create_v0",
  "run_mock_reviews",
  "decide_issue",
  "run_mock_final_qa",
  "create_revision",
  "approve_final",
  "create_export",
] as const;

export function isKnownOperationName(name: unknown): name is OperationName {
  return typeof name === "string" && (OPERATION_NAMES as readonly string[]).includes(name);
}
