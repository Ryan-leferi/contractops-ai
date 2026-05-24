import { formatArticleLabel, indexArticles } from "../article-index";
import type { QAFinding } from "../types";

/**
 * Korean numbering convention check (PLATFORM_BRIEF.md §6).
 *
 *   Article:      제1조
 *   Paragraph:    ① ② ③
 *   Item:         1. 2. 3.
 *   Sub-item:     가. 나. 다.
 *
 * Rules:
 *   - If an article has multiple paragraph candidates but is missing the
 *     circled-number markers, flag at medium severity.
 *   - If item markers (1./2./...) jump (e.g. 1. then 3.), flag.
 *   - Single-paragraph articles do NOT need paragraph numbering — do not
 *     overflag (per the brief).
 */

const PARAGRAPH_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const PARAGRAPH_NUMBER_RE = new RegExp(`[${PARAGRAPH_NUMBERS}]`, "g");

/**
 * Heuristic: a "paragraph candidate" is a non-empty line within the article
 * body (excluding the article header line itself). When 2+ candidates exist
 * without any circled marker, that's suspicious.
 */
function countParagraphCandidates(articleText: string): number {
  const body = articleText.replace(/^[^\n]*\n?/, "");
  const lines = body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length;
}

function checkItemSequencing(articleText: string): { gap: boolean; numbers: number[] } {
  // Items like "1." "2." "3." at start of a line.
  const re = /(?:^|\n)\s*(\d+)\./g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(articleText)) !== null) nums.push(Number(m[1]));
  // Detect a non-monotonic sequence (e.g. 1, 3) — best-effort.
  let gap = false;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! !== nums[i - 1]! + 1) {
      gap = true;
      break;
    }
  }
  return { gap, numbers: nums };
}

function checkSubItemSequencing(articleText: string): { gap: boolean } {
  const order = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하"];
  const re = /(?:^|\n)\s*([가-힣])\./g;
  const seen: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(articleText)) !== null) {
    const c = m[1]!;
    if (order.includes(c)) seen.push(c);
  }
  let gap = false;
  for (let i = 1; i < seen.length; i++) {
    const prevIdx = order.indexOf(seen[i - 1]!);
    const curIdx = order.indexOf(seen[i]!);
    if (curIdx !== prevIdx + 1) {
      gap = true;
      break;
    }
  }
  return { gap };
}

export function checkKoreanNumbering(text: string): QAFinding[] {
  const articles = indexArticles(text);
  const findings: QAFinding[] = [];

  for (const span of articles) {
    const paragraphMarkers = span.text.match(PARAGRAPH_NUMBER_RE) ?? [];
    const candidates = countParagraphCandidates(span.text);

    // Missing paragraph numbering when there appear to be 3+ paragraph
    // candidates. Threshold is 3 (not 2) so the common "title sentence +
    // clarifier sentence" pattern Korean contracts use without ① ② markers
    // does not get overflagged.
    if (candidates >= 3 && paragraphMarkers.length === 0) {
      findings.push({
        check_id: "korean_numbering",
        severity: "medium",
        location: { article: formatArticleLabel(span) },
        problem:
          `${formatArticleLabel(span)}에 ${candidates}개의 문단으로 보이지만 ① ② ③ 등 항 번호가 보이지 않음.`,
        why_it_matters: "복수 문단 조항은 항 번호가 권장된다 (PLATFORM_BRIEF.md §6).",
        recommended_revision: "각 문단 앞에 ①, ②, ③ 항 번호 부여.",
        offset: span.start,
      });
    }

    // Out-of-order item numbering.
    const items = checkItemSequencing(span.text);
    if (items.gap && items.numbers.length >= 2) {
      findings.push({
        check_id: "korean_numbering",
        severity: "medium",
        location: { article: formatArticleLabel(span) },
        problem:
          `${formatArticleLabel(span)}의 호 번호가 연속이 아님: ${items.numbers.join(", ")}.`,
        why_it_matters: "호 번호는 1., 2., 3. 순으로 연속이어야 한다.",
        recommended_revision: "호 번호를 1., 2., 3., …로 재정렬.",
        offset: span.start,
      });
    }

    // Out-of-order sub-item numbering.
    const sub = checkSubItemSequencing(span.text);
    if (sub.gap) {
      findings.push({
        check_id: "korean_numbering",
        severity: "low",
        location: { article: formatArticleLabel(span) },
        problem: `${formatArticleLabel(span)}의 목 번호(가., 나., 다., …) 순서가 어긋남.`,
        why_it_matters: "목 번호는 가., 나., 다. 순으로 연속이어야 한다.",
        recommended_revision: "목 번호를 가., 나., 다., …로 재정렬.",
        offset: span.start,
      });
    }
  }

  return findings;
}
