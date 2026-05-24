"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import {
  actApproveFinal,
  actCreateRevision,
  actRunMockFinalQA,
} from "@/lib/actions";
import { buildRevisionInputFromIssueCards } from "@contractops/core";
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
  const pending = state.issue_cards.filter((c) => c.human_decision === "pending");
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
            Built by <code>buildRevisionInputFromIssueCards</code>. Rejected and pending cards are
            excluded by design.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Accepted/partial → included" value={String(revisionPreview.inputs.length)} variant="success" testid="stat-included" />
            <Stat label="Rejected/deferred → skipped" value={String(revisionPreview.skipped.length)} variant="destructive" testid="stat-skipped" />
            <Stat label="Pending" value={String(pending.length)} variant="warning" testid="stat-pending" />
          </div>
          {pending.length > 0 && (
            <div className="text-xs text-warning">
              Final approval is blocked while Issue Cards are pending.
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
