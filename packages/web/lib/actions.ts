import * as core from "@contractops/core";
import type * as S from "@contractops/schemas";
import type { Operation } from "./operations";

// Re-export ProjectState from core so pages don't need a second import.
export type { ProjectState } from "@contractops/core";

/**
 * Browser-side application store (Milestone 3D).
 *
 * Now backed by the server's in-memory store at `/api/projects` — the
 * StoreProvider fetches from the server on mount and re-fetches after
 * every mutation. The browser keeps a cached copy in React state for
 * synchronous UI rendering.
 */
export interface AppStore {
  projectIds: string[];
  projects: Record<string, core.ProjectState>;
  /** Flat per-project audit collection, fetched alongside ProjectState. */
  audits: S.AuditLog[];
}

export function emptyStore(): AppStore {
  return { projectIds: [], projects: {}, audits: [] };
}

// Demo actors — used by the server-side AggregateContext builder. They
// stay in this client-safe module so server and client agree on the
// canonical actor ids that get written into AuditLog payloads.
export const DEMO_USER: S.Actor = {
  id: "user_demo",
  role: "user",
  display_name: "Demo User",
};

export const DEMO_LAWYER: S.Actor = {
  id: "lawyer_demo",
  role: "human_lawyer",
  display_name: "Demo Lawyer",
};

export function makeEnv(): core.Env {
  return {
    newId: () => {
      if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      }
      return Math.random().toString(36).slice(2, 14);
    },
    now: () => new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Operation builders (Milestone 3D).
//
// Each `act*` function used to call core directly; now it returns a
// SERIALIZABLE descriptor that the StoreProvider POSTs to the
// /api/projects/[id]/operations route. The server dispatches it back to
// the same core function — workflow logic still lives in @contractops/core.
// ───────────────────────────────────────────────────────────────────────

export function actAddSource(args: {
  file_name: string;
  source_type: S.SourceType;
  version: string;
  incorporated: boolean;
  source_priority: number;
}): Operation {
  return { name: "add_source", args };
}

export function actAddSourceContent(args: {
  source_document_id: string;
  text_content: string;
  language?: string | null;
}): Operation {
  return { name: "add_source_content", args };
}

export function actLockSourcePack(): Operation {
  return { name: "lock_source_pack", args: {} };
}

export function actClassifyAndConfirm(args: {
  confirmed_type: string;
  hint?: string;
}): Operation {
  return { name: "classify_and_confirm", args };
}

export function actSelectPlaybook(): Operation {
  // The server loads the playbook catalog itself (it has filesystem
  // access). No need to send the catalog over the wire.
  return { name: "select_playbook", args: {} };
}

export function actAnswerIntake(args: {
  question_id: string;
  value: string;
}): Operation {
  return { name: "answer_intake", args };
}

export function actDraftDealMemo(): Operation {
  return { name: "draft_deal_memo", args: {} };
}

export function actApproveDealMemo(): Operation {
  return { name: "approve_deal_memo", args: {} };
}

export function actDraftDraftingPlan(): Operation {
  return { name: "draft_drafting_plan", args: {} };
}

export function actApproveDraftingPlan(): Operation {
  return { name: "approve_drafting_plan", args: {} };
}

export function actCreateV0(): Operation {
  return { name: "create_v0", args: {} };
}

export function actRunMockReviews(): Operation {
  return { name: "run_mock_reviews", args: {} };
}

export function actDecideIssue(args: {
  issue_id: string;
  decision: core.IssueDecisionOutcome;
  partial_note?: string;
  reason_note?: string;
}): Operation {
  return { name: "decide_issue", args };
}

export function actRunMockFinalQA(): Operation {
  return { name: "run_mock_final_qa", args: {} };
}

export function actCreateRevision(): Operation {
  return { name: "create_revision", args: {} };
}

export function actApproveFinal(): Operation {
  return { name: "approve_final", args: {} };
}

export function actCreateExport(args: {
  export_type: S.ExportType;
  content: string;
  file_name?: string;
}): Operation {
  return { name: "create_export", args };
}

// ───────────────────────────────────────────────────────────────────────
// Playbook-driven canned mock responses (used by the server-side
// AggregateContext builder in `lib/server-aggregate-context.ts`).
//
// Pure function — no side effects, no imports of network/IO modules —
// so it is safe to share between client and server. (Today only the
// server uses it, but pages may call into it for previews in future.)
// ───────────────────────────────────────────────────────────────────────

function rid(prompt_id: string, input_id: string): string {
  return `${prompt_id}::${input_id}`;
}

export function buildPlaybookCannedResponses(
  state: core.ProjectState,
): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  const playbook = state.playbook;
  const project_id = state.project.id;
  const latest = state.contract_versions[state.contract_versions.length - 1];

  if (!playbook) return responses;

  responses[rid("deal_memo_drafter", project_id)] = {
    content: composeDealMemo(state),
    warnings: state.intake_questions
      .filter((q) => q.required)
      .filter((q) => !state.intake_answers.some((a) => a.question_id === q.id))
      .map((q) => `missing intake: ${q.key}`),
  };

  responses[rid("drafting_plan_drafter", project_id)] = {
    content: composeDraftingPlan(state),
    table_of_contents: playbook.default_table_of_contents,
    is_custom: playbook.is_custom_marker,
    open_questions: [],
  };

  responses[rid("contract_drafter", project_id)] = {
    content: composeV0Draft(state),
    version_number: "v0",
    notes: [],
  };

  if (latest) {
    const risks = playbook.common_risks.slice(0, 2);
    const flags = playbook.red_flags.slice(0, 1);

    responses[rid("counterparty_reviewer", latest.id)] = {
      findings: [
        ...risks.slice(0, 1).map((text, i) => ({
          source_agent: "mock_counterparty",
          severity: "high" as const,
          location: { article: `제${i + 3}조` },
          issue_type: "playbook_risk",
          problem: text,
          why_it_matters: `Playbook common_risks #${i + 1}: ${text}`,
          recommended_revision: `Address: ${text}`,
          business_impact: "moderate",
          recommended_action: "revise" as const,
        })),
        ...flags.map((text, i) => ({
          source_agent: "mock_counterparty",
          severity: "critical" as const,
          location: { article: `제${i + 7}조` },
          issue_type: "red_flag",
          problem: text,
          why_it_matters: `Playbook red_flags: ${text}`,
          recommended_revision: `Remove or limit: ${text}`,
          business_impact: "high",
          recommended_action: "revise" as const,
        })),
      ],
    };

    responses[rid("source_consistency_reviewer", latest.id)] = {
      findings: risks.slice(1).map((text, i) => ({
        source_agent: "mock_source_consistency",
        severity: "medium" as const,
        location: { article: `제${i + 6}조` },
        issue_type: "source_inconsistency",
        problem: text,
        why_it_matters: "Cross-checked against source documents (mock).",
        recommended_revision: `Reconcile against sources for: ${text}`,
        business_impact: "low",
        recommended_action: "revise" as const,
      })),
    };

    responses[rid("legal_style_reviewer", latest.id)] = {
      findings: [
        {
          source_agent: "mock_legal_style",
          severity: "low" as const,
          location: {},
          issue_type: "numbering",
          problem: "Confirm Korean numbering 제·①·1.·가.",
          why_it_matters: "Korean drafting convention (PLATFORM_BRIEF.md §6).",
          recommended_revision: "Apply Korean article/paragraph/item numbering throughout.",
          business_impact: "low",
          recommended_action: "accept" as const,
        },
      ],
    };

    const accepted = state.issue_cards.filter(
      (c) => c.human_decision === "accepted" || c.human_decision === "partially_accepted",
    );
    responses[rid("revision_agent", latest.id)] = {
      content: composeRevisionBody(state, latest, accepted),
      applied_issue_card_ids: accepted.map((c) => c.issue_id),
      notes: [],
    };

    responses[rid("final_qa_assistant", latest.id)] = {
      findings: [],
      passes: playbook.final_qa_checklist,
    };
  }

  return responses;
}

