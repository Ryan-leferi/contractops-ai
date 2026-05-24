import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const auditEventTypeSchema = z.enum([
  "project_created",
  "source_uploaded",
  "source_pack_locked",
  "contract_type_confirmed",
  "playbook_confirmed",
  "deal_memo_approved",
  "drafting_plan_approved",
  "draft_created",
  "issue_card_decided",
  "revision_generated",
  "final_approved",
  "exported",
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditLogSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  actor: idSchema,
  event_type: auditEventTypeSchema,
  ref_id: idSchema,
  timestamp: isoDateTimeSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
