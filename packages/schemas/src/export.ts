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
  content: z.string(),
  created_at: isoDateTimeSchema,
  created_by: idSchema,
});
export type ExportFile = z.infer<typeof exportFileSchema>;
