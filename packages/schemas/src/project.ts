import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";
import { workflowStatusSchema } from "./workflow-status";

export const projectSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  created_at: isoDateTimeSchema,
  created_by: idSchema,
  status: workflowStatusSchema,
});
export type Project = z.infer<typeof projectSchema>;
