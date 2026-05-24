import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./ids";

/**
 * Provider execution mode. `mock` is the default everywhere. `real` requires
 * an explicit `USE_REAL_LLM=true` opt-in and a configured provider.
 */
export const providerModeSchema = z.enum(["mock", "real"]);
export type ProviderMode = z.infer<typeof providerModeSchema>;

/**
 * Canonical agent roles. Names follow Milestone 2A spec.
 *
 * `deterministic_qa` is a non-LLM role — it represents the Python QA pass and
 * is included here so AgentRun records can attribute deterministic findings.
 */
export const agentRoleSchema = z.enum([
  "classifier",
  "deal_memo_drafter",
  "drafting_plan_drafter",
  "contract_drafter",
  "counterparty_reviewer",
  "source_consistency_reviewer",
  "legal_style_reviewer",
  "deterministic_qa",
  "revision_agent",
  "final_qa_assistant",
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentRunStatusSchema = z.enum(["pending", "running", "completed", "failed"]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const tokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

/**
 * AgentRun records ONE invocation of an agent (mock or real). Each run is
 * append-friendly — every invocation produces a new record with a fresh id.
 */
export const agentRunSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  role: agentRoleSchema,
  source_agent: z.string().min(1),
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  mode: providerModeSchema,
  prompt_version: z.string().nullable(),
  input_hash: z.string().nullable(),
  output_json: z.unknown().nullable(),
  output_text: z.string().nullable(),
  status: agentRunStatusSchema,
  started_at: isoDateTimeSchema,
  completed_at: isoDateTimeSchema.nullable(),
  error_message: z.string().nullable(),
  token_usage: tokenUsageSchema.nullable(),
  cost_estimate: z.number().nonnegative().nullable(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;
