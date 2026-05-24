import { describe, expect, it } from "vitest";
import { checkUndefinedTerms } from "@contractops/core";

/**
 * Milestone 2E — definition-clause awareness for `undefined_terms`.
 *
 * If a term is explicitly defined inside an article whose header looks like
 * a definition clause (제N조 (정의), 제N조 [정의], 제N조 (Definitions), …),
 * the term should NOT be flagged as a candidate for definition.
 */

describe("undefined_terms — definition-clause awareness", () => {
  it("flags an undefined repeated abbreviation when no definition article exists", () => {
    const text = [
      "제1조 (목적)",
      "본 계약은 SKU 관리에 관한 것이다. SKU별 보고는 월 1회.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "SKU")).toBe(true);
  });

  it("does NOT flag an abbreviation defined inside 제N조 (정의) via bare form", () => {
    const text = [
      "제1조 (목적)",
      "본 계약은 SKU 관리에 관한 것이다. SKU별 보고는 월 1회.",
      "제2조 (정의)",
      "1. SKU란 단위별 재고 관리 단위를 말한다.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "SKU")).toBe(false);
  });

  it("does NOT flag a quoted term defined inside 제N조 (정의)", () => {
    const text = [
      "제1조 (목적)",
      "본 계약은 VMD 관리에 관한 것이다. VMD 기준은 별도 정한다.",
      "제2조 (정의)",
      "1. 'VMD'라 함은 시각 머천다이징(Visual Merchandising)을 말한다.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "VMD")).toBe(false);
  });

  it("recognizes definition headers in multiple bracket styles", () => {
    const styles = [
      "제2조 (정의)",
      "제2조 [정의]",
      "제2조 「정의」",
      "제2조  정의",
      "제2조 (Definitions)",
      "제2조 (용어의 정의)",
    ];
    for (const header of styles) {
      const text = [
        "제1조 (목적)",
        "본 계약은 POS 관리에 관한 것이다. POS 보고는 월 1회.",
        header,
        "1. POS란 판매시점 정보관리를 말한다.",
      ].join("\n");
      const findings = checkUndefinedTerms(text);
      expect(
        findings.some((f) => f.matched_text === "POS"),
        `expected POS to be excluded under header "${header}"`,
      ).toBe(false);
    }
  });

  it("still flags OTHER terms that are NOT defined", () => {
    const text = [
      "제1조 (목적)",
      "본 계약은 SKU와 VMD 관리에 관한 것이다. SKU와 VMD는 매월 보고한다.",
      "제2조 (정의)",
      "1. SKU란 단위별 재고 관리 단위를 말한다.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    // SKU is defined → excluded; VMD is not → flagged.
    expect(findings.some((f) => f.matched_text === "SKU")).toBe(false);
    expect(findings.some((f) => f.matched_text === "VMD")).toBe(true);
  });

  it("excludes platform vocab when defined", () => {
    const text = [
      "제1조 (목적)",
      "Source Pack을 잠금한다. Source Pack 변경은 별도 절차로.",
      "제2조 (정의)",
      "1. 'Source Pack'이라 함은 잠금된 원자료 묶음을 말한다.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "Source Pack")).toBe(false);
  });

  it("does NOT use a non-definition article as a definition source", () => {
    // 제3조 본문에 'SKU' 가 quoted로 등장하지만, 그 article의 header는
    // "(목적)" 이므로 definition source로 인정되지 않아야 한다.
    const text = [
      "제1조 (목적)",
      "SKU 관리. SKU 보고.",
      "제3조 (목적)",
      "1. 'SKU'에 관한 일반적 언급.",
    ].join("\n");
    const findings = checkUndefinedTerms(text);
    expect(findings.some((f) => f.matched_text === "SKU")).toBe(true);
  });
});
