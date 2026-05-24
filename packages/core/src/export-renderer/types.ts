import type {
  AgentRun,
  ContractVersion,
  IssueCard,
  Playbook,
  Project,
} from "@contractops/schemas";
import type { DeterministicQAResult } from "../qa/types";

/**
 * Render targets supported by the Milestone 3A DOCX renderer.
 *
 * `clean_docx`     — external, counterparty-facing. MUST contain no internal
 *                    commentary, no rejected Issue Card content.
 * `commentary_docx` — internal-only. Carries Issue Card decisions,
 *                    deterministic QA summary, AgentRun summary.
 */
export type ExportRenderType = "clean_docx" | "commentary_docx";

/**
 * Normalized input shape for both render paths. The web API route extracts
 * this from a posted ProjectState rather than the renderer pulling fields
 * itself, so the renderer stays decoupled from ProjectState's shape and is
 * trivially unit-testable.
 *
 * `contract_version` MUST already be the final-approved version — the route
 * verifies this before invoking the renderer.
 */
export interface ExportRenderInput {
  project: Project;
  contract_version: ContractVersion;
  playbook: Playbook | null;
  source_pack_id: string;
  issue_cards: IssueCard[];
  agent_runs: AgentRun[];
  qa_runs: DeterministicQAResult[];
  /** ISO timestamp recorded into the rendered footer / audit metadata. */
  generated_at: string;
}

export interface ExportRenderResult {
  /** Binary `.docx` payload — Office Open XML zipped bundle. */
  buffer: Uint8Array;
  /** Suggested filename for the download. Already includes the `.docx` ext. */
  file_name: string;
  /** Standard wordprocessingml MIME type. */
  mime_type: string;
}

export interface ExportRenderer {
  renderCleanDocx(input: ExportRenderInput): Promise<ExportRenderResult>;
  renderCommentaryDocx(input: ExportRenderInput): Promise<ExportRenderResult>;
}

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
