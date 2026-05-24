import { findArticleAtOffset, formatArticleLabel, indexArticles } from "../article-index";
import type { QAFinding } from "../types";

/**
 * Cross-reference resolution.
 *
 * For every "제N조", "제N조 제M항", or "제N조 제M항 제K호" reference appearing
 * INSIDE an article body (not as a header), verify:
 *   - article N exists in the document;
 *   - if M is referenced, article N has at least M paragraphs (counted by
 *     ① ② ③ markers);
 *   - if K is referenced, the relevant paragraph contains item K (counted by
 *     1./2./3. tokens at line starts within the paragraph block — simplified).
 *
 * Findings are HIGH severity (a broken cross-reference is a real defect).
 */

const PARAGRAPH_MARKERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const REF_RE = /제\s*(\d+)\s*조(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g;

function paragraphCount(articleText: string): number {
  // Count distinct paragraph markers seen. Real Korean contracts use markers
  // sequentially so the count is a reasonable upper bound.
  const seen = new Set<string>();
  for (const ch of articleText) {
    if (PARAGRAPH_MARKERS.includes(ch)) seen.add(ch);
  }
  return seen.size;
}

function itemCountInArticle(articleText: string): number {
  // Best-effort: max item number seen at start of a line.
  let max = 0;
  const re = /(?:^|\n)\s*(\d+)\./g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(articleText)) !== null) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

export function checkCrossReferences(text: string): QAFinding[] {
  const articles = indexArticles(text);
  const articlesByNumber = new Map<string, (typeof articles)[number]>();
  for (const a of articles) articlesByNumber.set(a.number, a);

  // The set of "제N조" offsets that are real article headers comes straight
  // from indexArticles — both functions must agree on what counts as a header.
  // This avoids the trap where an inline reference like "본조는 제2조 제5항"
  // gets misclassified as a header and skipped from cross-reference checking.
  const headerOffsets = new Set(articles.map((a) => a.start));

  const findings: QAFinding[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text)) !== null) {
    const offset = m.index;
    // Skip header occurrences ("제N조 (목적)" etc.)
    if (headerOffsets.has(offset)) continue;

    const articleNumStr = m[1]!;
    const paraNum = m[2] ? Number(m[2]) : null;
    const itemNum = m[3] ? Number(m[3]) : null;
    const target = articlesByNumber.get(articleNumStr);
    const sourceSpan = findArticleAtOffset(articles, offset);
    const fromLabel = sourceSpan
      ? `${formatArticleLabel(sourceSpan)}에서 `
      : "";

    if (!target) {
      findings.push({
        check_id: "cross_references",
        severity: "high",
        location: sourceSpan ? { article: formatArticleLabel(sourceSpan) } : {},
        problem: `${fromLabel}참조한 ${m[0]}가 본문에 존재하지 않음.`,
        why_it_matters: "끊긴 참조는 해석 분쟁의 원인이 된다.",
        recommended_revision: `참조 대상 ${m[0]}을 본문에 추가하거나 참조를 정정.`,
        matched_text: m[0],
        offset,
      });
      continue;
    }

    if (paraNum !== null) {
      const count = paragraphCount(target.text);
      if (count > 0 && paraNum > count) {
        findings.push({
          check_id: "cross_references",
          severity: "high",
          location: sourceSpan ? { article: formatArticleLabel(sourceSpan) } : {},
          problem: `${fromLabel}참조한 ${m[0]}의 제${paraNum}항이 ${formatArticleLabel(target)}에 없음 (확인된 항 수: ${count}).`,
          why_it_matters: "끊긴 항 참조는 해석 분쟁의 원인이 된다.",
          recommended_revision: `참조 항 번호를 정정하거나 ${formatArticleLabel(target)}에 해당 항을 추가.`,
          matched_text: m[0],
          offset,
        });
        continue;
      }
    }

    if (itemNum !== null) {
      const maxItem = itemCountInArticle(target.text);
      if (maxItem > 0 && itemNum > maxItem) {
        findings.push({
          check_id: "cross_references",
          severity: "high",
          location: sourceSpan ? { article: formatArticleLabel(sourceSpan) } : {},
          problem: `${fromLabel}참조한 ${m[0]}의 제${itemNum}호가 ${formatArticleLabel(target)}에 없음 (확인된 호 수: ${maxItem}).`,
          why_it_matters: "끊긴 호 참조는 해석 분쟁의 원인이 된다.",
          recommended_revision: `참조 호 번호를 정정하거나 ${formatArticleLabel(target)}에 해당 호를 추가.`,
          matched_text: m[0],
          offset,
        });
      }
    }
  }

  return findings;
}
