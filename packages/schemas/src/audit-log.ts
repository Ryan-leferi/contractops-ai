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
  "deterministic_qa_run",
  "final_approved",
  "exported",
  // Milestone 3L — project membership changes
  "membership_created",
  "membership_disabled",
  // Pilot P1 — Solo Drafting Loop events
  "draft_iteration_created",
  "draft_iteration_synthesized",
  "draft_iteration_stopped",
  "review_issues_batch_accepted",
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
