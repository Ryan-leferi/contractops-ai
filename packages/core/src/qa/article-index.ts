/**
 * Tiny shared utility — split a Korean contract body into article blocks so
 * other checks can attribute findings to a specific 제N조 location.
 *
 * `ArticleSpan` carries the article number and the slice of text it covers.
 * `findArticleAtOffset` lets checks turn a raw offset into a location field.
 */

export interface ArticleSpan {
  /** "1" for 제1조, "12" for 제12조, etc. */
  number: string;
  /** Inclusive start offset in the source string. */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Slice of the source string from start to end. */
  text: string;
}

// Only treat "제N조" at the start of a line (after optional whitespace) as an
// article header. Inline references like "본조는 제2조 제5항에 따른다" must
// not be confused with a header — that would corrupt the article index and
// break cross-reference resolution.
const ARTICLE_HEADER_RE = /(?:^|\n)([ \t]*)제\s*(\d+)\s*조(?![가-힣\d])/g;

export function indexArticles(text: string): ArticleSpan[] {
  ARTICLE_HEADER_RE.lastIndex = 0;
  const heads: { number: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = ARTICLE_HEADER_RE.exec(text)) !== null) {
    // m.index points at the line start (or 0). Advance past any leading
    // newline + indentation so the span starts at the `제` character itself.
    const prefix = (m[0].startsWith("\n") ? 1 : 0) + (m[1]?.length ?? 0);
    heads.push({ number: m[2]!, start: m.index + prefix });
  }
  const spans: ArticleSpan[] = [];
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i]!;
    const end = i + 1 < heads.length ? heads[i + 1]!.start : text.length;
    spans.push({
      number: head.number,
      start: head.start,
      end,
      text: text.slice(head.start, end),
    });
  }
  return spans;
}

export function findArticleAtOffset(
  spans: ArticleSpan[],
  offset: number,
): ArticleSpan | undefined {
  return spans.find((s) => offset >= s.start && offset < s.end);
}

/** Render an article number into "제N조" for IssueCard.location.article. */
export function formatArticleLabel(span: ArticleSpan): string {
  return `제${span.number}조`;
}
