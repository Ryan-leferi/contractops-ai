import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const sourceTypeSchema = z.enum([
  "proposal",
  "email",
  "term_sheet",
  "quote",
  "existing_contract",
  "operation_guide",
  "policy",
  "internal_memo",
  "counterparty_request",
  "redline_draft",
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const sourceDocumentSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  file_name: z.string().min(1),
  upload_date: isoDateTimeSchema,
  source_type: sourceTypeSchema,
  version: z.string(),
  incorporated: z.boolean(),
  source_priority: z.number().int(),
});
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export const sourcePackSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  locked: z.boolean(),
  locked_at: isoDateTimeSchema.nullable(),
  document_ids: z.array(idSchema),
});
export type SourcePack = z.infer<typeof sourcePackSchema>;
