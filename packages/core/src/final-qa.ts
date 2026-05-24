import type { ContractVersion, IssueCard } from "@contractops/schemas";
import type { Env } from "./env";
import { createIssueCards, type IssueCardSeed } from "./issue-card";

export interface RunMockFinalQAInput {
  version: ContractVersion;
  /**
   * Optional list of seed findings for the mock. In real implementations this is replaced
   * by deterministic QA checks (PLATFORM_BRIEF.md §7). Defaults to no findings.
   */
  seeds?: Omit<IssueCardSeed, "project_id" | "source_agent">[];
  env: Env;
}

export interface RunMockFinalQAResult {
  issue_cards: IssueCard[];
}

export function runMockFinalQA(input: RunMockFinalQAInput): RunMockFinalQAResult {
  const seeds = input.seeds ?? [];
  const issue_cards = createIssueCards({
    seeds: seeds.map((s) => ({
      ...s,
      project_id: input.version.project_id,
      source_agent: "mock_final_qa",
    })),
    env: input.env,
  });
  return { issue_cards };
}