function composeDealMemo(state: core.ProjectState): string {
  const playbook = state.playbook!;
  const lines: string[] = [];
  lines.push(`# Mock Deal Memo`);
  lines.push(`Project: ${state.project.name}`);
  lines.push(`Contract type: ${playbook.contract_type}`);
  lines.push(``);
  lines.push(`## Source documents (${state.source_documents.length})`);
  for (const d of state.source_documents) {
    const hasContent = state.source_contents.some((c) => c.source_document_id === d.id);
    lines.push(`- [${d.source_type}] ${d.file_name} (v${d.version})${hasContent ? " · content attached" : ""}`);
  }
  lines.push(``);
  lines.push(`## Intake responses`);
  for (const q of state.intake_questions) {
    const a = state.intake_answers.find((x) => x.question_id === q.id);
    lines.push(`- **${q.key}**: ${a?.value ?? "(unanswered)"}`);
  }
  if (playbook.common_risks.length) {
    lines.push(``);
    lines.push(`## Common risks from Playbook`);
    for (const r of playbook.common_risks) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}

function composeDraftingPlan(state: core.ProjectState): string {
  const playbook = state.playbook!;
  const lines: string[] = [];
  lines.push(`# Mock Drafting Plan`);
  lines.push(`Contract type: ${playbook.contract_type}`);
  if (playbook.is_custom_marker) {
    lines.push(`**Mode: Custom Contract — human-approved Drafting Plan required before drafting.**`);
  } else {
    lines.push(`Mode: Standard Playbook`);
  }
  lines.push(``);
  lines.push(`## Table of Contents`);
  if (playbook.default_table_of_contents.length) {
    for (const toc of playbook.default_table_of_contents) lines.push(`- ${toc}`);
  } else {
    lines.push(`- (to be defined ad-hoc)`);
  }
  if (playbook.mandatory_clauses.length) {
    lines.push(``);
    lines.push(`## Mandatory clauses`);
    for (const c of playbook.mandatory_clauses) lines.push(`- ${c.heading} (\`${c.key}\`)`);
  }
  if (playbook.negotiation_positions.length) {
    lines.push(``);
    lines.push(`## Negotiation positions`);
    for (const p of playbook.negotiation_positions) lines.push(`- ${p}`);
  }
  return lines.join("\n");
}

function composeV0Draft(state: core.ProjectState): string {
  const playbook = state.playbook!;
  const toc = playbook.default_table_of_contents;
  if (toc.length === 0) {
    return [
      `[MOCK v0 DRAFT — Custom Contract]`,
      ``,
      state.drafting_plan?.content ?? "",
      ``,
      `[Body to be drafted from human-approved Drafting Plan]`,
    ].join("\n");
  }
  // Deliberately seed one article with a Korean forbidden-expression token
  // ("기타") so the deterministic-QA engine always has at least one finding
  // for the demo + the deterministic-qa e2e spec. PLATFORM_BRIEF.md §6
  // discourages 기타 in favor of 그 밖의; the deterministic QA flags it.
  const articles = toc
    .map((heading, i) => {
      const body = `  [Mock body for ${heading} — derived from Playbook + Drafting Plan]`;
      if (i === toc.length - 1) {
        return `${heading}\n${body}\n  기타 부수적인 사항은 양 당사자가 별도 협의한다.`;
      }
      return `${heading}\n${body}`;
    })
    .join("\n\n");
  return `[MOCK v0 DRAFT — ${playbook.contract_type}]\n\n${articles}`;
}

function composeRevisionBody(
  state: core.ProjectState,
  prev: S.ContractVersion,
  appliedCards: S.IssueCard[],
): string {
  const sections = appliedCards.map((c) =>
    c.partial_note
      ? `[Partial revision for ${c.issue_id} (partial_note=${c.partial_note}): ${c.recommended_revision}]`
      : `[Revision for ${c.issue_id}: ${c.recommended_revision}]`,
  );
  if (sections.length === 0) return prev.content;
  return [prev.content, ...sections].join("\n\n");
}

// ───────────────────────────────────────────────────────────────────────
// Export content placeholders — pure helpers used by the exports page
// to show a human-readable summary alongside each downloaded binary.
// They never touch the server; they just stringify ProjectState slices.
// ───────────────────────────────────────────────────────────────────────

export function mockCleanExportContent(
  state: core.ProjectState,
  finalVersion: S.ContractVersion,
): string {
  return [
    `[CLEAN EXTERNAL CONTRACT — ${state.playbook?.contract_type ?? "Contract"}]`,
    `Project: ${state.project.name}`,
    `Version: ${finalVersion.version_number}`,
    ``,
    finalVersion.content,
  ].join("\n");
}

export function mockCommentaryExportContent(
  state: core.ProjectState,
  finalVersion: S.ContractVersion,
): string {
  const lines: string[] = [];
  lines.push(`[COMMENTARY] Internal legal commentary — DO NOT SEND EXTERNALLY`);
  lines.push(`Project: ${state.project.name}`);
  lines.push(`Version: ${finalVersion.version_number}`);
  lines.push(``);
  lines.push(`[COMMENTARY] Issue Card decisions:`);
  for (const c of state.issue_cards) {
    lines.push(
      `[INTERNAL] - ${c.issue_id} (${c.source_agent}, ${c.severity}): ${c.human_decision}${c.partial_note ? ` — partial_note: ${c.partial_note}` : ""}`,
    );
  }
  lines.push(``);
  lines.push(`[REDLINE_RATIONALE]`);
  lines.push(`Why the accepted revisions were applied: see Issue Cards above.`);
  return lines.join("\n");
}

export function mockNegotiationMatrixContent(state: core.ProjectState): string {
  const lines: string[] = ["[NEGOTIATION_GUIDANCE] Negotiation Matrix (internal)"];
  lines.push(``);
  for (const c of state.issue_cards.filter((x) => x.human_decision !== "rejected")) {
    lines.push(
      `- ${c.location.article ?? "?"} — ${c.issue_type} (${c.severity}): proposed=${c.recommended_revision}`,
    );
  }
  return lines.join("\n");
}

export function mockCoverEmailContent(
  state: core.ProjectState,
  finalVersion: S.ContractVersion,
): string {
  return [
    `Subject: ${state.playbook?.contract_type ?? "Contract"} 검토본 송부`,
    ``,
    `안녕하십니까,`,
    ``,
    `${state.playbook?.contract_type ?? "계약서"} ${finalVersion.version_number} 버전을 송부드립니다.`,
    `검토 후 회신 부탁드립니다.`,
    ``,
    `감사합니다.`,
  ].join("\n");
}
