import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const exportTypeSchema = z.enum([
  "clean_docx",
  "commentary_docx",
  "negotiation_matrix",
  "cover_email",
]);
export type ExportType = z.infer<typeof exportTypeSchema>;

export const exportFileSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  contract_version_id: idSchema,
  export_type: exportTypeSchema,
  /**
   * Human-readable summary of what was exported. For DOCX exports (3A) this
   * is a short metadata blurb — the actual binary is generated on demand by
   * the /api/exports/docx route and is NOT persisted in ProjectState (the
   * brief forbids storing binary in localStorage). For non-DOCX exports
   * (cover_email, negotiation_matrix) this is the full content.
   */
  content: z.string(),
  created_at: isoDateTimeSchema,
  created_by: idSchema,
  /**
   * Optional metadata fields added in Milestone 3A. Marked optional so older
   * persisted ExportFile records (from pre-3A sessions still in localStorage)
   * continue to validate.
   */
  file_name: z.string().min(1).optional(),
  source_pack_id: idSchema.optional(),
  playbook_id: idSchema.nullable().optional(),
});
export type ExportFile = z.infer<typeof exportFileSchema>;
