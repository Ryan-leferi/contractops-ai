import { z } from "zod";

export const workflowStatusSchema = z.enum([
  "created",
  "sources_uploaded",
  "source_pack_locked",
  "type_suggested",
  "type_confirmed",
  "playbook_selected",
  "intake_in_progress",
  "deal_memo_drafted",
  "deal_memo_approved",
  "drafting_plan_drafted",
  "drafting_plan_approved",
  "draft_v0_created",
  "reviews_in_progress",
  "issues_open",
  "revised",
  "final_approved",
  "exported",
]);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
