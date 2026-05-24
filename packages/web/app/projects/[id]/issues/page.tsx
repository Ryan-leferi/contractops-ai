"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { actDecideIssue, actRunMockReviews } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { IssueCard, IssueHumanDecision, IssueSeverity } from "@contractops/schemas";

const SEVERITY_VARIANT: Record<IssueSeverity, "destructive" | "warning" | "secondary" | "info"> = {
  critical: "destructive",
  high: "warning",
  medium: "info",
  low: "secondary",
};

const DECISION_VARIANT: Record<IssueHumanDecision, "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  pending: "secondary",
  accepted: "success",
  partially_accepted: "warning",
  rejected: "destructive",
  deferred: "outline",
};

export default function IssuesPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);
  const [partialDraft, setPartialDraft] = useState<Record<string, string>>({});

  async function runReviews() {
    try {
      setError(null);
      await applyProjectOp(params.id, (s) => actRunMockReviews(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function decide(card: IssueCard, decision: "accepted" | "rejected" | "deferred") {
    try {
      setError(null);
      applyProjectOp(params.id, (s) =>
        actDecideIssue(s, { issue_id: card.issue_id, decision }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function decidePartial(card: IssueCard) {
    const note = (partialDraft[card.issue_id] ?? "").trim();
    if (!note) {
      setError("Partial acceptance requires a partial note.");
      return;
    }
    try {
      setError(null);
      applyProjectOp(params.id, (s) =>
        actDecideIssue(s, {
          issue_id: card.issue_id,
          decision: "partially_accepted",
          partial_note: note,
        }),
      );
      setPartialDraft({ ...partialDraft, [card.issue_id]: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pending = state.issue_cards.filter((c) => c.human_decision === "pending");
  const decided = state.issue_cards.filter((c) => c.human_decision !== "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Issues</h1>
          <p className="text-sm text-muted-foreground">
            Mock multi-model reviews seed Issue Cards from the Playbook's risks and red flags, plus a
            deterministic QA finding. Every change to v0 must trace to an Issue Card with a human
            decision.
          </p>
        </div>
        <Button onClick={runReviews} data-testid="run-reviews-btn">
          Run mock reviews
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      {state.issue_cards.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No Issue Cards yet. Click "Run mock reviews" to generate them from the Playbook.
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="space-y-3" data-testid="pending-section">
          <h2 className="text-sm font-medium text-muted-foreground">Pending ({pending.length})</h2>
          {pending.map((c) => (
            <IssueCardRow
              key={c.issue_id}
              card={c}
              partialDraft={partialDraft[c.issue_id] ?? ""}
              onPartialChange={(v) => setPartialDraft({ ...partialDraft, [c.issue_id]: v })}
              onAccept={() => decide(c, "accepted")}
              onReject={() => decide(c, "rejected")}
              onDefer={() => decide(c, "deferred")}
              onPartial={() => decidePartial(c)}
            />
          ))}
        </section>
      )}

      {decided.length > 0 && (
        <section className="space-y-3" data-testid="decided-section">
          <h2 className="text-sm font-medium text-muted-foreground">Decided ({decided.length})</h2>
          {decided.map((c) => (
            <DecidedCardRow key={c.issue_id} card={c} />
          ))}
        </section>
      )}
    </div>
  );
}

function IssueCardRow({
  card,
  partialDraft,
  onPartialChange,
  onAccept,
  onReject,
  onDefer,
  onPartial,
}: {
  card: IssueCard;
  partialDraft: string;
  onPartialChange: (v: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onDefer: () => void;
  onPartial: () => void;
}) {
  return (
    <Card data-testid={`pending-card-${card.source_agent}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{card.problem}</CardTitle>
            <CardDescription>
              {card.source_agent} · {card.issue_type} ·{" "}
              {card.location.article ?? "—"}
            </CardDescription>
          </div>
          <Badge variant={SEVERITY_VARIANT[card.severity]}>{card.severity}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <div>
          <div className="text-xs text-muted-foreground">Why it matters</div>
          <div>{card.why_it_matters}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Recommended revision</div>
          <div>{card.recommended_revision}</div>
        </div>
        <div className="text-xs text-muted-foreground">Business impact: {card.business_impact}</div>
      </CardContent>
      <div className="p-4 border-t space-y-2">
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="success" onClick={onAccept} data-testid="accept-btn">Accept</Button>
          <Button size="sm" variant="destructive" onClick={onReject} data-testid="reject-btn">Reject</Button>
          <Button size="sm" variant="outline" onClick={onDefer} data-testid="defer-btn">Defer</Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Partial revision note (required for partial accept)"
            value={partialDraft}
            onChange={(e) => onPartialChange(e.target.value)}
            data-testid="partial-note-input"
          />
          <Button size="sm" variant="warning" onClick={onPartial} disabled={!partialDraft.trim()} data-testid="partial-accept-btn">
            Partially accept
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DecidedCardRow({ card }: { card: IssueCard }) {
  return (
    <Card data-testid={`decided-card-${card.human_decision}`}>
      <CardHeader className="!pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">{card.problem}</CardTitle>
            <CardDescription>
              {card.source_agent} · {card.location.article ?? "—"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={SEVERITY_VARIANT[card.severity]}>{card.severity}</Badge>
            <Badge variant={DECISION_VARIANT[card.human_decision]}>{card.human_decision}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="!pt-0 text-xs text-muted-foreground space-y-1">
        {card.partial_note && (
          <div>
            <span className="font-medium text-foreground">Partial note:</span> {card.partial_note}
          </div>
        )}
        {card.applied_version && (
          <div>Applied in version: <code>{card.applied_version.slice(0, 8)}</code></div>
        )}
        {card.human_decision === "rejected" && (
          <div className="text-destructive">Excluded from all revision input.</div>
        )}
      </CardContent>
    </Card>
  );
}
