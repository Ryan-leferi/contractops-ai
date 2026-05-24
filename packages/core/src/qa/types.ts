import type {
  ContractVersion,
  IssueLocation,
  IssueSeverity,
  Playbook,
  SourceDocument,
  SourceDocumentContent,
  SourcePack,
} from "@contractops/schemas";

/**
 * Deterministic-QA engine types.
 *
 * Code-based checks. No LLM, no provider, no network. Every finding is
 * traceable to a specific check_id; runner output also records which checks
 * ran for the AuditLog payload.
 */

export type QACheckId =
  | "forbidden_expressions"
  | "korean_numbering"
  | "cross_references"
  | "amount_format"
  | "date_format"
  | "clean_commentary_leakage"
  | "undefined_terms";

export const ALL_QA_CHECK_IDS: readonly QACheckId[] = [
  "forbidden_expressions",
  "korean_numbering",
  "cross_references",
  "amount_format",
  "date_format",
  "clean_commentary_leakage",
  "undefined_terms",
] as const;

export interface QAFinding {
  check_id: QACheckId;
  severity: IssueSeverity;
  location: IssueLocation;
  /** Short problem description, suitable for the IssueCard.problem field. */
  problem: string;
  why_it_matters: string;
  recommended_revision: string;
  /** Raw matched text (for context — not currently surfaced in IssueCard). */
  matched_text?: string;
  /** 0-indexed offset into the input. Useful for highlighting; not persisted. */
  offset?: number;
}

export interface DeterministicQAInput {
  contract_content: string;
  playbook?: Playbook | null;
  source_pack?: SourcePack | null;
  source_documents?: SourceDocument[];
  source_contents?: SourceDocumentContent[];
  contract_version?: ContractVersion;
  /**
   * Optional. When set, the clean_commentary_leakage check runs against this
   * string in addition to `contract_content`. Used by export-time previews.
   */
  clean_export_content?: string;
}

export interface QACheckExecution {
  check_id: QACheckId;
  finding_count: number;
}

export interface DeterministicQAResult {
  findings: QAFinding[];
  checks_run: QACheckExecution[];
}
