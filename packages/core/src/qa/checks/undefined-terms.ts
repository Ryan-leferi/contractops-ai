import { indexArticles } from "../article-index";
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
 * Rules:
 *   - A term must occur 2+ times to qualify.
 *   - **Definition-clause awareness (Milestone 2E)**: terms defined inside
 *     a definition-titled article (e.g. "제2조 (정의)") are excluded from
 *     flagging. Detection looks for the words "정의" / "용어의 정의" in
 *     the article header, then extracts every quoted token and every
 *     "TERM이란 / TERM이라 함은 / TERM을(를) 말한다" pattern inside that
 *     article.
 *   - Findings are LOW severity: a human lawyer reviews each candidate.
 */

const VOCAB_CANDIDATES = ["Source Pack", "Issue Card", "Deal Memo"] as const;

/**
 * Detect article headers that look like definition clauses.
 *
 * Recognized forms (whitespace-tolerant):
 *   제N조 (정의)
 *   제N조 (용어의 정의)
 *   제N조 [정의]
 *   제N조 「정의」
 *   제N조  정의
 *   제N조 (Definitions)        ← English fallback
 */
const DEFINITION_HEADER_PATTERNS = [
  /제\s*\d+\s*조[^\n]{0,40}?\(\s*(?:용어의\s*)?정\s*의\s*\)/,
  /제\s*\d+\s*조[^\n]{0,40}?\[\s*(?:용어의\s*)?정\s*의\s*\]/,
  /제\s*\d+\s*조[^\n]{0,40}?「\s*(?:용어의\s*)?정\s*의\s*」/,
  /제\s*\d+\s*조[ \t]+(?:용어의\s*)?정\s*의(?:[ \t]|\n|$)/,
  /제\s*\d+\s*조[^\n]{0,40}?\(\s*Definitions?\s*\)/i,
];

function isDefinitionArticle(articleText: string): boolean {
  const firstLine = articleText.split(/\n/, 1)[0] ?? "";
  return DEFINITION_HEADER_PATTERNS.some((re) => re.test(firstLine));
}

/**
 * Extract every term that the definition-article body declares.
 *
 * Patterns recognized (best-effort, conservative):
 *   - quoted: 'TERM'  "TERM"  「TERM」  『TERM』 (any of these quote families)
 *   - bare uppercase: TERM이란 / TERM이라 함은 / TERM을 말한다 / TERM를 말한다
 *
 * Returns a Set of normalized term strings.
 */
function extractDefinedTerms(definitionArticleText: string): Set<string> {
  const terms = new Set<string>();

  // 1. Quoted terms — the most common Korean legal style.
  const quoted = /['"'""「『]([^'"'""「『」』]{1,40})['"'""」』]/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(definitionArticleText)) !== null) {
    const term = m[1]!.trim();
    if (term.length > 0) terms.add(term);
  }

  // 2. Bare uppercase tokens followed by a definition verb.
  //    Catches "SKU란 ...", "BI라 함은 …", "POS를 말한다", etc.
  const bareDef = /([A-Z][A-Z0-9_]{1,8})\s*(?:이?란|이라\s*함은|을\s*말한다|를\s*말한다)/g;
  while ((m = bareDef.exec(definitionArticleText)) !== null) {
    terms.add(m[1]!);
  }

  return terms;
}

/** Count literal occurrences of `needle` in `text`. */
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
  // Discover defined terms by scanning every article that looks like a
  // definition clause. (More than one is rare but possible.)
  const definedTerms = new Set<string>();
  for (const article of indexArticles(text)) {
    if (isDefinitionArticle(article.text)) {
      for (const t of extractDefinedTerms(article.text)) definedTerms.add(t);
    }
  }

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
    if (definedTerms.has(term)) continue; // already in the definition clause
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
    if (definedTerms.has(term)) continue;
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
