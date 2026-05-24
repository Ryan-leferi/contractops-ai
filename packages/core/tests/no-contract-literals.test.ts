import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, "../src");

/**
 * Specific contract-product names that MUST NOT appear in workflow code.
 * Playbook files (under playbooks/) and fixtures (under fixtures/) may
 * legitimately contain these strings as data, but core workflow logic must
 * not branch on or reference any contract type by name. See ADR-003 and
 * ADR-009 in docs/08_ARCHITECTURE_DECISIONS.md.
 *
 * Note: "Custom Contract" is intentionally NOT in this list — it is a generic
 * fallback mode, not a specific contract product.
 */
const FORBIDDEN: { pattern: RegExp; name: string }[] = [
  { pattern: /\bBOF\b/, name: "BOF" },
  { pattern: /\bNDA\b/, name: "NDA" },
  { pattern: /Service Agreement/, name: "Service Agreement" },
  { pattern: /Event Booth Entry/, name: "Event Booth Entry" },
  { pattern: /업무위탁계약/, name: "업무위탁계약" },
  { pattern: /행사\s*부스/, name: "행사 부스" },
  { pattern: /비밀유지계약/, name: "비밀유지계약" },
];

function walkTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walkTsFiles(full);
    if (full.endsWith(".ts")) return [full];
    return [];
  });
}

interface Violation {
  file: string;
  line: number;
  match: string;
  text: string;
}

describe("Generic platform discipline (ADR-003): no contract-type literals in core", () => {
  it("packages/core/src/* does not hardcode any specific contract type", () => {
    const files = walkTsFiles(CORE_SRC);
    const violations: Violation[] = [];

    for (const file of files) {
      const lines = readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const { pattern, name } of FORBIDDEN) {
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
      throw new Error(
        `Contract-type literals leaked into core workflow code (violates ADR-003):\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("scans every .ts file under packages/core/src (not empty)", () => {
    const files = walkTsFiles(CORE_SRC);
    expect(files.length).toBeGreaterThan(5);
  });
});
