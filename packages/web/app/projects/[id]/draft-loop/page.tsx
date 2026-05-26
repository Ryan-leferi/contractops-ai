"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useCurrentActor, useStore } from "@/components/store-provider";
import { REQUIRES_LAWYER_MESSAGE, canActAsLawyer } from "@/lib/demo-actors";
import {
  actBatchAcceptReviewIssues,
  actCreateDraftIteration,
  actCreateRevision,
  actCreateV0,
  actRunMockReviews,
  actStopDraftLoop,
  actSynthesizeReviews,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { DraftIteration, IssueCard, RevisionSynthesisOutput } from "@contractops/schemas";

/**
 * Solo Drafting Loop (Pilot P1).
 *
 * One-page guided loop for a single in-house lawyer:
 *
 *   1. Source input summary (synthetic only; warning if missing).
 *   2. Open a new iteration.
 *   3. If no draft exists → "Generate initial draft" (contract_drafter).
 *   4. "Run multi-model review" (counterparty + source-consistency + legal-style).
 *   5. "Synthesize revision prompt" (review_synthesizer).
 *   6. "Accept all review suggestions for this iteration" (batch — excludes critical).
 *   7. "Generate revised draft" (revision_agent).
 *   8. "Stop loop / mark ready for final review".
 *   9. Comparison panel of past iterations.
 *
 * Every step requires a user click. No autonomous loop.
 *
 * Lawyer-only — actions disable for non-lawyer actors with the standard
 * REQUIRES_LAWYER_MESSAGE tooltip. Server-side RBAC enforces the same
 * via the `run_draft_loop` / `batch_accept_issues` permissions.
 */
export default function DraftLoopPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const actor = useCurrentActor();
  const isLawyer = canActAsLawyer(actor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const iterations = state.draft_iterations ?? [];
  const activeIteration = iterations.find((it) => it.status !== "stopped");
  const latestVersion = state.contract_versions[state.contract_versions.length - 1];
  const sourceTextCount = state.source_contents.length;
  const hasSourceText = sourceTextCount > 0;
  const pending = state.issue_cards.filter((c) => c.human_decision === "pending");
  const pendingNonCritical = pending.filter((c) => c.severity !== "critical");
  const pendingCritical = pending.filter((c) => c.severity === "critical");

  async function run(label: string, op: ReturnType<typeof actCreateDraftIteration>) {
    try {
      setError(null);
      setBusy(label);
      await applyProjectOp(params.id, op);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="draft-loop-page">
      <div>
        <h1 className="text-xl font-semibold">Solo Drafting Loop</h1>
        <p className="text-sm text-muted-foreground">
          One in-house lawyer drives a guided iteration: generate draft →
          multi-model review → synthesize → revise → stop. Mock by default.
          Every step requires a click — no autonomous loop. See README
          “Solo Drafting Loop”.
        </p>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="page-error"
        >
          {error}
        </div>
      )}

      {/* ── 1. Source input summary ─────────────────────────────── */}
      <Card data-testid="card-source-summary">
        <CardHeader>
          <CardTitle>1. Source input</CardTitle>
          <CardDescription>
            Business request emails, reference materials, prior contracts,
            term sheets, and internal instructions are loaded as
            <code className="mx-1">SourceDocumentContent</code> on the Sources
            page. No PDF parsing or OCR — paste synthetic text only.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Source docs" value={String(state.source_documents.length)} testid="stat-source-docs" />
            <Stat label="Source content rows" value={String(sourceTextCount)} testid="stat-source-content" />
            <Stat label="Pack locked" value={state.source_pack.locked ? "yes" : "no"} testid="stat-pack-locked" />
            <Stat label="Iterations" value={String(iterations.length)} testid="stat-iterations" />
          </div>
          {!hasSourceText && (
            <div
              className="rounded-md border border-warning bg-warning/10 p-2 text-sm"
              data-testid="warning-missing-source"
            >
              Source text is missing. Add source content before running real drafting.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Current draft + start iteration ──────────────────── */}
      <Card data-testid="card-current-draft">
        <CardHeader>
          <CardTitle>2. Current draft</CardTitle>
          <CardDescription>
            {latestVersion
              ? `Latest version: ${latestVersion.version_number} (${formatDateTime(latestVersion.created_at)})`
              : "No draft yet. Generate the initial draft below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <Button
            data-testid="btn-create-iteration"
            disabled={!isLawyer || busy !== null}
            title={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
            onClick={() => run("create-iteration", actCreateDraftIteration())}
          >
            {iterations.length === 0 ? "Start iteration 1" : `Start iteration ${iterations.length + 1}`}
          </Button>
          {activeIteration && (
            <p className="text-xs text-muted-foreground" data-testid="active-iteration-label">
              Active iteration: #{activeIteration.iteration_number} — status {activeIteration.status}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── 3. Initial draft (contract_drafter) ─────────────────── */}
      <Card data-testid="card-initial-draft">
        <CardHeader>
          <CardTitle>3. Generate initial GPT draft</CardTitle>
          <CardDescription>
            Uses the existing <code>contract_drafter</code> role. Mock by
            default; real mode requires <code>USE_REAL_LLM=true</code> +{" "}
            <code>REAL_LLM_ROLE_ALLOWLIST=contract_drafter</code> (Milestone 4A).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            data-testid="btn-create-v0"
            disabled={!isLawyer || busy !== null || !!latestVersion}
            title={
              !isLawyer
                ? REQUIRES_LAWYER_MESSAGE
                : latestVersion
                  ? "A draft already exists. Use steps 4–7 to iterate."
                  : undefined
            }
            onClick={() => run("create-v0", actCreateV0())}
          >
            Generate initial draft
          </Button>
        </CardContent>
      </Card>

      {/* ── 4. Multi-model review round ─────────────────────────── */}
      <Card data-testid="card-review-round">
        <CardHeader>
          <CardTitle>4. Run multi-model review round</CardTitle>
          <CardDescription>
            Counterparty (Claude seam if real), source-consistency
            (OpenAI in P1 — Gemini is the next focused task), legal-style
            (OpenAI). All findings become pending Issue Cards. Mock by
            default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            data-testid="btn-run-reviews"
            disabled={!isLawyer || busy !== null || !latestVersion}
            title={
              !isLawyer
                ? REQUIRES_LAWYER_MESSAGE
                : !latestVersion
                  ? "Generate the initial draft first."
                  : undefined
            }
            onClick={() => run("reviews", actRunMockReviews())}
          >
            Run review round
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Pending Issue Cards now: <span data-testid="pending-count">{pending.length}</span>
          </p>
        </CardContent>
      </Card>

      {/* ── 5. Synthesize revision prompt (review_synthesizer) ──── */}
      <Card data-testid="card-synthesize">
        <CardHeader>
          <CardTitle>5. Synthesize revision prompt</CardTitle>
          <CardDescription>
            Runs the <code>review_synthesizer</code> role to group
            duplicates, prioritize findings, flag reviewer conflicts, and
            produce an instruction package for <code>revision_agent</code>.
            Mock-only in P1; the same seam plugs in a future Gemini provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            data-testid="btn-synthesize"
            disabled={!isLawyer || busy !== null || !activeIteration || !latestVersion}
            title={
              !isLawyer
                ? REQUIRES_LAWYER_MESSAGE
                : !activeIteration
                  ? "Start an iteration first."
                  : undefined
            }
            onClick={() =>
              activeIteration &&
              run(
                "synthesize",
                actSynthesizeReviews({ iteration_id: activeIteration.id }),
              )
            }
          >
            Synthesize revision prompt
          </Button>
          {activeIteration && activeIteration.synthesis_output !== null ? (
            <SynthesisPreview
              synthesis={activeIteration.synthesis_output as RevisionSynthesisOutput}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* ── 6. Batch accept (lawyer convenience) ────────────────── */}
      <Card data-testid="card-batch-accept">
        <CardHeader>
          <CardTitle>6. Accept all non-critical review suggestions</CardTitle>
          <CardDescription>
            Convenience for the solo lawyer. Critical Issue Cards must be
            decided one at a time on the <code>Issues</code> page. Each
            accepted card appends a <code>decision_history</code> entry
            and an audit log — reversible only by a later decision change,
            never by deletion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            <Stat label="Pending (non-critical)" value={String(pendingNonCritical.length)} testid="stat-pending-noncritical" />
            <Stat label="Pending (critical)" value={String(pendingCritical.length)} variant={pendingCritical.length > 0 ? "warning" : "default"} testid="stat-pending-critical" />
          </div>
          {pendingCritical.length > 0 && (
            <p className="text-xs text-warning" data-testid="critical-warning">
              {pendingCritical.length} critical Issue Card(s) require individual decisions on the Issues page before batch accept will cover them.
            </p>
          )}
          <Button
            data-testid="btn-batch-accept"
            disabled={!isLawyer || busy !== null || pendingNonCritical.length === 0}
            title={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
            onClick={() =>
              run(
                "batch-accept",
                actBatchAcceptReviewIssues({
                  issue_ids: pendingNonCritical.map((c) => c.issue_id),
                  reason_note: `Batch accepted via Draft Loop (iteration ${activeIteration?.iteration_number ?? "?"})`,
                }),
              )
            }
          >
            Accept all {pendingNonCritical.length} non-critical suggestions
          </Button>
        </CardContent>
      </Card>

      {/* ── 7. Generate revised draft ───────────────────────────── */}
      <Card data-testid="card-revise">
        <CardHeader>
          <CardTitle>7. Generate revised draft</CardTitle>
          <CardDescription>
            Uses the existing <code>revision_agent</code> role.
            Rejected and deferred cards are NEVER applied (filtered by
            core <code>createRevisionVersion</code>). The synthesis package
            from step 5 informs the prompt; mocks ignore the synthesis
            body but real mode picks it up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            data-testid="btn-revise"
            disabled={!isLawyer || busy !== null || pending.length > 0 || !latestVersion}
            title={
              !isLawyer
                ? REQUIRES_LAWYER_MESSAGE
                : pending.length > 0
                  ? `Decide remaining ${pending.length} pending Issue Card(s) first.`
                  : undefined
            }
            onClick={() => run("revise", actCreateRevision())}
          >
            Generate revised draft
          </Button>
        </CardContent>
      </Card>

      {/* ── 8. Stop loop ────────────────────────────────────────── */}
      <Card data-testid="card-stop-loop">
        <CardHeader>
          <CardTitle>8. Stop loop / mark ready for final review</CardTitle>
          <CardDescription>
            Pure state transition — does not approve the contract.
            Use the QA &amp; Final page for final approval and the Exports
            page for clean/commentary downloads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            data-testid="btn-stop-loop"
            variant="outline"
            disabled={!isLawyer || busy !== null || !activeIteration}
            title={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
            onClick={() =>
              activeIteration &&
              run(
                "stop-loop",
                actStopDraftLoop({
                  iteration_id: activeIteration.id,
                  stop_note: "Marked ready for final review.",
                }),
              )
            }
          >
            Stop loop
          </Button>
        </CardContent>
      </Card>

      {/* ── 9. Iteration comparison panel ───────────────────────── */}
      <Card data-testid="card-comparison">
        <CardHeader>
          <CardTitle>9. Iteration history</CardTitle>
          <CardDescription>
            Per-iteration receipts. Heavy data (ContractVersions, Issue
            Cards, AgentRuns) lives in their own collections — these rows
            are an index.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {iterations.length === 0 ? (
            <p className="text-muted-foreground" data-testid="no-iterations">
              No iterations yet. Start one above.
            </p>
          ) : (
            <table className="w-full text-xs" data-testid="iterations-table">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">#</th>
                  <th className="text-left py-1">Status</th>
                  <th className="text-left py-1">Base → Result</th>
                  <th className="text-left py-1">Reviewed cards</th>
                  <th className="text-left py-1">Synthesizer</th>
                  <th className="text-left py-1">Stopped</th>
                </tr>
              </thead>
              <tbody>
                {iterations.map((it) => (
                  <IterationRow
                    key={it.id}
                    iteration={it}
                    issueCards={state.issue_cards}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  variant?: "default" | "success" | "warning";
  testid?: string;
}

function Stat({ label, value, variant = "default", testid }: StatProps) {
  return (
    <div className="rounded-md border p-2" data-testid={testid}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          variant === "success"
            ? "text-success font-medium"
            : variant === "warning"
              ? "text-warning font-medium"
              : "font-medium"
        }
      >
        {value}
      </div>
    </div>
  );
}

function SynthesisPreview({ synthesis }: { synthesis: RevisionSynthesisOutput }) {
  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="synthesis-preview">
      <p className="text-sm">{synthesis.summary}</p>
      {synthesis.priority_ordered_issues.length > 0 && (
        <div className="text-xs space-y-1">
          <div className="font-medium">Priority-ordered groups:</div>
          <ul className="list-disc pl-5">
            {synthesis.priority_ordered_issues.slice(0, 5).map((g, i) => (
              <li key={i}>
                <Badge variant={g.severity === "critical" ? "destructive" : "default"}>
                  {g.severity}
                </Badge>{" "}
                <span className="font-medium">{g.title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · sources: {g.source_issue_card_ids.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {synthesis.conflicts_between_reviewers.length > 0 && (
        <div className="text-xs">
          <div className="font-medium">Reviewer conflicts:</div>
          <ul className="list-disc pl-5">
            {synthesis.conflicts_between_reviewers.map((c, i) => (
              <li key={i}>{c.description}</li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer">Instructions for revision_agent</summary>
        <pre className="whitespace-pre-wrap mt-1 text-muted-foreground">
          {synthesis.instructions_for_gpt_revision}
        </pre>
      </details>
    </div>
  );
}

function IterationRow({
  iteration,
  issueCards,
}: {
  iteration: DraftIteration;
  issueCards: IssueCard[];
}) {
  const reviewed = iteration.review_issue_card_ids;
  const reviewedCards = issueCards.filter((c) => reviewed.includes(c.issue_id));
  const accepted = reviewedCards.filter(
    (c) => c.human_decision === "accepted" || c.human_decision === "partially_accepted",
  ).length;
  const rejected = reviewedCards.filter((c) => c.human_decision === "rejected").length;
  const stillPending = reviewedCards.filter((c) => c.human_decision === "pending").length;
  return (
    <tr className="border-b" data-testid={`iteration-row-${iteration.iteration_number}`}>
      <td className="py-1">{iteration.iteration_number}</td>
      <td className="py-1">
        <Badge variant={iteration.status === "stopped" ? "outline" : "default"}>
          {iteration.status}
        </Badge>
      </td>
      <td className="py-1 text-xs">
        {iteration.base_contract_version_id ?? "—"} → {iteration.resulting_contract_version_id ?? "—"}
      </td>
      <td className="py-1 text-xs">
        {reviewed.length} ({accepted}a / {rejected}r / {stillPending}p)
      </td>
      <td className="py-1 text-xs">
        {iteration.provider_summary?.synthesizer_provider_id ?? "—"} /{" "}
        {iteration.provider_summary?.synthesizer_mode ?? "—"}
      </td>
      <td className="py-1 text-xs">
        {iteration.stopped_at ? formatDateTime(iteration.stopped_at) : "—"}
      </td>
    </tr>
  );
}
