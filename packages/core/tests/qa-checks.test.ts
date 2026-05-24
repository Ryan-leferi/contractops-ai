import { describe, expect, it } from "vitest";
import {
  checkAmountFormat,
  checkCleanCommentaryLeakage,
  checkCrossReferences,
  checkDateFormat,
  checkForbiddenExpressions,
  checkKoreanNumbering,
  checkUndefinedTerms,
} from "@contractops/core";

/**
 * Unit tests for each deterministic-QA check. These are sync, no LLM, no
 * provider — pure string in / findings out.
 */

describe("forbidden_expressions", () => {
  it("detects every forbidden expression with its suggested replacement", () => {
    const text = [
      "제1조 (목적)",
      "기타 의무, 함에 있어 정함이 없는 경우 결과손해를 책임진다.",
      "관람객 20K, 또는 20~40K 규모일 수 있다.",
      "본 조항은 해석되지 아니한다. 권리는 취득하지 못한다.",
    ].join("\n");
    const findings = checkForbiddenExpressions(text);
    const phrases = findings.map((f) => f.matched_text);
    expect(phrases).toContain("기타");
    expect(phrases.some((p) => p?.startsWith("함에 있어"))).toBe(true);
    expect(phrases).toContain("결과손해");
    expect(phrases).toContain("20K");
    expect(phrases.some((p) => p && /20\s*~\s*40\s*K/.test(p))).toBe(true);
    expect(phrases.some((p) => p?.startsWith("해석되지"))).toBe(true);
    expect(phrases.some((p) => p?.startsWith("취득하지"))).toBe(true);

    // Replacement suggestion is in the recommended_revision text
    const giThaFinding = findings.find((f) => f.matched_text === "기타");
    expect(giThaFinding?.recommended_revision).toContain("그 밖의");
  });

  it("does NOT double-flag 20K inside 20~40K", () => {
    const text = "제1조 (목적)\n행사 규모는 20~40K 입니다.";
    const findings = checkForbiddenExpressions(text);
    const phrases = findings.map((f) => f.matched_text);
    // Only the 20~40K span; the embedded "20K" should NOT also be flagged.
    expect(phrases.filter((p) => p && /20\s*~\s*40\s*K/.test(p)).length).toBe(1);
    expect(phrases.includes("20K")).toBe(false);
  });

  it("attributes a finding to the enclosing article", () => {
    const text = [
      "제1조 (목적)",
      "본조는 정상이다.",
      "제2조 (정의)",
      "기타 항목.",
    ].join("\n");
    const findings = checkForbiddenExpressions(text);
    const gita = findings.find((f) => f.matched_text === "기타");
    expect(gita?.location.article).toBe("제2조");
  });
});

describe("korean_numbering", () => {
  it("does NOT flag a single-paragraph article", () => {
    const text = "제1조 (목적)\n본 조항은 한 문단이다.";
    const findings = checkKoreanNumbering(text);
    expect(findings.filter((f) => f.problem.includes("문단"))).toEqual([]);
  });

  it("flags missing paragraph numbering on a multi-paragraph article", () => {
    const text = [
      "제1조 (목적)",
      "첫 번째 문단.",
      "두 번째 문단.",
      "세 번째 문단.",
    ].join("\n");
    const findings = checkKoreanNumbering(text);
    expect(findings.some((f) => f.problem.includes("항 번호"))).toBe(true);
  });

  it("does NOT flag when paragraph markers ARE present", () => {
    const text = [
      "제1조 (목적)",
      "① 첫 번째 문단.",
      "② 두 번째 문단.",
    ].join("\n");
    const findings = checkKoreanNumbering(text);
    expect(findings.some((f) => f.problem.includes("항 번호"))).toBe(false);
  });

  it("flags out-of-order item numbering (1., 3.)", () => {
    const text = [
      "제1조 (목적)",
      "① 항.",
      "1. 첫 호",
      "3. 세 번째 호",
    ].join("\n");
    const findings = checkKoreanNumbering(text);
    expect(findings.some((f) => f.problem.includes("호 번호"))).toBe(true);
  });

  it("flags out-of-order sub-item numbering (가., 다.)", () => {
    const text = [
      "제1조 (목적)",
      "① 항.",
      "가. 첫 목",
      "다. 셋째 목",
    ].join("\n");
    const findings = checkKoreanNumbering(text);
    expect(findings.some((f) => f.problem.includes("목 번호"))).toBe(true);
  });
});

