/**
 * Prompt template cache + minimal rendering. Browser-safe — no Node imports.
 *
 * Callers must populate the cache before any agent runs:
 *   - In the web: `PromptsProvider` fetches /api/prompts and calls
 *     `setPromptTemplate` for each.
 *   - In the CLI / vitest: `preloadPromptsFromDisk()` (Node-only helper
 *     defined in tests/CLI) reads the prompts/ directory and calls
 *     `setPromptTemplate`.
 *
 * `loadPromptTemplate` throws if the requested id is not in the cache —
 * deliberately, to force callers to be explicit about template wiring.
 */

const PROMPT_FILES: Record<string, string> = {
  deal_memo_drafter: "deal_memo_drafter.md",
  drafting_plan_drafter: "drafting_plan_drafter.md",
  contract_drafter: "contract_drafter.md",
  counterparty_reviewer: "counterparty_reviewer.md",
  source_consistency_reviewer: "source_consistency_reviewer.md",
  legal_style_reviewer: "legal_style_reviewer.md",
  revision_agent: "revision_agent.md",
  final_qa_assistant: "final_qa_assistant.md",
};

export const PROMPT_FILE_INDEX: Readonly<Record<string, string>> = PROMPT_FILES;

export const PROMPT_VERSION = "v1";

const cache = new Map<string, string>();

export function loadPromptTemplate(prompt_id: string): string {
  const cached = cache.get(prompt_id);
  if (cached !== undefined) return cached;
  if (!(prompt_id in PROMPT_FILES)) {
    throw new Error(`Unknown prompt id: ${prompt_id}`);
  }
  throw new Error(
    `Prompt template "${prompt_id}" not loaded. Call setPromptTemplate or ` +
      `(in Node) preload via a helper that reads from prompts/.`,
  );
}

/** Inject pre-loaded template text. Used by the web's PromptsProvider, tests, and CLI. */
export function setPromptTemplate(prompt_id: string, text: string): void {
  cache.set(prompt_id, text);
}

export function clearPromptCache(): void {
  cache.clear();
}

/**
 * Minimal `{{variable}}` substitution. Unknown variables expand to an empty
 * string (silent — callers inspect the rendered output directly).
 */
export function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    if (!(key in vars)) return "";
    return vars[key] ?? "";
  });
}
