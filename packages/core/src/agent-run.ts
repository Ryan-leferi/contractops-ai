import type { AgentRole, AgentRun } from "@contractops/schemas";
import type { Env } from "./env";

export interface RecordMockAgentRunInput {
  project_id: string;
  source_agent: string;
  agent_role: AgentRole;
  output: Record<string, unknown>;
  mock_prompt_id?: string;
  mock_input_id?: string;
  env: Env;
}

export function recordMockAgentRun(input: RecordMockAgentRunInput): AgentRun {
  const now = input.env.now();
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    source_agent: input.source_agent,
    agent_role: input.agent_role,
    mock: true,
    mock_prompt_id: input.mock_prompt_id ?? null,
    mock_input_id: input.mock_input_id ?? null,
    output_json: input.output,
    status: "completed",
    created_at: now,
    finished_at: now,
  };
}
