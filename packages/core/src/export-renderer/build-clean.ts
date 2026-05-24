import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

import {
  CLEAN_FORBIDDEN_MARKERS,
  findForbiddenMarker,
} from "./forbidden-markers";
import { DOCX_MIME_TYPE, type ExportRenderInput, type ExportRenderResult } from "./types";
import { safeFileNamePart } from "./util";

/**
 * Builds the external-facing clean contract DOCX.
 *
 * Rules enforced here (PLATFORM_BRIEF.md §5 rules 5–7,
 * docs/06_ACCEPTANCE_CRITERIA.md §13):
 *
 *   - The contract body is emitted verbatim from the final ContractVersion
 *     content. We trust the workflow: the Revision Agent applies only
 *     accepted / partially-accepted Issue Cards (PLATFORM_BRIEF.md §5 rule 5),
 *     so the final version content already excludes rejected revisions.
 *
 *   - The renderer additionally walks every text fragment we are about to
 *     emit and confirms no internal-commentary marker is present. If one
 *     is, we throw rather than emit the file. This is the last line of
 *     defense against an upstream regression accidentally leaking
 *     commentary into the clean export.
 *
 *   - No reviewer commentary, no Issue Card rationale, no internal QA notes
 *     are written here. Only: project name, version, source pack id,
 *     playbook id, contract body, signature block.
 */
export async function buildCleanDocx(input: ExportRenderInput): Promise<ExportRenderResult> {
  const project_name = input.project.name;
  const version_number = input.contract_version.version_number;
  const contract_type = input.playbook?.contract_type ?? "Contract";
  const body = input.contract_version.content ?? "";

  // Pre-render scrub: refuse to emit if the input itself already contains
  // any internal-commentary marker. Throwing here surfaces an upstream bug
  // (revision pipeline leaking commentary into the contract body).
  const leaked = findForbiddenMarker(body);
  if (leaked) {
    throw new Error(
      `clean DOCX render refused: contract body contains forbidden marker "${leaked}". ` +
        "See PLATFORM_BRIEF.md §5 rules 6/7.",
    );
  }

  // Build the document while tracking every plain-text fragment we emit, so
  // the post-scrub does not depend on `docx`'s internal serialization.
  const allText: string[] = [];
  const text = (s: string): string => {
    allText.push(s);
    return s;
  };

  const headingParas: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: text(project_name) })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: text(contract_type), bold: true }),
        new TextRun({ text: text(`   |   `), color: "888888" }),
        new TextRun({ text: text(`Version ${version_number}`), color: "555555" }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  const metaParas: Paragraph[] = [
    metaLine("Source Pack ID", input.source_pack_id, text),
    metaLine("Playbook ID", input.playbook?.id ?? "(none)", text),
    metaLine("Contract Version ID", input.contract_version.id, text),
    metaLine("Generated at", input.generated_at, text),
    new Paragraph({ text: "" }),
  ];

  const bodyParas: Paragraph[] = contractBodyParagraphs(body, text);

  const signatureParas: Paragraph[] = [
    new Paragraph({ text: "" }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: text("서명 / Signatures"), bold: true })],
    }),
    new Paragraph({ text: "" }),
    signatureLine("Party A", text),
    signatureLine("Party B", text),
  ];

  // Final scrub: every text fragment we emitted, concatenated. Catches the
  // case where some helper accidentally injects commentary into a heading
  // or metadata line.
  const renderedText = allText.join("\n");
  const finalLeak = findForbiddenMarker(renderedText);
  if (finalLeak) {
    throw new Error(
      `clean DOCX render refused (post-scrub): forbidden marker "${finalLeak}" appeared in rendered text. ` +
        "Check renderer helpers for accidental commentary inclusion.",
    );
  }

  const doc = new Document({
    creator: "ContractOps AI",
    title: `${project_name} — ${version_number} (clean)`,
    description: "External-facing clean contract export. Contains no internal commentary.",
    sections: [
      {
        children: [...headingParas, ...metaParas, ...bodyParas, ...signatureParas],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  const file_name = `${safeFileNamePart(project_name)}_${safeFileNamePart(version_number)}_clean.docx`;

  return {
    buffer: new Uint8Array(buffer),
    file_name,
    mime_type: DOCX_MIME_TYPE,
  };
}

// ---------- helpers ----------

function metaLine(
  label: string,
  value: string,
  text: (s: string) => string,
): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: text(`${label}: `), bold: true, color: "555555" }),
      new TextRun({ text: text(value) }),
    ],
  });
}

function signatureLine(label: string, text: (s: string) => string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: text(`${label}: `), bold: true }),
      new TextRun({
        text: text("___________________________  (date: ____________)"),
      }),
    ],
  });
}

/**
 * Splits the contract body into paragraphs and tags any line that looks
 * like a Korean article header ("제N조") as Heading 2 so Word's navigation
 * pane renders a table of contents.
 */
function contractBodyParagraphs(body: string, text: (s: string) => string): Paragraph[] {
  const lines = body.split(/\r?\n/);
  const out: Paragraph[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      out.push(new Paragraph({ text: "" }));
      continue;
    }
    if (/^제\s*\d+\s*조/.test(line)) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: text(line), bold: true })],
        }),
      );
      continue;
    }
    out.push(new Paragraph({ children: [new TextRun({ text: text(line) })] }));
  }
  return out;
}

/** Exposed for test reuse. */
export { CLEAN_FORBIDDEN_MARKERS };
