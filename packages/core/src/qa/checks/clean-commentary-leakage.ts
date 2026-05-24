import type { QAFinding } from "../types";

/**
 * Clean-export commentary leakage check.
 *
 * Mirrors the export-layer guard (createExportPlaceholder), but runs at QA
 * time so a leaked marker is caught BEFORE the user clicks "Generate clean
 * export". Two surfaces are inspected:
 *   - the contract body itself (commentary must never live in the contract);
 *   - the optional `clean_export_content` preview passed in.
 *
 * A leaked marker is CRITICAL — PLATFORM_BRIEF.md §5 rule 7.
 */

const MARKERS = [
  "법무주석",
  "[COMMENTARY]",
  "[INTERNAL]",
  "[REDLINE_RATIONALE]",
  "[NEGOTIATION_GUIDANCE]",
] as const;

function scanFor(text: string, source: "contract_body" | "clean_export"): QAFinding[] {
  const findings: QAFinding[] = [];
  for (const marker of MARKERS) {
    let idx = text.indexOf(marker);
    while (idx !== -1) {
      findings.push({
        check_id: "clean_commentary_leakage",
        severity: "critical",
        location: {},
        problem:
          source === "clean_export"
            ? `Clean export 미리보기에 내부 주석 표시 "${marker}" 포함.`
            : `계약 본문에 내부 주석 표시 "${marker}" 포함.`,
        why_it_matters:
          "내부 주석은 외부 송부본에 포함되어서는 안 된다 (PLATFORM_BRIEF.md §5 rule 7).",
        recommended_revision: `"${marker}"를 즉시 제거하고 commentary는 별도 commentary_docx로 분리.`,
        matched_text: marker,
        offset: idx,
      });
      idx = text.indexOf(marker, idx + marker.length);
    }
  }
  return findings;
}

export function checkCleanCommentaryLeakage(
  contractContent: string,
  cleanExportContent?: string,
): QAFinding[] {
  const findings = scanFor(contractContent, "contract_body");
  if (cleanExportContent) findings.push(...scanFor(cleanExportContent, "clean_export"));
  return findings;
}
