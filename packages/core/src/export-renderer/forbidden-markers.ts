/**
 * Single source of truth for clean/commentary separation (PLATFORM_BRIEF.md
 * §5 rules 6/7 and docs/06_ACCEPTANCE_CRITERIA.md §13).
 *
 * The clean DOCX renderer scrubs its own output against these markers as a
 * final safety net; if any survives, the renderer throws rather than emit
 * a file that could leak internal content to a counterparty.
 *
 * The list is intentionally substring-match — both the Korean "법무주석" and
 * the bracketed English tags appear verbatim inside generated mock content
 * elsewhere in the codebase (see packages/web/lib/actions.ts).
 */
export const CLEAN_FORBIDDEN_MARKERS = [
  "법무주석",
  "[COMMENTARY]",
  "[INTERNAL]",
  "[REDLINE_RATIONALE]",
  "[NEGOTIATION_GUIDANCE]",
  "internal legal commentary",
] as const;

export type CleanForbiddenMarker = (typeof CLEAN_FORBIDDEN_MARKERS)[number];

/**
 * Banner the commentary DOCX prints at the top of page 1 so anyone opening
 * the file in Word sees an unmistakable internal-only marker — Korean and
 * English so both audiences in a typical Korean in-house team understand it.
 */
export const COMMENTARY_INTERNAL_HEADER = "[INTERNAL ONLY — 내부 법무 검토 전용]";

/**
 * Footer string also dropped into the commentary DOCX so downstream search
 * tooling has a second internal-only marker to detect.
 */
export const COMMENTARY_INTERNAL_FOOTER = "[INTERNAL] 외부 송부 금지 — 본 문서는 내부 법무 검토용입니다.";

/**
 * Returns the first forbidden marker found in `text`, or null if none is
 * present. Used both by the renderer's self-check and by tests.
 */
export function findForbiddenMarker(text: string): CleanForbiddenMarker | null {
  for (const m of CLEAN_FORBIDDEN_MARKERS) {
    if (text.includes(m)) return m;
  }
  return null;
}
