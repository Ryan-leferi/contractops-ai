import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
// Static import so the OpenAI-SDK-loading work happens once at file
// evaluation rather than inside individual `await import()` calls (the
// latter can occasionally exceed the 5s test timeout on Windows + Vitest
// workers because the SDK is loaded for the first time inside the test).
import { selectProvider } from "@contractops/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, "../src");
const WEB_SRC = resolve(__dirname, "../../web");

/**
 * Real-LLM SDK imports are tightly scoped:
 *
 *   - `openai` may be imported ONLY from
 *     `packages/core/src/providers/openai-provider.ts` (Milestone 2C).
 *   - `@anthropic-ai/sdk` may be imported ONLY from
 *     `packages/core/src/providers/anthropic-provider.ts` (Milestone 2E).
 *   - Google SDKs MUST NOT be imported anywhere yet.
 *   - The web package MUST NOT import any provider SDK directly — real
 *     calls happen server-side in API routes via the core package.
 */
interface ScopedImportRule {
  pattern: RegExp;
  name: string;
  /** Absolute path of the only file where this import is allowed. */
  allowed_file: string;
}

const SCOPED_IMPORT_RULES: ScopedImportRule[] = [
  {
    pattern: /from\s+["']openai["']/,
    name: "openai",
    allowed_file: resolve(CORE_SRC, "providers/openai-provider.ts"),
  },
  {
    pattern: /require\s*\(\s*["']openai["']\s*\)/,
    name: "require('openai')",
    allowed_file: resolve(CORE_SRC, "providers/openai-provider.ts"),
  },
  {
    pattern: /from\s+["']@anthropic-ai\/sdk["']/,
    name: "@anthropic-ai/sdk",
    allowed_file: resolve(CORE_SRC, "providers/anthropic-provider.ts"),
  },
  {
    pattern: /require\s*\(\s*["']@anthropic-ai\/sdk["']\s*\)/,
    name: "require('@anthropic-ai/sdk')",
    allowed_file: resolve(CORE_SRC, "providers/anthropic-provider.ts"),
  },
];

const FORBIDDEN_NEVER: { pattern: RegExp; name: string }[] = [
  { pattern: /from\s+["']@google\/generative-ai["']/, name: "@google/generative-ai" },
  { pattern: /from\s+["']@google-cloud\//, name: "@google-cloud/*" },
];

function walkTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") return [];
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      return [];
    }
    if (stat.isDirectory()) return walkTsFiles(full);
    if (full.endsWith(".ts") || full.endsWith(".tsx")) return [full];
    return [];
  });
}

describe("Real LLM SDK imports are tightly scoped (Milestone 2E)", () => {
  it("each scoped SDK import appears ONLY in its allowed provider file", () => {
    const files = walkTsFiles(CORE_SRC);
    const violations: { file: string; line: number; name: string; text: string }[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const rule of SCOPED_IMPORT_RULES) {
          if (rule.pattern.test(line) && resolve(file) !== rule.allowed_file) {
            violations.push({
              file: file.replace(CORE_SRC, "packages/core/src"),
              line: i + 1,
              name: rule.name,
              text: line.trim(),
            });
          }
        }
      });
    }
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line} [${v.name}] ${v.text}`)
        .join("\n");
      throw new Error(`Scoped SDK import leaked outside its allowed file:\n${msg}`);
    }
    expect(violations).toEqual([]);
  });

  it("Google SDKs are not imported anywhere in core", () => {
    const files = walkTsFiles(CORE_SRC);
    const violations: { file: string; line: number; match: string; text: string }[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const { pattern, name } of FORBIDDEN_NEVER) {
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
    expect(violations).toEqual([]);
  });

  it("packages/web/* does not import any provider SDK directly", () => {
    const files = walkTsFiles(WEB_SRC);
    // In the web package, no scoped SDK is allowed anywhere — even the
    // scoped-allowed paths point inside core, not the web.
    const allForbidden = [
      ...SCOPED_IMPORT_RULES.map((r) => ({ pattern: r.pattern, name: r.name })),
      ...FORBIDDEN_NEVER,
    ];
    const violations: { file: string; line: number; match: string; text: string }[] = [];
    for (const file of files) {
      if (file.includes("e2e") || file.includes("node_modules") || file.includes(".next")) continue;
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const { pattern, name } of allForbidden) {
          if (pattern.test(line)) {
            violations.push({
              file: file.replace(WEB_SRC, "packages/web"),
              line: i + 1,
              match: name,
              text: line.trim(),
            });
          }
        }
      });
    }
    if (violations.length > 0) {
      const msg = violations.map((v) => `  ${v.file}:${v.line} [${v.match}] ${v.text}`).join("\n");
      throw new Error(`Web package imports a provider SDK directly:\n${msg}`);
    }
    expect(violations).toEqual([]);
  });

  it("selectProvider returns OpenAI when configured for real openai mode", () => {
    const p = selectProvider({
      USE_REAL_LLM: true,
      OPENAI_API_KEY: "sk-fake",
      ANTHROPIC_API_KEY: null,
      GOOGLE_API_KEY: null,
      LLM_PROVIDER_ALLOWLIST: ["openai"],
      OPENAI_MODEL: null,
      ANTHROPIC_MODEL: null,
      LLM_LOG_PROMPTS: false,
    });
    expect(p.provider_id).toBe("openai");
    expect(p.mode).toBe("real");
  });

  it("selectProvider throws when real mode is requested but allowlist is empty", () => {
    expect(() =>
      selectProvider({
        USE_REAL_LLM: true,
        OPENAI_API_KEY: "sk-fake",
        ANTHROPIC_API_KEY: null,
        GOOGLE_API_KEY: null,
        LLM_PROVIDER_ALLOWLIST: [],
        OPENAI_MODEL: null,
        ANTHROPIC_MODEL: null,
        LLM_LOG_PROMPTS: false,
      }),
    ).toThrow();
  });
});
