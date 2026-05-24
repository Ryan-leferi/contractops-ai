import type {
  AgentRun,
  ContractVersion,
  IssueCard,
  Playbook,
  Project,
} from "@contractops/schemas";
import type { DeterministicQAResult } from "../qa/types";

/**
 * Render targets supported by the export renderer (Milestones 3A + 3B).
 *
 * `clean_docx`         — external, counterparty-facing. MUST contain no
 *                        internal commentary, no rejected Issue Card content.
 * `commentary_docx`    — internal-only. Carries Issue Card decisions,
 *                        deterministic QA summary, AgentRun summary.
 * `negotiation_matrix` — internal-only. Per-issue matrix with decision
 *                        status, response position, and Playbook fallbacks.
 * `cover_email`        — external. Polite Korean business email draft
 *                        (Markdown). Contains NO Issue Card / commentary
 *                        / negotiation content. System never sends.
 */
export type ExportRenderType =
  | "clean_docx"
  | "commentary_docx"
  | "negotiation_matrix"
  | "cover_email";

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
  /**
   * Binary payload — Office Open XML zipped bundle for DOCX outputs, UTF-8
   * Markdown bytes for the cover_email path. Either way the API route
   * streams it back with the matching `mime_type` and a download attachment.
   */
  buffer: Uint8Array;
  /** Suggested filename for the download. Already includes the extension. */
  file_name: string;
  /** MIME type matching the buffer payload. */
  mime_type: string;
}

export interface ExportRenderer {
  renderCleanDocx(input: ExportRenderInput): Promise<ExportRenderResult>;
  renderCommentaryDocx(input: ExportRenderInput): Promise<ExportRenderResult>;
  renderNegotiationMatrix(input: ExportRenderInput): Promise<ExportRenderResult>;
  renderCoverEmail(input: ExportRenderInput): Promise<ExportRenderResult>;
}

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
