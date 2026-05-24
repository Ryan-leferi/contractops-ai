/**
 * Export renderer entry point (Milestones 3A + 3B).
 *
 * Imported via the subpath `@contractops/core/export-renderer` so the heavy
 * `docx` dependency is only ever loaded by server-side code. The browser
 * bundle imports `@contractops/core` (the root) which does NOT re-export
 * this module — that keeps `docx` out of the client.
 *
 * Provider-agnostic: this module imports nothing from any LLM provider, and
 * never opens a network connection. It is pure stream-out of a Document
 * (or Markdown string) into a byte buffer.
 *
 * Four supported render paths:
 *
 *   - clean_docx          → external clean contract (.docx)
 *   - commentary_docx     → internal legal commentary (.docx)
 *   - negotiation_matrix  → internal negotiation matrix (.docx)
 *   - cover_email         → external cover email draft (.md)
 */

export {
  CLEAN_FORBIDDEN_MARKERS,
  COMMENTARY_INTERNAL_FOOTER,
  COMMENTARY_INTERNAL_HEADER,
  findForbiddenMarker,
} from "./forbidden-markers";
export type { CleanForbiddenMarker } from "./forbidden-markers";

export {
  DOCX_MIME_TYPE,
} from "./types";
export type {
  ExportRenderInput,
  ExportRenderResult,
  ExportRenderer,
  ExportRenderType,
} from "./types";

export { buildCleanDocx } from "./build-clean";
export { buildCommentaryDocx } from "./build-commentary";
export { buildNegotiationMatrix } from "./build-negotiation-matrix";
export { buildCoverEmail } from "./build-cover-email";
export { safeFileNamePart } from "./util";

import { buildCleanDocx } from "./build-clean";
import { buildCommentaryDocx } from "./build-commentary";
import { buildNegotiationMatrix } from "./build-negotiation-matrix";
import { buildCoverEmail } from "./build-cover-email";
import type { ExportRenderer } from "./types";

/**
 * Construct the default export renderer with all four render paths wired
 * to the canonical builders. Returned object satisfies the ExportRenderer
 * interface so callers can swap in test doubles without caring whether
 * they're talking to the real `docx` library or a stub.
 */
export function createExportRenderer(): ExportRenderer {
  return {
    renderCleanDocx: buildCleanDocx,
    renderCommentaryDocx: buildCommentaryDocx,
    renderNegotiationMatrix: buildNegotiationMatrix,
    renderCoverEmail: buildCoverEmail,
  };
}