describe("cross_references", () => {
  it("flags a reference to a missing article", () => {
    const text = [
      "제1조 (목적)",
      "본조는 제99조에 따른다.",
    ].join("\n");
    const findings = checkCrossReferences(text);
    expect(findings.length).toBe(1);
    expect(findings[0]!.matched_text).toBe("제99조");
    expect(findings[0]!.severity).toBe("high");
  });

  it("does NOT flag a reference to an existing article", () => {
    const text = [
      "제1조 (목적)",
      "본조는 제2조에 따른다.",
      "제2조 (정의)",
      "정의를 본다.",
    ].join("\n");
    const findings = checkCrossReferences(text);
    expect(findings).toEqual([]);
  });

  it("flags a reference to a missing paragraph within an existing article", () => {
    const text = [
      "제1조 (목적)",
      "본조는 제2조 제5항에 따른다.",
      "제2조 (정의)",
      "① 항.",
      "② 항.",
    ].join("\n");
    const findings = checkCrossReferences(text);
    expect(findings.length).toBe(1);
    expect(findings[0]!.problem).toContain("제5항");
  });

  it("flags a reference to a missing item", () => {
    const text = [
      "제1조 (목적)",
      "본조는 제2조 제1항 제9호에 따른다.",
      "제2조 (정의)",
      "① 항.",
      "1. 첫 호",
      "2. 둘째 호",
    ].join("\n");
    const findings = checkCrossReferences(text);
    expect(findings.length).toBe(1);
    expect(findings[0]!.problem).toContain("제9호");
  });
});

describe("amount_format", () => {
  it("does NOT flag a uniformly-formatted document", () => {
    const text = [
      "제1조 (위탁료)",
      "위탁료는 금 1,000,000원으로 한다.",
      "지급일까지의 지연료는 금 50,000원으로 한다.",
    ].join("\n");
    expect(checkAmountFormat(text)).toEqual([]);
  });

  it("flags mixed styles (formal + numeric + korean unit)", () => {
    const text = [
      "제1조 (위탁료)",
      "위탁료는 금 1,000,000원으로 한다.",
      "추가 비용 50,000원.",
      "보증금은 100만 원으로 한다.",
    ].join("\n");
    const findings = checkAmountFormat(text);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    for (const f of findings) {
      expect(f.problem).toContain("혼용");
      expect(f.recommended_revision).toContain("금 N원");
    }
  });
});

describe("date_format", () => {
  it("does NOT flag uniform 'YYYY년 M월 D일' usage", () => {
    const text = [
      "제1조",
      "시작일은 2026년 6월 19일이다.",
      "종료일은 2026년 12월 31일이다.",
    ].join("\n");
    expect(checkDateFormat(text)).toEqual([]);
  });

  it("flags mixed date formats", () => {
    const text = [
      "제1조",
      "시작일은 2026년 6월 19일이다.",
      "종료일은 2026.12.31 이다.",
      "결제일은 2027. 1. 31. 이다.",
    ].join("\n");
    const findings = checkDateFormat(text);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe("clean_commentary_leakage", () => {
  it("flags every commentary marker found in the contract body", () => {
    const text = [
      "제1조 (목적)",
      "본조의 [COMMENTARY] 내부 주석 [INTERNAL] 이 남음.",
      "법무주석: 이 부분 재검토.",
    ].join("\n");
    const findings = checkCleanCommentaryLeakage(text);
    const markers = findings.map((f) => f.matched_text);
    expect(markers).toContain("[COMMENTARY]");
    expect(markers).toContain("[INTERNAL]");
    expect(markers).toContain("법무주석");
    expect(findings.every((f) => f.severity === "critical")).toBe(true);
  });

  it("also scans clean_export_content when provided", () => {
    const findings = checkCleanCommentaryLeakage(
      "제1조 (목적)\n본조는 정상.",
      "외부 송부본 [REDLINE_RATIONALE] 누락 위험.",
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.matched_text).toBe("[REDLINE_RATIONALE]");
  });
});

describe("undefined_terms", () => {
  it("flags an uppercase abbreviation that appears 2+ times", () => {
    const text = [
      "제1조 (목적)",
      "SKU 단위로 관리한다. SKU별 보고는 월 1회.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "SKU")).toBe(true);
  });

  it("does NOT flag an abbreviation that appears only once", () => {
    const text = "제1조 (목적)\nRSVP는 행사 안내에만 사용된다.";
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "RSVP")).toBe(false);
  });

  it("flags platform vocab 'Source Pack' when used 2+ times in the body", () => {
    const text = [
      "제1조 (목적)",
      "Source Pack에 따른다. Source Pack의 변경은 별도 절차에 따른다.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "Source Pack")).toBe(true);
  });
});
