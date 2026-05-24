import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

/**
 * SourceDocumentContent — the actual text body of a source document.
 *
 * Separated from SourceDocument (which holds metadata only) so that:
 *   1. metadata can be listed/sorted cheaply without loading content;
 *   2. content can be stored, redacted, or excluded independently;
 *   3. is_synthetic enforces that no real confidential text leaks into tests
 *      or fixtures (PLATFORM_BRIEF.md §10, §12).
 *
 * Keyed by `source_document_id` — there is at most one content record per
 * SourceDocument.
 */
export const sourceContentTypeSchema = z.enum(["text", "markdown"]);
export type SourceContentType = z.infer<typeof sourceContentTypeSchema>;

export const sourceDocumentContentSchema = z.object({
  source_document_id: idSchema,
  project_id: idSchema,
  content_type: sourceContentTypeSchema,
  text_content: z.string(),
  language: z.string().nullable(),
  is_synthetic: z.boolean(),
  created_at: isoDateTimeSchema,
});
export type SourceDocumentContent = z.infer<typeof sourceDocumentContentSchema>;
