import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import {
  buildCleanDocx,
  buildCommentaryDocx,
  buildCoverEmail,
  buildNegotiationMatrix,
  CLEAN_FORBIDDEN_MARKERS,
  COMMENTARY_INTERNAL_FOOTER,
  COMMENTARY_INTERNAL_HEADER,
  createExportRenderer,
  DOCX_MIME_TYPE,
  findForbiddenMarker,
  type ExportRenderInput,
} from "../src/export-renderer";

import type {
  AgentRun,
  ContractVersion,
  IssueCard,
  Playbook,
  Project,
} from "@contractops/schemas";
import type { DeterministicQAResult } from "../src/qa/types";

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders — fully synthetic, no Playbook file required.
// ─────────────────────────────────────────────────────────────────────────

function makeProject(): Project {
  return {
    id: "proj_demo",
    name: "Demo Project",
    status: "exported",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "user_demo",
  };
}

function makePlaybook(): Playbook {
  return {
    id: "pb_demo",
    contract_type: "Demo Contract",
    contract_family: "service",
    legal_characterization: "도급",
    required_intake_questions: [],
    optional_intake_questions: [],
    default_table_of_contents: [],
    mandatory_clauses: [],
    optional_clauses: [],
    common_risks: [],
    red_flags: [],
    source_document_expectations: [],
    drafting_style_notes: [],
    negotiation_positions: [],
    fallback_clauses: [],
    final_qa_checklist: [],
    is_custom_marker: false,
  } as unknown as Playbook;
}

function makeFinalVersion(overrides: Partial<ContractVersion> = {}): ContractVersion {
  return {
    id: "cv_v1_final",
    project_id: "proj_demo",
    source_pack_id: "sp_locked_1",
    playbook_id: "pb_demo",
    version_number: "v1",
    content: [
      "제1조 (목적)",
      "본 계약은 갑과 을 간의 용역 위탁에 관한 사항을 정함을 목적으로 한다.",
      "",
      "제2조 (계약 기간)",
      "본 계약의 기간은 2026-01-01부터 2026-12-31까지로 한다.",
    ].join("\n"),
    created_by_agent: "contract_drafter",
    created_at: "2026-01-02T00:00:00.000Z",
    final: true,
    final_approved_by: "lawyer_demo",
    final_approved_at: "2026-01-03T00:00:00.000Z",
    ...overrides,
  } as ContractVersion;
}

function makeIssueCards(): IssueCard[] {
  return [
    {
      issue_id: "ic_accepted",
      project_id: "proj_demo",
      source_agent: "mock_counterparty",
      severity: "high",
      location: { article: "제2조" },
      issue_type: "term_clarity",
      problem: "계약 기간 만료 후 처리 절차가 모호함",
      why_it_matters: "분쟁 위험",
      recommended_revision: "기간 만료 후 30일 통지 조항 추가",
      business_impact: "moderate",
      recommended_action: "revise",
      human_decision: "accepted",
      partial_note: null,
      applied_version: "cv_v1_final",
    },
    {
      issue_id: "ic_rejected",
      project_id: "proj_demo",
      source_agent: "mock_legal_style",
      severity: "low",
      location: { article: "제1조" },
      issue_type: "stylistic",
      problem: "REJECTED-ONLY: 영문 표기 추가 권고",
      why_it_matters: "스타일 일관성",
      recommended_revision: "영문 병기 추가",
      business_impact: "low",
      recommended_action: "accept",
      human_decision: "rejected",
      partial_note: null,
      applied_version: null,
    },
  ] as unknown as IssueCard[];
}

