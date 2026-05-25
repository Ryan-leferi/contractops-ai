"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useStore } from "@/components/store-provider";
import { actDecideIssue, actRunMockReviews } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import {
  dashboardCounts,
  decisionHistoryForCard,
  filterIssueCards,
  sortIssueCards,
  type IssueFilterCriteria,
  type IssueSortOrder,
} from "@contractops/core";
import type {
  IssueCard,
  IssueDecisionHistoryEntry,
  IssueHumanDecision,
  IssueSeverity,
} from "@contractops/schemas";

const SEVERITY_VARIANT: Record<IssueSeverity, "destructive" | "warning" | "secondary" | "info"> = {
  critical: "destructive",
  high: "warning",
  medium: "info",
  low: "secondary",
};

const DECISION_VARIANT: Record<
  IssueHumanDecision,
  "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  pending: "secondary",
  accepted: "success",
  partially_accepted: "warning",
  rejected: "destructive",
  deferred: "outline",
};

const ALL_SEVERITIES: IssueSeverity[] = ["critical", "high", "medium", "low"];
const ALL_DECISIONS: IssueHumanDecision[] = [
  "pending",
  "accepted",
  "partially_accepted",
  "rejected",
  "deferred",
];

const SORT_LABELS: Record<IssueSortOrder, string> = {
  pending_first: "Pending first, then severity high → low (default)",
  severity_high_to_low: "Severity high → low",
  newest_first: "Newest decided first",
  oldest_first: "Oldest decided first",
  decision_status: "Decision status",
};

interface DecisionDraft {
  partial_note: string;
  reason_note: string;
}

