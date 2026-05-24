import { z } from "zod";

export const actorRoleSchema = z.enum(["human_lawyer", "user", "system", "agent"]);
export type ActorRole = z.infer<typeof actorRoleSchema>;

export const actorSchema = z.object({
  id: z.string().min(1),
  role: actorRoleSchema,
  display_name: z.string().optional(),
});
export type Actor = z.infer<typeof actorSchema>;
