import { z } from "zod";
import { actorRoleSchema } from "./actors";
import { idSchema, isoDateTimeSchema } from "./ids";

export const contractVersionSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  source_pack_id: idSchema,
  playbook_id: idSchema,
  version_number: z.string().min(1),
  content: z.string(),
  created_by_agent: z.string().min(1),
  created_at: isoDateTimeSchema,
  final: z.boolean(),
  final_approved_by: idSchema.nullable(),
  final_approved_by_role: actorRoleSchema.nullable(),
  final_approved_at: isoDateTimeSchema.nullable(),
});
export type ContractVersion = z.infer<typeof contractVersionSchema>;
