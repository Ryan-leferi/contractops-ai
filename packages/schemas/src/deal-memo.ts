import { z } from "zod";
import { actorRoleSchema } from "./actors";
import { idSchema, isoDateTimeSchema } from "./ids";

export const dealMemoSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  content: z.string(),
  approved: z.boolean(),
  approved_by: idSchema.nullable(),
  approved_by_role: actorRoleSchema.nullable(),
  approved_at: isoDateTimeSchema.nullable(),
});
export type DealMemo = z.infer<typeof dealMemoSchema>;
