import { findArticleAtOffset, formatArticleLabel, indexArticles } from "../article-index";
import type { QAFinding } from "../types";

/**
 * KRW amount format consistency check.
 *
 * Recognized styles:
 *   1. "금 1,000,000원"       — preferred for formal contract amounts
 *   2. "1,000,000원"          — numeric without prefix
 *   3. "100만 원" / "5천만 원" — Korean unit expression
 *
 * The check flags MIXED use within a single document. It does not flag pure
 * uniformity (any single style is fine). The recommended style is style 1
 * unless the Playbook overrides.
 */

type StyleId = "formal" | "numeric" | "korean_unit";

interface Match {
  style: StyleId;
  start: number;
  end: number;
  text: string;
}

const PATTERNS: { id: StyleId; re: RegExp }[] = [
  // Longest first so "금 1,000,000원" wins over a bare "1,000,000원".
  { id: "formal", re: /금\s*\d{1,3}(?:,\d{3})+\s*원/g },
  { id: "numeric", re: /\d{1,3}(?:,\d{3})+\s*원/g },
  { id: "korean_unit", re: /\d+\s*(?:천만|백만|만)\s*원/g },
];

const STYLE_LABEL: Record<StyleId, string> = {
  formal: '금 N원 (예: "금 1,000,000원")',
  numeric: 'N원 (예: "1,000,000원")',
  korean_unit: 'N만 원 (예: "100만 원")',
};

export function checkAmountFormat(text: string): QAFinding[] {
  const all: Match[] = [];
  for (const { id, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      all.push({ style: id, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  // Drop shorter matches that overlap an earlier (longer/equal) match.
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: Match[] = [];
  for (const m of all) {
    if (kept.some((k) => m.start < k.end && m.end > k.start)) continue;
    kept.push(m);
  }

  const stylesPresent = new Set(kept.map((m) => m.style));
  if (stylesPresent.size <= 1) return [];

  // Mixed styles. Recommend "formal" unless it's already the only one missing.
  const recommended: StyleId = stylesPresent.has("formal") ? "formal" : "formal";
  const articles = indexArticles(text);
  return kept
    .filter((m) => m.style !== recommended)
    .map((m) => {
      const span = findArticleAtOffset(articles, m.start);
      return {
        check_id: "amount_format" as const,
        severity: "low" as const,
        location: span ? { article: formatArticleLabel(span) } : {},
        problem: `금액 표기 스타일 혼용 (${[...stylesPresent].map((s) => STYLE_LABEL[s]).join(", ")}).`,
        why_it_matters: "같은 문서 내 금액 표기는 일관성이 필요하다 (분쟁 예방).",
        recommended_revision: `"${m.text}" → 권장 스타일 ${STYLE_LABEL[recommended]}로 통일.`,
        matched_text: m.text,
        offset: m.start,
      };
    });
}
