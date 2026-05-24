/**
 * DOCX export renderer entry point (Milestone 3A).
 *
 * Imported via the subpath `@contractops/core/export-renderer` so the heavy
 * `docx` dependency is only ever loaded by server-side code. The browser
 * bundle imports `@contractops/core` (the root) which does NOT re-export
 * this module — that keeps `docx` out of the client.
 *
 * Provider-agnostic: this module imports nothing from any LLM provider, and
 * never opens a network connection. It is pure stream-out of a Document
 * object into a `.docx` byte buffer.
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
export { safeFileNamePart } from "./util";

import { buildCleanDocx } from "./build-clean";
import { buildCommentaryDocx } from "./build-commentary";
import type { ExportRenderer } from "./types";

/**
 * Construct the default DOCX renderer. Returned object satisfies the
 * ExportRenderer interface so callers can swap in test doubles without
 * caring whether they're talking to the real `docx` library or a stub.
 */
export function createDocxRenderer(): ExportRenderer {
  return {
    renderCleanDocx: buildCleanDocx,
    renderCommentaryDocx: buildCommentaryDocx,
  };
}
