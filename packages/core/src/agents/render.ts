import type {
  ContractVersion,
  IntakeAnswer,
  IntakeQuestion,
  IssueCard,
  Playbook,
  SourceDocument,
  SourceDocumentContent,
} from "@contractops/schemas";

/**
 * Helpers that turn typed entities into plain-text blocks suitable for
 * substitution into prompt templates. Generic — no contract-name branching.
 */

export function formatSourceList(
  documents: SourceDocument[],
  contents: SourceDocumentContent[],
): string {
  if (documents.length === 0) return "(no source documents)";
  const byId = new Map(contents.map((c) => [c.source_document_id, c]));
  return documents
    .map((d) => {
      const content = byId.get(d.id);
      const head = `- [${d.source_type}] ${d.file_name} (v${d.version}, priority ${d.source_priority})`;
      if (!content) return head;
      const preview = content.text_content.length > 800
        ? content.text_content.slice(0, 800) + "…[truncated]"
        : content.text_content;
      return `${head}\n  --- content (synthetic=${content.is_synthetic}) ---\n  ${preview.replace(/\n/g, "\n  ")}\n  --- end ---`;
    })
    .join("\n");
}

export function formatIntake(
  questions: IntakeQuestion[],
  answers: IntakeAnswer[],
): string {
  if (questions.length === 0) return "(no intake questions)";
  const byQid = new Map(answers.map((a) => [a.question_id, a.value]));
  return questions
    .map((q) => `- ${q.required ? "[required] " : ""}${q.key}: ${byQid.get(q.id) ?? "(unanswered)"}`)
    .join("\n");
}

export function formatPlaybookSummary(playbook: Playbook): string {
  const lines: string[] = [];
  lines.push(`contract_type: ${playbook.contract_type}`);
  lines.push(`contract_family: ${playbook.contract_family}`);
  lines.push(`legal_characterization: ${playbook.legal_characterization}`);
  if (playbook.default_table_of_contents.length) {
    lines.push("default_table_of_contents:");
    for (const t of playbook.default_table_of_contents) lines.push(`  - ${t}`);
  }
  if (playbook.mandatory_clauses.length) {
    lines.push("mandatory_clauses:");
    for (const c of playbook.mandatory_clauses) lines.push(`  - ${c.heading} (${c.key})`);
  }
  if (playbook.common_risks.length) {
    lines.push("common_risks:");
    for (const r of playbook.common_risks) lines.push(`  - ${r}`);
  }
  if (playbook.red_flags.length) {
    lines.push("red_flags:");
    for (const f of playbook.red_flags) lines.push(`  - ${f}`);
  }
  if (playbook.negotiation_positions.length) {
    lines.push("negotiation_positions:");
    for (const p of playbook.negotiation_positions) lines.push(`  - ${p}`);
  }
  if (playbook.drafting_style_notes.length) {
    lines.push("drafting_style_notes:");
    for (const s of playbook.drafting_style_notes) lines.push(`  - ${s}`);
  }
  if (playbook.final_qa_checklist.length) {
    lines.push("final_qa_checklist:");
    for (const c of playbook.final_qa_checklist) lines.push(`  - ${c}`);
  }
  return lines.join("\n");
}

export function formatIssueCards(cards: IssueCard[]): string {
  if (cards.length === 0) return "(no issue cards)";
  return cards
    .map((c) => {
      const note = c.partial_note ? ` partial_note=${c.partial_note}` : "";
      return `- ${c.issue_id} [${c.severity}] (${c.source_agent}, ${c.issue_type}): ${c.problem} → ${c.recommended_revision}${note}`;
    })
    .join("\n");
}

export function formatContractContent(version: ContractVersion): string {
  return `version=${version.version_number}\n---\n${version.content}\n---`;
}