function makeAgentRuns(): AgentRun[] {
  return [
    {
      id: "ar_1",
      project_id: "proj_demo",
      role: "deal_memo_drafter",
      source_agent: "openai",
      provider_id: "openai",
      model_id: "gpt-4o-mini",
      mode: "real",
      prompt_version: "v1",
      input_hash: "h1",
      output_json: null,
      output_text: null,
      status: "completed",
      started_at: "2026-01-02T01:00:00.000Z",
      completed_at: "2026-01-02T01:00:05.000Z",
      error_message: null,
      token_usage: { input_tokens: 1000, output_tokens: 500 },
      cost_estimate: 0.01,
    },
    {
      id: "ar_2",
      project_id: "proj_demo",
      role: "counterparty_reviewer",
      source_agent: "anthropic",
      provider_id: "anthropic",
      model_id: "claude-3-5-sonnet-20241022",
      mode: "real",
      prompt_version: "v1",
      input_hash: "h2",
      output_json: null,
      output_text: null,
      status: "completed",
      started_at: "2026-01-02T02:00:00.000Z",
      completed_at: "2026-01-02T02:00:10.000Z",
      error_message: null,
      token_usage: { input_tokens: 2000, output_tokens: 800 },
      cost_estimate: 0.05,
    },
  ];
}

function makeQARuns(): DeterministicQAResult[] {
  return [
    {
      findings: [
        {
          check_id: "forbidden_expressions",
          severity: "medium",
          location: { article: "제1조" },
          problem: "기타 표현 사용 — 그 밖의 권장",
          why_it_matters: "한국 법률 작성 관행",
          recommended_revision: "‘기타’를 ‘그 밖의’로 변경",
        },
      ],
      checks_run: [
        { check_id: "forbidden_expressions", finding_count: 1 },
        { check_id: "korean_numbering", finding_count: 0 },
        { check_id: "cross_references", finding_count: 0 },
        { check_id: "amount_format", finding_count: 0 },
        { check_id: "date_format", finding_count: 0 },
        { check_id: "clean_commentary_leakage", finding_count: 0 },
        { check_id: "undefined_terms", finding_count: 0 },
      ],
    },
  ];
}

