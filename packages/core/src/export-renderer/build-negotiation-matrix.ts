import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import type { IssueCard, IssueRecommendedAction, IssueHumanDecision } from "@contractops/schemas";
import {
  COMMENTARY_INTERNAL_FOOTER,
  COMMENTARY_INTERNAL_HEADER,
} from "./forbidden-markers";
import { DOCX_MIME_TYPE, type ExportRenderInput, type ExportRenderResult } from "./types";
import { safeFileNamePart } from "./util";

/**
 * Builds the internal negotiation matrix DOCX (Milestone 3B).
 *
 * Audience: internal legal team only. The file name carries an `INTERNAL`
 * suffix and the top of page 1 prints the same INTERNAL ONLY banner the
 * commentary DOCX uses. PLATFORM_BRIEF.md §5 rule 6 (clean/commentary
 * separation) applies — this artifact is on the commentary side of the
 * line.
 *
 * Content per Issue Card:
 *
 *   - issue_id · severity · source_agent · location
 *   - current human_decision (accepted / partially_accepted / rejected / deferred / pending)
 *   - "Recommended response position" — derived from `recommended_action`
 *     and `human_decision`. This is the in-meeting talking point.
 *   - problem / recommended_revision / partial_note
 *
 * Followed by:
 *
 *   - Playbook negotiation_positions (the lawyer's published fallback ladder)
 *   - Playbook common_risks (for context)
 *
 * No LLM call. No network. Pure CPU.
 */
export async function buildNegotiationMatrix(
  input: ExportRenderInput,
): Promise<ExportRenderResult> {
  const project_name = input.project.name;
  const version_number = input.contract_version.version_number;
  const contract_type = input.playbook?.contract_type ?? "Contract";

  const banner = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: COMMENTARY_INTERNAL_HEADER,
        bold: true,
        color: "B91C1C", // tailwind red-700
        size: 28,
      }),
    ],
  });
  const subBanner = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: `협상 매트릭스 / Negotiation Matrix · ${contract_type} · ${project_name} · ${version_number}`,
        color: "555555",
      }),
    ],
  });

  const metaSection: Paragraph[] = [
    new Paragraph({ text: "" }),
    heading2("문서 메타 / Document metadata"),
    metaLine("Project ID", input.project.id),
    metaLine("Contract Version ID", input.contract_version.id),
    metaLine("Source Pack ID", input.source_pack_id),
    metaLine("Playbook ID", input.playbook?.id ?? "(none)"),
    metaLine("Generated at", input.generated_at),
    metaLine("Total Issue Cards", String(input.issue_cards.length)),
  ];

  const matrixSection: Paragraph[] = renderMatrix(input.issue_cards);
  const playbookSection: Paragraph[] = renderPlaybookSection(input.playbook);
  const summarySection: Paragraph[] = renderDecisionSummary(input.issue_cards);

  const footer = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: COMMENTARY_INTERNAL_FOOTER,
        bold: true,
        color: "B91C1C",
      }),
    ],
  });

  const doc = new Document({
    creator: "ContractOps AI",
    title: `${project_name} — ${version_number} (negotiation matrix, INTERNAL)`,
    description:
      "Internal negotiation matrix. Per-issue position, fallback, partial-acceptance notes. Confidential — do not send externally.",
    sections: [
      {
        children: [
          banner,
          subBanner,
          ...metaSection,
          ...summarySection,
          ...matrixSection,
          ...playbookSection,
          new Paragraph({ text: "" }),
          footer,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const file_name = `${safeFileNamePart(project_name)}_${safeFileNamePart(version_number)}_negotiation_matrix_INTERNAL.docx`;
  return {
    buffer: new Uint8Array(buffer),
    file_name,
    mime_type: DOCX_MIME_TYPE,
  };
}

// ---------- helpers ----------

function heading2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true })],
  });
}

function metaLine(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: "555555" }),
      new TextRun({ text: value }),
    ],
  });
}

function renderDecisionSummary(cards: IssueCard[]): Paragraph[] {
  const counts: Record<IssueHumanDecision, number> = {
    pending: 0,
    accepted: 0,
    partially_accepted: 0,
    rejected: 0,
    deferred: 0,
  };
  for (const c of cards) counts[c.human_decision]++;

  const out: Paragraph[] = [];
  out.push(new Paragraph({ text: "" }));
  out.push(heading2("결정 요약 / Decision summary"));
  out.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `accepted=${counts.accepted} · partially_accepted=${counts.partially_accepted} · rejected=${counts.rejected} · deferred=${counts.deferred} · pending=${counts.pending}`,
        }),
      ],
    }),
  );
  return out;
}

