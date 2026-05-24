/**
 * Prompt template loading + minimal rendering.
 *
 * Templates live as Markdown files under `prompts/` at the repo root. They use
 * `{{variable}}` placeholders that are replaced by `renderPromptTemplate`.
 *
 * `loadPromptTemplate` reads from the file system (Node only). Browser
 * callers must inject templates via `setPromptTemplate` first, or pass
 * `template:` directly to the role functions. Node-only modules are
 * lazy-imported inside `loadPromptTemplate` so this module stays browser-safe.
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

export const PROMPT_VERSION = "v1";

const cache = new Map<string, string>();

export function loadPromptTemplate(prompt_id: string): string {
  const cached = cache.get(prompt_id);
  if (cached !== undefined) return cached;
  const file = PROMPT_FILES[prompt_id];
  if (!file) {
    throw new Error(`Unknown prompt id: ${prompt_id}`);
  }
  // Lazy `require` via eval keeps Next.js / webpack from statically
  // resolving node:fs into the client bundle. `loadPromptTemplate` is
  // Node-only; the web injects templates via `setPromptTemplate` or passes
  // `template:` overrides directly.
  const dynamicRequire =
    typeof globalThis === "object" &&
    typeof (globalThis as { require?: unknown }).require === "function"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((globalThis as any).require as NodeJS.Require)
      : // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
        (eval("require") as NodeJS.Require);
  const { readFileSync } = dynamicRequire("node:fs") as typeof import("node:fs");
  const { resolve } = dynamicRequire("node:path") as typeof import("node:path");
  const promptsDir = resolve(process.cwd(), "prompts");
  // Fallback: when running from a workspace package, walk up to the repo root.
  const candidate = resolve(promptsDir, file);
  let text: string;
  try {
    text = readFileSync(candidate, "utf-8");
  } catch {
    // Try repo root from packages/<name>
    const fallback = resolve(process.cwd(), "..", "..", "prompts", file);
    text = readFileSync(fallback, "utf-8");
  }
  cache.set(prompt_id, text);
  return text;
}

/** Inject pre-loaded template text (used by browser/test code). */
export function setPromptTemplate(prompt_id: string, text: string): void {
  cache.set(prompt_id, text);
}

export function clearPromptCache(): void {
  cache.clear();
}

/**
 * Minimal `{{variable}}` substitution. Unknown variables expand to an empty
 * string (silent — tests inspect the rendered output directly).
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