function makeInput(overrides: Partial<ExportRenderInput> = {}): ExportRenderInput {
  return {
    project: makeProject(),
    contract_version: makeFinalVersion(),
    playbook: makePlaybook(),
    source_pack_id: "sp_locked_1",
    issue_cards: makeIssueCards(),
    agent_runs: makeAgentRuns(),
    qa_runs: makeQARuns(),
    generated_at: "2026-01-04T12:00:00.000Z",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DOCX inspection helper — unzip and pull the document.xml so tests assert
// on what Word will actually display, not on internal JS object shapes.
// ─────────────────────────────────────────────────────────────────────────

async function docxText(buffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  // Strip XML tags so the assertion sees the plain text the renderer wrote.
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────
// Tests.
// ─────────────────────────────────────────────────────────────────────────

describe("DOCX export renderer (Milestone 3A)", () => {
  it("clean DOCX render returns a non-empty .docx buffer", async () => {
    const { buffer, file_name, mime_type } = await buildCleanDocx(makeInput());
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(file_name).toMatch(/\.docx$/);
    expect(mime_type).toBe(DOCX_MIME_TYPE);
    // First two bytes of any zip (DOCX is zip) are PK.
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("commentary DOCX render returns a non-empty .docx buffer", async () => {
    const { buffer, file_name, mime_type } = await buildCommentaryDocx(makeInput());
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(file_name).toMatch(/_commentary_INTERNAL\.docx$/);
    expect(mime_type).toBe(DOCX_MIME_TYPE);
  });

  it("clean DOCX XML does NOT contain any forbidden internal-commentary marker", async () => {
    const { buffer } = await buildCleanDocx(makeInput());
    const text = await docxText(buffer);
    for (const marker of CLEAN_FORBIDDEN_MARKERS) {
      expect(text).not.toContain(marker);
    }
  });

  it("commentary DOCX XML self-identifies with the INTERNAL ONLY marker", async () => {
    const { buffer } = await buildCommentaryDocx(makeInput());
    const text = await docxText(buffer);
    expect(text).toContain(COMMENTARY_INTERNAL_HEADER);
    expect(text).toContain(COMMENTARY_INTERNAL_FOOTER);
  });

  it("clean DOCX XML includes source_pack_id and playbook_id (PLATFORM_BRIEF.md §9)", async () => {
    const input = makeInput();
    const { buffer } = await buildCleanDocx(input);
    const text = await docxText(buffer);
    expect(text).toContain(input.source_pack_id);
    expect(text).toContain(input.playbook!.id);
    expect(text).toContain(input.contract_version.id);
    expect(text).toContain(input.contract_version.version_number);
  });

  it("clean DOCX XML includes the contract body, project name, and signature block", async () => {
    const { buffer } = await buildCleanDocx(makeInput());
    const text = await docxText(buffer);
    expect(text).toContain("Demo Project");
    expect(text).toContain("제1조");
    expect(text).toContain("계약 기간");
    expect(text).toContain("Party A");
    expect(text).toContain("Party B");
  });

  it("commentary DOCX XML includes the Issue Card summary, including the rejected card", async () => {
    const { buffer } = await buildCommentaryDocx(makeInput());
    const text = await docxText(buffer);
    expect(text).toContain("ic_accepted");
    expect(text).toContain("accepted");
    // The full decision trail belongs in commentary — including rejected.
    expect(text).toContain("ic_rejected");
    expect(text).toContain("rejected");
  });

  it("commentary DOCX XML includes the deterministic QA summary when present", async () => {
    const { buffer } = await buildCommentaryDocx(makeInput());
    const text = await docxText(buffer);
    expect(text).toContain("Deterministic QA");
    expect(text).toContain("forbidden_expressions");
    expect(text).toContain("checks=7");
  });

  it("commentary DOCX XML includes the AgentRun summary with provider + mode", async () => {
    const { buffer } = await buildCommentaryDocx(makeInput());
    const text = await docxText(buffer);
    expect(text).toContain("deal_memo_drafter");
    expect(text).toContain("openai");
    expect(text).toContain("counterparty_reviewer");
    expect(text).toContain("anthropic");
    expect(text).toContain("(real)");
  });

  it("rejected Issue Card REJECTED-ONLY content is NOT present in the clean DOCX", async () => {
    // The contract body we render is the final ContractVersion content. The
    // Revision Agent only applies accepted / partially-accepted cards
    // (PLATFORM_BRIEF.md §5 rule 5) so the rejected card's content never
    // makes it into the body. The clean renderer additionally does not
    // include any Issue Card text at all — so the rejected card's
    // recommended_revision and problem strings must be absent.
    const { buffer } = await buildCleanDocx(makeInput());
    const text = await docxText(buffer);
    expect(text).not.toContain("REJECTED-ONLY");
    expect(text).not.toContain("영문 표기 추가 권고");
    expect(text).not.toContain("영문 병기 추가");
  });

  it("clean DOCX render REFUSES when the contract body itself contains a forbidden marker", async () => {
    const tainted = makeInput({
      contract_version: makeFinalVersion({
        content: "제1조 (목적)\n본 계약은 [COMMENTARY] 내부 메모입니다.",
      }),
    });
    await expect(buildCleanDocx(tainted)).rejects.toThrow(/forbidden marker/i);
  });

  it("clean DOCX render REFUSES when a heading carries a Korean commentary marker", async () => {
    const tainted = makeInput({
      contract_version: makeFinalVersion({
        content: "제1조 (목적)\n법무주석: 본 조항은 협상 후 삭제 예정.",
      }),
    });
    await expect(buildCleanDocx(tainted)).rejects.toThrow(/forbidden marker/i);
  });

  it("file_name includes project name slug and version number for both render paths", async () => {
    const input = makeInput({
      project: { ...makeProject(), name: "MSA / 2026" },
      contract_version: makeFinalVersion({ version_number: "v2" }),
    });
    const clean = await buildCleanDocx(input);
    const commentary = await buildCommentaryDocx(input);
    expect(clean.file_name).toMatch(/MSA_2026/);
    expect(clean.file_name).toMatch(/v2/);
    expect(clean.file_name).toMatch(/_clean\.docx$/);
    expect(commentary.file_name).toMatch(/MSA_2026/);
    expect(commentary.file_name).toMatch(/v2/);
    expect(commentary.file_name).toMatch(/_commentary_INTERNAL\.docx$/);
  });

  it("renderer factory returns ExportRenderer satisfying all four render paths", async () => {
    const renderer = createExportRenderer();
    const a = await renderer.renderCleanDocx(makeInput());
    const b = await renderer.renderCommentaryDocx(makeInput());
    const c = await renderer.renderNegotiationMatrix(makeInput());
    const d = await renderer.renderCoverEmail(makeInput());
    expect(a.buffer.byteLength).toBeGreaterThan(0);
    expect(b.buffer.byteLength).toBeGreaterThan(0);
    expect(c.buffer.byteLength).toBeGreaterThan(0);
    expect(d.buffer.byteLength).toBeGreaterThan(0);
  });

  it("findForbiddenMarker detects every member of the marker list", () => {
    for (const marker of CLEAN_FORBIDDEN_MARKERS) {
      expect(findForbiddenMarker(`before ${marker} after`)).toBe(marker);
    }
    expect(findForbiddenMarker("perfectly clean text")).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────
  // Milestone 3B — negotiation matrix (DOCX, internal)
  // ─────────────────────────────────────────────────────────────────────

  it("negotiation matrix DOCX returns a non-empty .docx buffer with INTERNAL filename", async () => {
    const { buffer, file_name, mime_type } = await buildNegotiationMatrix(makeInput());
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(file_name).toMatch(/_negotiation_matrix_INTERNAL\.docx$/);
    expect(mime_type).toBe(DOCX_MIME_TYPE);
    // PKZip magic
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("negotiation matrix XML self-identifies as INTERNAL ONLY (banner + footer)", async () => {
    const { buffer } = await buildNegotiationMatrix(makeInput());
    const text = await docxText(buffer);
    expect(text).toContain(COMMENTARY_INTERNAL_HEADER);
    expect(text).toContain(COMMENTARY_INTERNAL_FOOTER);
    expect(text).toContain("협상 매트릭스");
    expect(text).toContain("Negotiation Matrix");
  });

  it("negotiation matrix XML lists every Issue Card with its decision and response position", async () => {
    const { buffer } = await buildNegotiationMatrix(makeInput());
    const text = await docxText(buffer);
    // Both accepted and rejected cards must appear — the matrix covers the
    // full decision trail, not just the applied ones.
    expect(text).toContain("ic_accepted");
    expect(text).toContain("accepted");
    expect(text).toContain("ic_rejected");
    expect(text).toContain("rejected");
    // Derived response position lines must be present for at least one card.
    expect(text).toMatch(/Adopt recommended revision|Propose recommended_revision|Reject counterparty position/);
  });

  it("negotiation matrix XML includes source_pack_id, playbook_id, and contract_version_id", async () => {
    const input = makeInput();
    const { buffer } = await buildNegotiationMatrix(input);
    const text = await docxText(buffer);
    expect(text).toContain(input.source_pack_id);
    expect(text).toContain(input.playbook!.id);
    expect(text).toContain(input.contract_version.id);
  });

  it("negotiation matrix decision summary line reflects card counts", async () => {
    const { buffer } = await buildNegotiationMatrix(makeInput());
    const text = await docxText(buffer);
    // Fixture: 1 accepted, 1 rejected, 0 of the others.
    expect(text).toMatch(/accepted=1/);
    expect(text).toMatch(/rejected=1/);
    expect(text).toMatch(/partially_accepted=0/);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Milestone 3B — cover email (Markdown, external)
  // ─────────────────────────────────────────────────────────────────────

  it("cover email returns non-empty UTF-8 Markdown with text/markdown MIME", async () => {
    const { buffer, file_name, mime_type } = await buildCoverEmail(makeInput());
    expect(buffer.byteLength).toBeGreaterThan(100);
    expect(file_name).toMatch(/_cover_email\.md$/);
    expect(mime_type).toBe("text/markdown; charset=utf-8");
    // Must NOT have PKZip magic — it is text, not a DOCX.
    expect(buffer[0]).not.toBe(0x50);
  });

  it("cover email Markdown contains polite Korean business tone and project identifiers", async () => {
    const input = makeInput();
    const { buffer } = await buildCoverEmail(input);
    const md = new TextDecoder().decode(buffer);
    expect(md).toContain("안녕하십니까");
    expect(md).toContain("감사합니다");
    expect(md).toContain(input.project.name);
    expect(md).toContain(input.contract_version.version_number);
    expect(md).toContain(input.source_pack_id);
    expect(md).toContain(input.playbook!.id);
  });

  it("cover email Markdown contains NO internal-commentary marker", async () => {
    const { buffer } = await buildCoverEmail(makeInput());
    const md = new TextDecoder().decode(buffer);
    for (const marker of CLEAN_FORBIDDEN_MARKERS) {
      expect(md).not.toContain(marker);
    }
  });

  it("cover email Markdown contains NO Issue Card rationale — accepted OR rejected", async () => {
    const { buffer } = await buildCoverEmail(makeInput());
    const md = new TextDecoder().decode(buffer);
    expect(md).not.toContain("ic_accepted");
    expect(md).not.toContain("ic_rejected");
    expect(md).not.toContain("REJECTED-ONLY");
    expect(md).not.toContain("영문 표기 추가 권고");
    expect(md).not.toContain("기간 만료 후 30일 통지 조항 추가");
    // No deterministic_qa noise either.
    expect(md).not.toContain("forbidden_expressions");
  });

  it("cover email Markdown explicitly states the system does not send", async () => {
    const { buffer } = await buildCoverEmail(makeInput());
    const md = new TextDecoder().decode(buffer);
    // Either the Korean or English line must appear; both are present in
    // the rendered template.
    expect(md).toMatch(/시스템은 이메일을 자동 발송하지 않습니다/);
    expect(md).toMatch(/does NOT auto-send/);
  });

  it("cover email REFUSES when its rendered output somehow contains a forbidden marker", async () => {
    // Inject a forbidden marker via the project name (which is interpolated
    // into the subject line) and verify the renderer throws.
    const tainted = makeInput({
      project: {
        ...makeProject(),
        // The project name flows into the rendered body — if it contains a
        // forbidden marker, the post-render scrub must catch it.
        name: "Tainted Project [COMMENTARY] leak",
      },
    });
    await expect(buildCoverEmail(tainted)).rejects.toThrow(/forbidden marker/i);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Cross-renderer file-name uniqueness (so a user downloading all four
  // does not get clobbered names in their Downloads folder).
  // ─────────────────────────────────────────────────────────────────────

  it("file names are distinct across all four render paths for the same project", async () => {
    const renderer = createExportRenderer();
    const input = makeInput();
    const a = await renderer.renderCleanDocx(input);
    const b = await renderer.renderCommentaryDocx(input);
    const c = await renderer.renderNegotiationMatrix(input);
    const d = await renderer.renderCoverEmail(input);
    const names = new Set([a.file_name, b.file_name, c.file_name, d.file_name]);
    expect(names.size).toBe(4);
  });

  it("renderer source files do NOT import any LLM provider SDK", async () => {
    // Static check: every file under export-renderer/ contains no LLM SDK
    // import. Keeps the renderer provably free of network IO.
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve, join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/export-renderer");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf-8");
      expect(text).not.toMatch(/from\s+["']openai["']/);
      expect(text).not.toMatch(/from\s+["']@anthropic-ai\/sdk["']/);
      expect(text).not.toMatch(/from\s+["']@google\//);
      // No fetch / http either — renderer must be pure CPU.
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/from\s+["']node:https?["']/);
    }
  });
});
