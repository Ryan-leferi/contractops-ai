import type { AgentRole, AgentRun, ProviderMode } from "@contractops/schemas";
import type { Env } from "./env";

export interface RecordMockAgentRunInput {
  project_id: string;
  role: AgentRole;
  source_agent: string;
  provider_id?: string;
  model_id?: string;
  prompt_version?: string;
  input_hash?: string;
  output_json?: unknown;
  output_text?: string | null;
}

/**
 * Build a completed AgentRun record for a mock provider call. Used by
 * aggregate ops that want to record provenance for the mock content
 * generators in the web/CLI layer (not the new role agents — those record
 * runs through `runAgent`).
 */
export function recordMockAgentRun(input: RecordMockAgentRunInput & { env: Env }): AgentRun {
  const now = input.env.now();
  const provider_id = input.provider_id ?? "mock";
  const model_id = input.model_id ?? "mock-v1";
  const mode: ProviderMode = "mock";
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    role: input.role,
    source_agent: input.source_agent,
    provider_id,
    model_id,
    mode,
    prompt_version: input.prompt_version ?? null,
    input_hash: input.input_hash ?? null,
    output_json: input.output_json ?? null,
    output_text: input.output_text ?? null,
    status: "completed",
    started_at: now,
    completed_at: now,
    error_message: null,
    token_usage: null,
    cost_estimate: null,
  };
}
