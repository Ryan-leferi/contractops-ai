import { z } from "zod";
import { actorRoleSchema } from "./actors";
import { idSchema, isoDateTimeSchema } from "./ids";

export const draftingPlanSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  content: z.string(),
  is_custom: z.boolean(),
  approved: z.boolean(),
  approved_by: idSchema.nullable(),
  approved_by_role: actorRoleSchema.nullable(),
  approved_at: isoDateTimeSchema.nullable(),
});
export type DraftingPlan = z.infer<typeof draftingPlanSchema>;
