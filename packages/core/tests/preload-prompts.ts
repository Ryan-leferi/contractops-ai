/**
 * Side-effect import: when this module loads, every prompt template under
 * `prompts/` is read from disk and registered via `setPromptTemplate`.
 *
 * Test files that exercise the role agents WITHOUT passing a `template:`
 * override should `import "./preload-prompts";` at the top.
 *
 * Browser-incompatible — Node only.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { PROMPT_FILE_INDEX, setPromptTemplate } from "@contractops/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = resolve(__dirname, "../../../prompts");

if (existsSync(promptsDir)) {
  for (const [id, file] of Object.entries(PROMPT_FILE_INDEX)) {
    const full = join(promptsDir, file);
    if (existsSync(full)) {
      setPromptTemplate(id, readFileSync(full, "utf-8"));
    }
  }
}
