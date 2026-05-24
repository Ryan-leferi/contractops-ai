import type { z } from "zod";
import type { AgentRole, AgentRun } from "@contractops/schemas";
import type { Env } from "../env";
import type { LLMProvider } from "../provider";

/**
 * Generic envelope for calling a provider on behalf of a role. Records an
 * AgentRun for the call (success OR failure). Returns the parsed value
 * alongside the AgentRun so the workflow layer can persist the run via
 * an AppendOnlyRepository.
 */

export interface RunAgentInput<T> {
  provider: LLMProvider;
  role: AgentRole;
  project_id: string;
  prompt_id: string;
  prompt_version: string;
  /** Stable id for the input payload (e.g. hash of inputs). Used for replay. */
  input_id?: string;
  prompt: string;
  system?: string;
  schema: z.ZodType<T>;
  env: Env;
}

export interface AgentResult<T> {
  output: T | null;
  agent_run: AgentRun;
}

export async function runAgent<T>(input: RunAgentInput<T>): Promise<AgentResult<T>> {
  const started_at = input.env.now();
  const source_agent = `${input.provider.provider_id}/${input.provider.model_id}`;
  const runId = input.env.newId();

  try {
    const result = await input.provider.completeJson(
      {
        prompt: input.prompt,
        system: input.system,
        prompt_id: input.prompt_id,
        prompt_version: input.prompt_version,
        input_id: input.input_id,
      },
      input.schema,
    );
    const completed_at = input.env.now();
    return {
      output: result.value,
      agent_run: {
        id: runId,
        project_id: input.project_id,
        role: input.role,
        source_agent,
        provider_id: input.provider.provider_id,
        model_id: input.provider.model_id,
        mode: input.provider.mode,
        prompt_version: input.prompt_version,
        input_hash: input.input_id ?? null,
        output_json: result.value as unknown,
        output_text: result.raw_text,
        status: "completed",
        started_at,
        completed_at,
        error_message: null,
        token_usage: result.token_usage,
        cost_estimate: result.cost_estimate,
      },
    };
  } catch (e) {
    const completed_at = input.env.now();
    return {
      output: null,
      agent_run: {
        id: runId,
        project_id: input.project_id,
        role: input.role,
        source_agent,
        provider_id: input.provider.provider_id,
        model_id: input.provider.model_id,
        mode: input.provider.mode,
        prompt_version: input.prompt_version,
        input_hash: input.input_id ?? null,
        output_json: null,
        output_text: null,
        status: "failed",
        started_at,
        completed_at,
        error_message: e instanceof Error ? e.message : String(e),
        token_usage: null,
        cost_estimate: null,
      },
    };
  }
}
