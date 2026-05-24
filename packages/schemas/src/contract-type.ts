import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const contractTypeSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  suggested_type: z.string().nullable(),
  suggested_confidence: z.number().min(0).max(1).nullable(),
  suggested_at: isoDateTimeSchema.nullable(),
  confirmed_type: z.string().nullable(),
  confirmed_by: idSchema.nullable(),
  confirmed_at: isoDateTimeSchema.nullable(),
  is_confirmed: z.boolean(),
});
export type ContractType = z.infer<typeof contractTypeSchema>;
