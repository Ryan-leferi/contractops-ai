import type { QAFinding } from "../types";

/**
 * Undefined technical-term candidate extraction.
 *
 * Two surfaces:
 *   - Uppercase ASCII abbreviations of 2–5 letters (SKU, VMD, POP, POS, BI,
 *     RSVP, …).
 *   - A small platform/legal vocab list ("Source Pack", "Issue Card",
 *     "Deal Memo") that often appears in operational documents but is not
 *     contract-defined.
 *
 * Rule: a term must occur 2+ times to qualify (one occurrence is likely a
 * coincidental abbreviation). Definition-clause detection is intentionally
 * left out — too noisy. Findings are LOW severity: a human lawyer reviews
 * and decides whether each candidate needs a definition.
 */

const VOCAB_CANDIDATES = ["Source Pack", "Issue Card", "Deal Memo"] as const;

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(needle, idx + needle.length);
  }
  return count;
}

export function checkUndefinedTerms(text: string): QAFinding[] {
  const findings: QAFinding[] = [];

  // 1. Uppercase ASCII abbreviations.
  const abbrCounts = new Map<string, number>();
  const abbrRe = /\b[A-Z]{2,5}\b/g;
  let m: RegExpExecArray | null;
  while ((m = abbrRe.exec(text)) !== null) {
    const term = m[0];
    abbrCounts.set(term, (abbrCounts.get(term) ?? 0) + 1);
  }
  for (const [term, count] of abbrCounts) {
    if (count < 2) continue;
    findings.push({
      check_id: "undefined_terms",
      severity: "low",
      location: {},
      problem: `약어 "${term}"이(가) 본문에 ${count}회 등장. 정의 절 보유 여부 확인 필요.`,
      why_it_matters: "반복되는 약어는 정의 절에 명시되어야 해석 분쟁을 줄일 수 있다.",
      recommended_revision: `정의 조항에 "${term}"의 의미를 명시.`,
      matched_text: term,
    });
  }

  // 2. Platform/legal vocab.
  for (const term of VOCAB_CANDIDATES) {
    const count = countOccurrences(text, term);
    if (count < 2) continue;
    findings.push({
      check_id: "undefined_terms",
      severity: "low",
      location: {},
      problem: `용어 "${term}"이(가) 본문에 ${count}회 등장. 정의 절 보유 여부 확인 필요.`,
      why_it_matters: "운영 용어가 계약 본문에 정의 없이 반복되면 해석 분쟁의 원인이 될 수 있다.",
      recommended_revision: `정의 조항에 "${term}"의 의미를 명시하거나 본문에서 한국어 용어로 대체.`,
      matched_text: term,
    });
  }

  return findings;
}
