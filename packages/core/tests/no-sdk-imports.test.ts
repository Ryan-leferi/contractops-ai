import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, "../src");

/**
 * Forbidden runtime imports inside packages/core/src. Real LLM SDKs must not
 * be reachable from the workflow core — they belong only to (future) real
 * provider implementations behind the LLMProvider interface, in their own
 * file(s) outside src/ until Milestone 2B wires them up.
 */
const FORBIDDEN_IMPORT_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /from\s+["']openai["']/, name: "openai" },
  { pattern: /from\s+["']@anthropic-ai\//, name: "@anthropic-ai/*" },
  { pattern: /from\s+["']@google\/generative-ai["']/, name: "@google/generative-ai" },
  { pattern: /from\s+["']@google-cloud\//, name: "@google-cloud/*" },
  { pattern: /require\s*\(\s*["']openai["']\s*\)/, name: "require('openai')" },
  { pattern: /require\s*\(\s*["']@anthropic-ai\//, name: "require('@anthropic-ai/*')" },
];

function walkTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkTsFiles(full);
    if (full.endsWith(".ts")) return [full];
    return [];
  });
}

describe("Real LLM SDKs are not imported in core (Milestone 2A guard)", () => {
  it("packages/core/src/* does not import any real LLM SDK", () => {
    const files = walkTsFiles(CORE_SRC);
    const violations: { file: string; line: number; match: string; text: string }[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const { pattern, name } of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: file.replace(CORE_SRC, "packages/core/src"),
              line: i + 1,
              match: name,
              text: line.trim(),
            });
          }
        }
      });
    }
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  [${v.match}]  ${v.text}`)
        .join("\n");
      throw new Error(`Real LLM SDK imports leaked into core:\n${msg}`);
    }
    expect(violations).toEqual([]);
  });

  it("packages/core/src/* does not have a real provider registered for selectProvider", async () => {
    // selectProvider with USE_REAL_LLM=true should throw at this milestone.
    const { selectProvider } = await import("@contractops/core");
    expect(() =>
      selectProvider({
        USE_REAL_LLM: true,
        OPENAI_API_KEY: "sk-fake",
        ANTHROPIC_API_KEY: null,
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: ["openai"],
        LLM_LOG_PROMPTS: false,
      }),
    ).toThrow();
  });
});
