/**
 * Server-side prompt-template loader (Milestone 3D).
 *
 * The MockProvider and the role-agent runners look up prompt templates by
 * id via `loadPromptTemplate`. Until this milestone the templates were
 * pushed into the registry by the client (it fetches them from
 * `/api/prompts` and calls `setPromptTemplate`). Now that aggregate ops
 * also run server-side (inside `/api/projects/[id]/operations`), the
 * server process needs the same templates pre-registered.
 *
 * Idempotent — calls past the first one are no-ops. Safe to invoke from
 * every server entry point.
 *
 * SERVER ONLY. Uses `node:fs`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_FILE_INDEX, setPromptTemplate } from "@contractops/core";

let loaded = false;

export function ensureServerPromptsLoaded(): void {
  if (loaded) return;
  const dir = findPromptsDir();
  if (!dir) {
    // We deliberately do not throw. The MockProvider's canned responses
    // are keyed on prompt id + input id, so most mock-mode paths work
    // even without the templates; only paths that fall through to
    // `runAgent` with a default template will fail loudly.
    loaded = true;
    return;
  }
  for (const [id, file] of Object.entries(PROMPT_FILE_INDEX)) {
    const full = join(dir, file);
    if (existsSync(full)) {
      setPromptTemplate(id, readFileSync(full, "utf-8"));
    }
  }
  loaded = true;
}

function findPromptsDir(): string | null {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "prompts"),
    join(cwd, "..", "..", "prompts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "prompts");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

// Sanity helper for tests so they can assert the preloader actually ran.
export function debugPromptsLoaded(): boolean {
  return loaded;
}

// Side-effect call for callers that prefer an import-style preload.
ensureServerPromptsLoaded();

// Suppress an unused-readdirSync warning — kept for future expansion to
// scan ad-hoc template overrides under `prompts/local/`.
void readdirSync;
