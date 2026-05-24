import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

export const agentRoleSchema = z.enum([
  "classifier",
  "deal_memo_drafter",
  "drafting_plan_drafter",
  "drafter",
  "counterparty_reviewer",
  "source_consistency_reviewer",
  "korean_style_reviewer",
  "deterministic_qa",
  "reviser",
  "final_qa",
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentRunStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentRunSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  source_agent: z.string().min(1),
  agent_role: agentRoleSchema,
  mock: z.boolean(),
  mock_prompt_id: z.string().nullable(),
  mock_input_id: z.string().nullable(),
  output_json: z.record(z.string(), z.unknown()),
  status: agentRunStatusSchema,
  created_at: isoDateTimeSchema,
  finished_at: isoDateTimeSchema.nullable(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;
