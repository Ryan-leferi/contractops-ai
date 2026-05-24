import { findArticleAtOffset, formatArticleLabel, indexArticles } from "../article-index";
import type { QAFinding } from "../types";

/**
 * Date format consistency check.
 *
 * Recognized styles:
 *   - "2026. 6. 19."        (dot + spaces)
 *   - "2026년 6월 19일"     (Korean explicit)
 *   - "2026.06.19"          (compact, no spaces)
 *
 * Flag MIXED use within a single document. Pure consistency is fine.
 * No deadline arithmetic in this milestone.
 */

type DateStyleId = "dot_spaced" | "korean_explicit" | "compact_dot";

interface Match {
  style: DateStyleId;
  start: number;
  end: number;
  text: string;
}

const PATTERNS: { id: DateStyleId; re: RegExp }[] = [
  // Longest/most specific first.
  { id: "korean_explicit", re: /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g },
  { id: "dot_spaced", re: /\d{4}\.\s+\d{1,2}\.\s+\d{1,2}\./g },
  { id: "compact_dot", re: /\d{4}\.\d{1,2}\.\d{1,2}(?!\d)/g },
];

const STYLE_LABEL: Record<DateStyleId, string> = {
  dot_spaced: '"2026. 6. 19."',
  korean_explicit: '"2026년 6월 19일"',
  compact_dot: '"2026.06.19"',
};

export function checkDateFormat(text: string): QAFinding[] {
  const all: Match[] = [];
  for (const { id, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      all.push({ style: id, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: Match[] = [];
  for (const m of all) {
    if (kept.some((k) => m.start < k.end && m.end > k.start)) continue;
    kept.push(m);
  }

  const stylesPresent = new Set(kept.map((m) => m.style));
  if (stylesPresent.size <= 1) return [];

  // Pick the recommended canonical style based on what's present, defaulting
  // to korean_explicit which is the most unambiguous form.
  const recommended: DateStyleId = stylesPresent.has("korean_explicit")
    ? "korean_explicit"
    : "korean_explicit";

  const articles = indexArticles(text);
  return kept
    .filter((m) => m.style !== recommended)
    .map((m) => {
      const span = findArticleAtOffset(articles, m.start);
      return {
        check_id: "date_format" as const,
        severity: "low" as const,
        location: span ? { article: formatArticleLabel(span) } : {},
        problem: `날짜 형식 혼용 (${[...stylesPresent].map((s) => STYLE_LABEL[s]).join(", ")}).`,
        why_it_matters: "같은 문서 내 날짜 형식은 일관성이 필요하다.",
        recommended_revision: `"${m.text}" → 권장 형식 ${STYLE_LABEL[recommended]}로 통일.`,
        matched_text: m.text,
        offset: m.start,
      };
    });
}
