"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import {
  actApproveFinal,
  actCreateRevision,
  actRunMockFinalQA,
} from "@/lib/actions";
import { buildRevisionInputFromIssueCards, summarizeRevisionInput } from "@contractops/core";
import type { IssueCard } from "@contractops/schemas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { QARunsPanel } from "@/components/qa-runs-panel";

export default function QAPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);

  const revisionPreview = buildRevisionInputFromIssueCards(state.issue_cards);
  const summary = summarizeRevisionInput(state.issue_cards);
  const pending = summary.pending;
  const versions = state.contract_versions;
  const latest = versions[versions.length - 1];
  const final = versions.find((v) => v.final);

  async function runQA() {
    try {
      setError(null);
      await applyProjectOp(params.id, (s) => actRunMockFinalQA(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revise() {
    try {
      setError(null);
      await applyProjectOp(params.id, (s) => actCreateRevision(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function approveFinal() {
    if (!confirm("Approve this version as FINAL? This authorizes external delivery.")) return;
    try {
      setError(null);
      await applyProjectOp(params.id, (s) => actApproveFinal(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">QA &amp; Final approval</h1>
        <p className="text-sm text-muted-foreground">
          Run final QA, generate a revision from accepted/partially-accepted Issue Cards (rejected
          cards are excluded), and approve the result as final.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Revision input preview</CardTitle>
          <CardDescription>
            Built by <code>summarizeRevisionInput</code>. Only the accepted and
            partially-accepted groups feed the next revision; rejected /
            deferred / pending never do. Final approval is blocked while any
            card is pending — PLATFORM_BRIEF.md §5 rules 3 &amp; 5.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat
              label="To be applied (accepted)"
              value={String(summary.to_be_applied.length)}
              variant="success"
              testid="stat-included"
            />
            <Stat
              label="Partially applied"
              value={String(summary.partially_applied.length)}
              variant="warning"
              testid="stat-partial"
            />
            <Stat
              label="Skipped (rejected / deferred)"
              value={String(summary.skipped.length)}
              variant="destructive"
              testid="stat-skipped"
            />
            <Stat
              label="Pending — blocks final"
              value={String(summary.pending.length)}
              variant={summary.pending.length > 0 ? "warning" : "success"}
              testid="stat-pending"
            />
          </div>
          <RevisionGroupList summary={summary} />
          {pending.length > 0 && (
            <div
              className="text-xs text-warning"
              data-testid="pending-blocks-final-note"
            >
              ⚠ {pending.length} Issue Card{pending.length === 1 ? "" : "s"} still pending — final
              approval is blocked.
            </div>
          )}
          {/* Belt-and-suspenders cross-check: the legacy
              buildRevisionInputFromIssueCards must agree with the new
              summarizeRevisionInput on what will be applied. */}
          {revisionPreview.inputs.length !==
            summary.to_be_applied.length + summary.partially_applied.length && (
            <div className="text-xs text-destructive">
              Internal inconsistency: revision input count mismatch — please report.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={runQA} disabled={!latest} data-testid="run-qa-btn">Run mock final QA</Button>
            <Button onClick={revise} disabled={!latest || revisionPreview.inputs.length === 0} data-testid="generate-revision-btn">
              Generate revision (v{versions.length})
            </Button>
            <Button
              variant="success"
              onClick={approveFinal}
              disabled={!latest || latest.final || pending.length > 0}
              data-testid="approve-final-btn"
            >
              Approve final
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Final QA is a mock pass for now; real deterministic QA arrives in a later milestone.
          </p>
        </CardContent>
      </Card>

      {versions.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Versions ({versions.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm divide-y">
              {versions.map((v) => (
                <li key={v.id} className="py-3 space-y-2" data-testid={`version-row-${v.version_number}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {v.version_number}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {formatDateTime(v.created_at)} · {v.created_by_agent}
                      </span>
                    </div>
                    {v.final && <Badge variant="success">final</Badge>}
                  </div>
                  <pre className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3 max-h-60 overflow-y-auto" data-testid={`version-content-${v.version_number}`}>
                    {v.content}
                  </pre>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <QARunsPanel runs={state.qa_runs} />

      {final && (
        <div className="rounded-md border border-success bg-success/5 p-3 text-sm text-success" data-testid="final-approved-banner">
          ✓ Final version approved by {final.final_approved_by} ({final.final_approved_by_role}) at{" "}
          {final.final_approved_at ? formatDateTime(final.final_approved_at) : "—"}. Exports are now
          available.
        </div>
      )}
    </div>
  );
}

function RevisionGroupList({
  summary,
}: {
  summary: ReturnType<typeof summarizeRevisionInput>;
}) {
  const groups: {
    title: string;
    cards: IssueCard[];
    tone: "success" | "warning" | "destructive" | "muted";
    testid: string;
  }[] = [
    {
      title: "Issues to be applied",
      cards: summary.to_be_applied,
      tone: "success",
      testid: "rev-group-applied",
    },
    {
      title: "Issues partially applied",
      cards: summary.partially_applied,
      tone: "warning",
      testid: "rev-group-partial",
    },
    {
      title: "Issues skipped (rejected / deferred)",
      cards: summary.skipped,
      tone: "destructive",
      testid: "rev-group-skipped",
    },
    {
      title: "Issues still blocking (pending)",
      cards: summary.pending,
      tone: "warning",
      testid: "rev-group-pending",
    },
  ];
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div
          key={g.testid}
          className="rounded-md border p-2"
          data-testid={g.testid}
        >
          <div className="text-xs font-medium mb-1">
            {g.title} ({g.cards.length})
          </div>
          {g.cards.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              (none)
            </div>
          ) : (
            <ul className="text-xs space-y-1">
              {g.cards.map((c) => (
                <li
                  key={c.issue_id}
                  data-testid={`${g.testid}-card-${c.issue_id}`}
                  className="flex items-start gap-2"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {c.issue_id.slice(0, 8)}
                  </span>
                  <span>
                    {c.location.article ?? "—"} · {c.severity} · {c.source_agent}: {c.problem}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  variant,
  testid,
}: {
  label: string;
  value: string;
  variant: "success" | "destructive" | "warning";
  testid?: string;
}) {
  const colorClass =
    variant === "success"
      ? "border-success text-success"
      : variant === "destructive"
      ? "border-destructive text-destructive"
      : "border-warning text-warning";
  return (
    <div className={`rounded-md border p-2 ${colorClass}`} data-testid={testid}>
      <div className="text-[10px] uppercase">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