export default function IssuesPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({});
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  // ── Filters / sort (local UI state only — not persisted) ───────────
  const [filterSeverities, setFilterSeverities] = useState<IssueSeverity[]>([]);
  const [filterDecisions, setFilterDecisions] = useState<IssueHumanDecision[]>([]);
  const [filterAgent, setFilterAgent] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<IssueSortOrder>("pending_first");

  // Source-agent and issue-type dropdowns auto-populate from the cards in
  // hand so the lawyer can filter without typing exact strings.
  const sourceAgents = useMemo(
    () => Array.from(new Set(state.issue_cards.map((c) => c.source_agent))).sort(),
    [state.issue_cards],
  );
  const issueTypes = useMemo(
    () => Array.from(new Set(state.issue_cards.map((c) => c.issue_type))).sort(),
    [state.issue_cards],
  );

  const criteria: IssueFilterCriteria = {
    severities: filterSeverities,
    decisions: filterDecisions,
    source_agents: filterAgent ? [filterAgent] : [],
    issue_types: filterType ? [filterType] : [],
    text: searchText,
  };

  const visibleCards = useMemo(
    () => sortIssueCards(filterIssueCards(state.issue_cards, criteria), sortOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.issue_cards, filterSeverities, filterDecisions, filterAgent, filterType, searchText, sortOrder],
  );

  const counts = useMemo(
    () => dashboardCounts(state.issue_cards, state.agent_runs, state.qa_runs),
    [state.issue_cards, state.agent_runs, state.qa_runs],
  );

  // ── Actions ────────────────────────────────────────────────────────
  async function runReviews() {
    try {
      setError(null);
      await applyProjectOp(params.id, actRunMockReviews());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function getDraft(id: string): DecisionDraft {
    return drafts[id] ?? { partial_note: "", reason_note: "" };
  }
  function setDraft(id: string, patch: Partial<DecisionDraft>) {
    setDrafts({ ...drafts, [id]: { ...getDraft(id), ...patch } });
  }

  async function decide(
    card: IssueCard,
    decision: "accepted" | "rejected" | "deferred",
  ) {
    const draft = getDraft(card.issue_id);
    try {
      setError(null);
      await applyProjectOp(
        params.id,
        actDecideIssue({
          issue_id: card.issue_id,
          decision,
          reason_note: draft.reason_note.trim() || undefined,
        }),
      );
      setDraft(card.issue_id, { reason_note: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function decidePartial(card: IssueCard) {
    const draft = getDraft(card.issue_id);
    const note = draft.partial_note.trim();
    if (!note) {
      setError("Partial acceptance requires a partial note.");
      return;
    }
    try {
      setError(null);
      await applyProjectOp(
        params.id,
        actDecideIssue({
          issue_id: card.issue_id,
          decision: "partially_accepted",
          partial_note: note,
          reason_note: draft.reason_note.trim() || undefined,
        }),
      );
      setDraft(card.issue_id, { partial_note: "", reason_note: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function toggleHistory(id: string) {
    setOpenHistory({ ...openHistory, [id]: !openHistory[id] });
  }

  function toggleInList<T>(value: T, list: T[], setter: (next: T[]) => void) {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  function resetFilters() {
    setFilterSeverities([]);
    setFilterDecisions([]);
    setFilterAgent("");
    setFilterType("");
    setSearchText("");
    setSortOrder("pending_first");
  }

  // ── Layout ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Issues</h1>
          <p className="text-sm text-muted-foreground">
            Mock multi-model + deterministic-QA reviews seed Issue Cards from
            the Playbook's risks and red flags. Every change to v0 must trace
            to an Issue Card with a human decision. Decision history is
            internal legal workflow data — it never appears in clean DOCX or
            cover-email exports.
          </p>
        </div>
        <Button onClick={runReviews} data-testid="run-reviews-btn">
          Run mock reviews
        </Button>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="page-error"
        >
          {error}
        </div>
      )}

      {state.issue_cards.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No Issue Cards yet. Click "Run mock reviews" to generate them from the Playbook.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Review dashboard */}
          <section data-testid="review-dashboard">
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Review dashboard</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <CountCard label="Total" value={counts.total} testid="dash-total" />
              <CountCard
                label="Pending"
                value={counts.pending}
                testid="dash-pending"
                tone={counts.pending > 0 ? "warning" : "muted"}
              />
              <CountCard
                label="Accepted"
                value={counts.accepted}
                testid="dash-accepted"
                tone="success"
              />
              <CountCard
                label="Partial"
                value={counts.partially_accepted}
                testid="dash-partial"
                tone="warning"
              />
              <CountCard
                label="Rejected"
                value={counts.rejected}
                testid="dash-rejected"
                tone="destructive"
              />
              <CountCard
                label="Deferred"
                value={counts.deferred}
                testid="dash-deferred"
                tone="muted"
              />
              <CountCard
                label="Critical / High"
                value={counts.critical_high}
                testid="dash-critical-high"
                tone={counts.critical_high > 0 ? "destructive" : "muted"}
              />
              <CountCard
                label="Det. QA findings"
                value={counts.deterministic_qa_findings}
                testid="dash-det-qa"
                tone="muted"
              />
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
              <span data-testid="dash-real-runs">
                Real-provider AgentRuns: {counts.real_agent_runs}
              </span>
              <span data-testid="dash-det-qa-total">
                Det. QA findings (across runs): {counts.deterministic_qa_finding_total}
              </span>
              {counts.blocks_final_approval && (
                <span className="text-warning" data-testid="dash-blocks-final">
                  ⚠ {counts.pending} pending Issue Card{counts.pending === 1 ? "" : "s"} — final
                  approval is blocked.
                </span>
              )}
            </div>
          </section>

          {/* Filter / sort */}
          <section data-testid="issues-filter-panel">
            <Card>
              <CardHeader className="!pb-2">
                <CardTitle className="text-sm">Filters &amp; sort</CardTitle>
                <CardDescription>
                  UI-state only — not persisted. Reset returns to defaults.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-3">
                <div className="flex flex-wrap gap-1">
                  <span className="font-medium pr-1">Severity:</span>
                  {ALL_SEVERITIES.map((s) => (
                    <FilterChip
                      key={s}
                      label={s}
                      active={filterSeverities.includes(s)}
                      onToggle={() =>
                        toggleInList(s, filterSeverities, setFilterSeverities)
                      }
                      testid={`filter-severity-${s}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="font-medium pr-1">Decision:</span>
                  {ALL_DECISIONS.map((d) => (
                    <FilterChip
                      key={d}
                      label={d}
                      active={filterDecisions.includes(d)}
                      onToggle={() => toggleInList(d, filterDecisions, setFilterDecisions)}
                      testid={`filter-decision-${d}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="font-medium" htmlFor="filter-agent">Source agent:</label>
                  <select
                    id="filter-agent"
                    value={filterAgent}
                    onChange={(e) => setFilterAgent(e.target.value)}
                    className="h-7 rounded border border-input bg-background px-2"
                    data-testid="filter-agent-select"
                  >
                    <option value="">(any)</option>
                    {sourceAgents.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <label className="font-medium pl-3" htmlFor="filter-type">Issue type:</label>
                  <select
                    id="filter-type"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="h-7 rounded border border-input bg-background px-2"
                    data-testid="filter-type-select"
                  >
                    <option value="">(any)</option>
                    {issueTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="font-medium" htmlFor="issue-search">Search:</label>
                  <Input
                    id="issue-search"
                    placeholder="problem / recommended revision / why / impact"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="max-w-md"
                    data-testid="filter-search-input"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="font-medium" htmlFor="sort-order">Sort:</label>
                  <select
                    id="sort-order"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as IssueSortOrder)}
                    className="h-7 rounded border border-input bg-background px-2"
                    data-testid="sort-order-select"
                  >
                    {(Object.keys(SORT_LABELS) as IssueSortOrder[]).map((o) => (
                      <option key={o} value={o}>
                        {SORT_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="outline" onClick={resetFilters} data-testid="reset-filters-btn">
                    Reset
                  </Button>
                  <span className="text-muted-foreground ml-2" data-testid="visible-count">
                    Showing {visibleCards.length} of {state.issue_cards.length}
                  </span>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Pending stays a dedicated section so existing tests + the
              negotiation flow can still locate it; the rest of the cards
              render below in the chosen sort order. */}
          {visibleCards.some((c) => c.human_decision === "pending") && (
            <section className="space-y-3" data-testid="pending-section">
              <h2 className="text-sm font-medium text-muted-foreground">
                Pending ({visibleCards.filter((c) => c.human_decision === "pending").length})
              </h2>
              {visibleCards
                .filter((c) => c.human_decision === "pending")
                .map((c) => (
                  <PendingCardRow
                    key={c.issue_id}
                    card={c}
                    history={decisionHistoryForCard(state.decision_history, c.issue_id)}
                    draft={getDraft(c.issue_id)}
                    historyOpen={!!openHistory[c.issue_id]}
                    onHistoryToggle={() => toggleHistory(c.issue_id)}
                    onChangeDraft={(p) => setDraft(c.issue_id, p)}
                    onAccept={() => decide(c, "accepted")}
                    onReject={() => decide(c, "rejected")}
                    onDefer={() => decide(c, "deferred")}
                    onPartial={() => decidePartial(c)}
                  />
                ))}
            </section>
          )}

          {visibleCards.some((c) => c.human_decision !== "pending") && (
            <section className="space-y-3" data-testid="decided-section">
              <h2 className="text-sm font-medium text-muted-foreground">
                Decided ({visibleCards.filter((c) => c.human_decision !== "pending").length})
              </h2>
              {visibleCards
                .filter((c) => c.human_decision !== "pending")
                .map((c) => (
                  <DecidedCardRow
                    key={c.issue_id}
                    card={c}
                    history={decisionHistoryForCard(state.decision_history, c.issue_id)}
                    historyOpen={!!openHistory[c.issue_id]}
                    onHistoryToggle={() => toggleHistory(c.issue_id)}
                    draft={getDraft(c.issue_id)}
                    onChangeDraft={(p) => setDraft(c.issue_id, p)}
                    onReDecide={(d) => decide(c, d)}
                    onRePartial={() => decidePartial(c)}
                  />
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function CountCard({
  label,
  value,
  testid,
  tone = "muted",
}: {
  label: string;
  value: number;
  testid: string;
  tone?: "muted" | "success" | "warning" | "destructive";
}) {
  const cls =
    tone === "success"
      ? "border-success/40 text-success"
      : tone === "warning"
        ? "border-warning/40 text-warning"
        : tone === "destructive"
          ? "border-destructive/40 text-destructive"
          : "border-input text-muted-foreground";
  return (
    <div className={`rounded-md border p-2 ${cls}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onToggle,
  testid,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testid}
      data-active={active}
      className={`px-2 py-0.5 rounded border text-[11px] ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function HistoryPanel({
  history,
  testid,
}: {
  history: IssueDecisionHistoryEntry[];
  testid: string;
}) {
  return (
    <div
      className="mt-2 rounded-md border bg-muted/30 p-2 text-xs space-y-1"
      data-testid={testid}
    >
      {history.length === 0 ? (
        <div className="text-muted-foreground italic">No decision changes recorded yet.</div>
      ) : (
        history.map((h, i) => (
          <div key={h.id} className="flex flex-col gap-0.5" data-testid={`${testid}-entry-${i}`}>
            <div>
              <Badge variant="outline" className="mr-1 text-[10px]">
                {h.previous_decision} → {h.new_decision}
              </Badge>
              <span className="text-muted-foreground">
                {h.actor_id} ({h.actor_role}) · {formatDateTime(h.changed_at)}
              </span>
            </div>
            {h.partial_note && (
              <div>
                <span className="font-medium">partial_note:</span> {h.partial_note}
              </div>
            )}
            {h.reason_note && (
              <div>
                <span className="font-medium">reason_note:</span> {h.reason_note}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function PendingCardRow({
  card,
  history,
  draft,
  historyOpen,
  onHistoryToggle,
  onChangeDraft,
  onAccept,
  onReject,
  onDefer,
  onPartial,
}: {
  card: IssueCard;
  history: IssueDecisionHistoryEntry[];
  draft: DecisionDraft;
  historyOpen: boolean;
  onHistoryToggle: () => void;
  onChangeDraft: (patch: Partial<DecisionDraft>) => void;
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
              {card.source_agent} · {card.issue_type} · {card.location.article ?? "—"}
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
          <Button size="sm" variant="success" onClick={onAccept} data-testid="accept-btn">
            Accept
          </Button>
          <Button size="sm" variant="destructive" onClick={onReject} data-testid="reject-btn">
            Reject
          </Button>
          <Button size="sm" variant="outline" onClick={onDefer} data-testid="defer-btn">
            Defer
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Partial revision note (required for partial accept)"
            value={draft.partial_note}
            onChange={(e) => onChangeDraft({ partial_note: e.target.value })}
            data-testid="partial-note-input"
          />
          <Button
            size="sm"
            variant="warning"
            onClick={onPartial}
            disabled={!draft.partial_note.trim()}
            data-testid="partial-accept-btn"
          >
            Partially accept
          </Button>
        </div>
        <Input
          placeholder="Optional reason note (recommended for rejected / deferred / partial)"
          value={draft.reason_note}
          onChange={(e) => onChangeDraft({ reason_note: e.target.value })}
          data-testid="reason-note-input"
        />
        <button
          type="button"
          onClick={onHistoryToggle}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          data-testid={`history-toggle-${card.issue_id}`}
        >
          {historyOpen ? "▼" : "▶"} Decision history ({history.length})
        </button>
        {historyOpen && (
          <HistoryPanel history={history} testid={`history-panel-${card.issue_id}`} />
        )}
      </div>
    </Card>
  );
}

function DecidedCardRow({
  card,
  history,
  historyOpen,
  onHistoryToggle,
  draft,
  onChangeDraft,
  onReDecide,
  onRePartial,
}: {
  card: IssueCard;
  history: IssueDecisionHistoryEntry[];
  historyOpen: boolean;
  onHistoryToggle: () => void;
  draft: DecisionDraft;
  onChangeDraft: (patch: Partial<DecisionDraft>) => void;
  onReDecide: (decision: "accepted" | "rejected" | "deferred") => void;
  onRePartial: () => void;
}) {
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
            <Badge
              variant={DECISION_VARIANT[card.human_decision]}
              data-testid={`decided-badge-${card.issue_id}`}
            >
              {card.human_decision}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="!pt-0 text-xs text-muted-foreground space-y-1">
        {card.partial_note && (
          <div>
            <span className="font-medium text-foreground">Partial note:</span> {card.partial_note}
          </div>
        )}
        {card.reason_note && (
          <div data-testid={`reason-note-${card.issue_id}`}>
            <span className="font-medium text-foreground">Reason note:</span> {card.reason_note}
          </div>
        )}
        {card.applied_version && (
          <div>
            Applied in version: <code>{card.applied_version.slice(0, 8)}</code>
          </div>
        )}
        {card.human_decision === "rejected" && (
          <div className="text-destructive">Excluded from all revision input.</div>
        )}
      </CardContent>
      <div className="p-3 border-t space-y-2">
        <button
          type="button"
          onClick={onHistoryToggle}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          data-testid={`history-toggle-${card.issue_id}`}
        >
          {historyOpen ? "▼" : "▶"} Decision history ({history.length})
        </button>
        {historyOpen && (
          <HistoryPanel history={history} testid={`history-panel-${card.issue_id}`} />
        )}
        {/* Decision can be changed — the new decision is appended to history. */}
        <details className="text-xs">
          <summary
            className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline"
            data-testid={`change-decision-toggle-${card.issue_id}`}
          >
            Change decision
          </summary>
          <div className="mt-2 space-y-2">
            <Input
              placeholder="Optional reason note"
              value={draft.reason_note}
              onChange={(e) => onChangeDraft({ reason_note: e.target.value })}
              data-testid={`re-reason-input-${card.issue_id}`}
            />
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="success"
                onClick={() => onReDecide("accepted")}
                data-testid={`re-accept-btn-${card.issue_id}`}
              >
                Re-accept
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onReDecide("rejected")}
                data-testid={`re-reject-btn-${card.issue_id}`}
              >
                Re-reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReDecide("deferred")}
                data-testid={`re-defer-btn-${card.issue_id}`}
              >
                Re-defer
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Partial note (required to partially accept)"
                value={draft.partial_note}
                onChange={(e) => onChangeDraft({ partial_note: e.target.value })}
                data-testid={`re-partial-input-${card.issue_id}`}
              />
              <Button
                size="sm"
                variant="warning"
                onClick={onRePartial}
                disabled={!draft.partial_note.trim()}
                data-testid={`re-partial-btn-${card.issue_id}`}
              >
                Re-partial
              </Button>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}
