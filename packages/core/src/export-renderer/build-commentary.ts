import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import {
  COMMENTARY_INTERNAL_FOOTER,
  COMMENTARY_INTERNAL_HEADER,
} from "./forbidden-markers";
import { DOCX_MIME_TYPE, type ExportRenderInput, type ExportRenderResult } from "./types";
import { safeFileNamePart } from "./util";

/**
 * Builds the internal-only commentary DOCX.
 *
 * What goes here that the clean DOCX does NOT have (PLATFORM_BRIEF.md §5
 * rule 6):
 *
 *   - top-of-page INTERNAL ONLY banner (Korean + English);
 *   - Issue Card summary table (ALL cards, including rejected — the lawyer
 *     reading commentary wants the full decision trail);
 *   - deterministic QA summary (per-run pass counts and findings);
 *   - AgentRun summary (which roles ran on which provider/model);
 *   - footer reminder that the document is internal-only.
 *
 * The contract body itself is included so a reviewer can read commentary
 * alongside the text — but it is the same body as the clean export. The
 * marker fields ensure this DOCX self-identifies as internal.
 */
export async function buildCommentaryDocx(
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
        size: 28, // half-points → 14pt
      }),
    ],
  });

  const subBanner = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: `${contract_type} · ${project_name} · ${version_number}`,
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
  ];

  const bodySection: Paragraph[] = [
    new Paragraph({ text: "" }),
    heading2("계약 본문 / Contract body"),
    ...contractBodyParagraphs(input.contract_version.content ?? ""),
  ];

  const issueSection: Paragraph[] = renderIssueCards(input.issue_cards);
  const qaSection: Paragraph[] = renderDeterministicQA(input.qa_runs);
  const runSection: Paragraph[] = renderAgentRuns(input.agent_runs);

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
    title: `${project_name} — ${version_number} (commentary, INTERNAL)`,
    description:
      "Internal-only legal commentary export. Confidential. Do not send externally.",
    sections: [
      {
        children: [
          banner,
          subBanner,
          ...metaSection,
          ...bodySection,
          ...issueSection,
          ...qaSection,
          ...runSection,
          new Paragraph({ text: "" }),
          footer,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  const file_name = `${safeFileNamePart(project_name)}_${safeFileNamePart(version_number)}_commentary_INTERNAL.docx`;

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

function contractBodyParagraphs(body: string): Paragraph[] {
  return body.split(/\r?\n/).map((line) => {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) return new Paragraph({ text: "" });
    if (/^제\s*\d+\s*조/.test(trimmed)) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun({ text: trimmed, bold: true })],
      });
    }
    return new Paragraph({ children: [new TextRun({ text: trimmed })] });
  });
}

function renderIssueCards(cards: ExportRenderInput["issue_cards"]): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(new Paragraph({ text: "" }));
  out.push(heading2(`Issue Card 결정 / Issue Card decisions (${cards.length})`));
  if (cards.length === 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: "No Issue Cards on record.", italics: true, color: "777777" }),
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
    if (c.location?.article) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Location: ", bold: true, color: "555555" }),
            new TextRun({
              text: `${c.location.article}${c.location.paragraph ? ` ${c.location.paragraph}` : ""}${c.location.item ? ` ${c.location.item}` : ""}`,
            }),
          ],
        }),
      );
    }
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Problem: ", bold: true, color: "555555" }),
          new TextRun({ text: c.problem }),
        ],
      }),
    );
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Recommended revision: ", bold: true, color: "555555" }),
          new TextRun({ text: c.recommended_revision }),
        ],
      }),
    );
    if (c.partial_note) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Partial note: ", bold: true, color: "555555" }),
            new TextRun({ text: c.partial_note }),
          ],
        }),
      );
    }
    out.push(new Paragraph({ text: "" }));
  }
  return out;
}

function renderDeterministicQA(
  qa_runs: ExportRenderInput["qa_runs"],
): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(new Paragraph({ text: "" }));
  out.push(heading2(`결정론적 QA 요약 / Deterministic QA summary (${qa_runs.length} run(s))`));
  if (qa_runs.length === 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No deterministic QA runs on record.",
            italics: true,
            color: "777777",
          }),
        ],
      }),
    );
    return out;
  }
  qa_runs.forEach((run, idx) => {
    const passes = run.checks_run.filter((c) => c.finding_count === 0);
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Run #${idx + 1} · checks=${run.checks_run.length} · passes=${passes.length} · findings=${run.findings.length}`,
            bold: true,
          }),
        ],
      }),
    );
    // Per-check breakdown so the reader sees which check produced what.
    for (const exec of run.checks_run) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `  · ${exec.check_id} → ${exec.finding_count} finding(s)`,
              color: "555555",
            }),
          ],
        }),
      );
    }
    if (run.findings.length > 0) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: "Findings:", bold: true, color: "555555" })],
        }),
      );
      for (const f of run.findings) {
        out.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `  · ${f.check_id} [${f.severity}] ${f.problem}`,
                color: "555555",
              }),
            ],
          }),
        );
      }
    }
    out.push(new Paragraph({ text: "" }));
  });
  return out;
}

function renderAgentRuns(runs: ExportRenderInput["agent_runs"]): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(new Paragraph({ text: "" }));
  out.push(heading2(`Agent / Provider 사용 / AgentRun summary (${runs.length} run(s))`));
  if (runs.length === 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No AgentRuns on record.",
            italics: true,
            color: "777777",
          }),
        ],
      }),
    );
    return out;
  }
  for (const r of runs) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${r.role} · ${r.provider_id} (${r.mode}) · ${r.model_id} · started_at=${r.started_at}${r.status === "completed" ? "" : ` · status=${r.status}`}`,
          }),
        ],
      }),
    );
  }
  return out;
}
