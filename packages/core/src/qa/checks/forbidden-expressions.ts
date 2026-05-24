import type { IssueSeverity } from "@contractops/schemas";
import { findArticleAtOffset, formatArticleLabel, indexArticles } from "../article-index";
import type { QAFinding } from "../types";

/**
 * Korean-legal-style forbidden expressions.
 *
 * Per PLATFORM_BRIEF.md §6 + Playbook drafting_style_notes. Longer patterns
 * are evaluated first so "20~40K" doesn't double-trip "20K".
 */

interface ForbiddenRule {
  pattern: RegExp;
  display: string;
  replacement: string;
  severity: IssueSeverity;
  why_it_matters: string;
}

const FORBIDDEN_RULES: ForbiddenRule[] = [
  // Longest/most specific patterns FIRST so their spans absorb shorter overlaps.
  {
    pattern: /20\s*~\s*40\s*K/g,
    display: "20~40K",
    replacement: "2만 명 이상 4만 명 이하",
    severity: "medium",
    why_it_matters: "단위와 범위를 한국어로 명시해야 한다 (PLATFORM_BRIEF.md §6).",
  },
  {
    pattern: /\b20\s*K\b/g,
    display: "20K",
    replacement: "2만 명",
    severity: "medium",
    why_it_matters: "약식 영문 단위(K)는 한국어 계약 표현에 부적절하다.",
  },
  {
    pattern: /함\s*에\s*있어/g,
    display: "함에 있어",
    replacement: "함에 관하여 (또는 문장 재구성)",
    severity: "low",
    why_it_matters: "한국어 법문 권장 표현이 아니다 (PLATFORM_BRIEF.md §6).",
  },
  {
    pattern: /결과손해/g,
    display: "결과손해",
    replacement: "간접손해 또는 특별손해",
    severity: "medium",
    why_it_matters: "한국법상 모호한 영문계약 직역 표현이다 (PLATFORM_BRIEF.md §6).",
  },
  {
    pattern: /해석되지\s*아니한다/g,
    display: "해석되지 아니한다",
    replacement: "보지 아니한다 (또는 문맥에 맞게 재작성)",
    severity: "low",
    why_it_matters: "효과 부인 의도라면 '보지 아니한다'가 통상 표현이다.",
  },
  {
    pattern: /취득하지\s*못한다/g,
    display: "취득하지 못한다",
    replacement: "취득하지 아니한다 (법률효과 선언인 경우)",
    severity: "medium",
    why_it_matters: "법률효과 선언이라면 '못한다'(능력 부인) 대신 '아니한다'(효과 부인)이 통상.",
  },
  {
    // 기타 — but only as a standalone token, not inside compound words like
    // "기타 등등" boundary is best-effort. Use a lookahead to avoid matching
    // "기타등등" / "기타사항" depends on context — for safety, match standalone
    // "기타" followed by whitespace, punctuation, or end-of-string.
    pattern: /기타(?=\s|[,，.。)\]」』」｜|$])/g,
    display: "기타",
    replacement: "그 밖의",
    severity: "low",
    why_it_matters: "한국 법령은 '기타' 대신 '그 밖의'를 권장 (PLATFORM_BRIEF.md §6).",
  },
];

interface Match {
  rule: ForbiddenRule;
  start: number;
  end: number;
  text: string;
}

export function checkForbiddenExpressions(text: string): QAFinding[] {
  // 1. Collect all matches.
  const all: Match[] = [];
  for (const rule of FORBIDDEN_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      all.push({
        rule,
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
      });
    }
  }
  // 2. Sort by (start asc, length desc).
  all.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  // 3. Drop any match that overlaps an earlier (longer/equal) one.
  const kept: Match[] = [];
  for (const m of all) {
    if (kept.some((k) => m.start < k.end && m.end > k.start)) continue;
    kept.push(m);
  }
  // 4. Convert to findings with article location.
  const articles = indexArticles(text);
  return kept.map((m) => {
    const span = findArticleAtOffset(articles, m.start);
    return {
      check_id: "forbidden_expressions" as const,
      severity: m.rule.severity,
      location: span ? { article: formatArticleLabel(span) } : {},
      problem: `금지 표현 "${m.rule.display}" 발견.`,
      why_it_matters: m.rule.why_it_matters,
      recommended_revision: `"${m.rule.display}" → "${m.rule.replacement}"`,
      matched_text: m.text,
      offset: m.start,
    };
  });
}