function renderMatrix(cards: IssueCard[]): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(new Paragraph({ text: "" }));
  out.push(heading2(`이슈별 협상 매트릭스 / Per-issue matrix (${cards.length})`));
  if (cards.length === 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No Issue Cards on record.",
            italics: true,
            color: "777777",
          }),
        ],
      }),
    );
    return out;
  }
  for (const c of cards) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${c.issue_id} · ${c.source_agent} · ${c.severity} · ${c.human_decision}`,
            bold: true,
          }),
        ],
      }),
    );
    const loc =
      [c.location.article, c.location.paragraph, c.location.item]
        .filter(Boolean)
        .join(" ") || "(location unspecified)";
    out.push(plainLine("Location", loc));
    out.push(plainLine("Issue type", c.issue_type));
    out.push(plainLine("Problem", c.problem));
    out.push(plainLine("Recommended revision", c.recommended_revision));
    if (c.partial_note) {
      out.push(plainLine("Partial note (carried into revision)", c.partial_note));
    }
    out.push(
      plainLine(
        "Recommended response position",
        responsePosition(c.recommended_action, c.human_decision),
      ),
    );
    out.push(plainLine("Why it matters", c.why_it_matters));
    out.push(plainLine("Business impact", c.business_impact));
    out.push(new Paragraph({ text: "" }));
  }
  return out;
}

function renderPlaybookSection(playbook: ExportRenderInput["playbook"]): Paragraph[] {
  const out: Paragraph[] = [];
  if (!playbook) return out;
  out.push(new Paragraph({ text: "" }));
  out.push(heading2("Playbook 협상 포지션 / Playbook negotiation positions"));
  const positions = playbook.negotiation_positions ?? [];
  if (positions.length === 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "(Playbook does not list pre-published negotiation positions.)",
            italics: true,
            color: "777777",
          }),
        ],
      }),
    );
  } else {
    for (const p of positions) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: `· ${p}` })],
        }),
      );
    }
  }

  const risks = playbook.common_risks ?? [];
  if (risks.length > 0) {
    out.push(new Paragraph({ text: "" }));
    out.push(heading2("Playbook 공통 리스크 / Playbook common risks"));
    for (const r of risks) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: `· ${r}`, color: "555555" })],
        }),
      );
    }
  }
  return out;
}

function plainLine(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: "555555" }),
      new TextRun({ text: value }),
    ],
  });
}

/**
 * Translate (recommended_action × human_decision) into the in-meeting talking
 * point a lawyer can read off the matrix. Pure derivation — no LLM.
 */
function responsePosition(
  action: IssueRecommendedAction,
  decision: IssueHumanDecision,
): string {
  if (decision === "rejected") {
    return "우리 입장 유지 — 상대 주장 거부, 기존 조항대로 진행. Reject counterparty position; keep our prior clause.";
  }
  if (decision === "deferred") {
    return "다음 라운드로 이연 — 추가 정보 수집 후 재논의. Defer to next round; gather more information first.";
  }
  if (decision === "partially_accepted") {
    return "부분 수용 — partial_note 범위 내에서만 수용, 전체 권고는 거부. Partial acceptance; only the noted scope, not the full recommendation.";
  }
  if (decision === "accepted") {
    switch (action) {
      case "accept":
        return "전적 수용 — 권고대로 채택. Adopt recommended revision in full.";
      case "revise":
        return "수정안 채택 — 권고된 수정 내용으로 협상. Propose recommended_revision as our position.";
      case "reject":
        return "(혼합 신호) 행동 권고가 reject인데 결정이 accepted — 회의에서 확인 필요. (Mixed signal — confirm in meeting.)";
      case "defer":
        return "(혼합 신호) 행동 권고가 defer인데 결정이 accepted — 회의에서 확인 필요. (Mixed signal — confirm in meeting.)";
    }
  }
  // pending
  switch (action) {
    case "accept":
      return "(미결) 권고: 수용 — 변호사 결정 필요. (Pending) Recommendation: accept — lawyer decision required.";
    case "revise":
      return "(미결) 권고: 수정 협상 — 변호사 결정 필요. (Pending) Recommendation: negotiate revision — lawyer decision required.";
    case "reject":
      return "(미결) 권고: 거부 — 변호사 결정 필요. (Pending) Recommendation: reject — lawyer decision required.";
    case "defer":
      return "(미결) 권고: 이연 — 변호사 결정 필요. (Pending) Recommendation: defer — lawyer decision required.";
  }
  return "(unknown)";
}
