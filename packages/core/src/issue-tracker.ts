/**
 * Issue tracker helpers (Milestone 3C).
 *
 * Pure functions used by the /projects/[id]/issues page to:
 *
 *   - filter Issue Cards by severity / decision / source_agent / issue_type
 *     and free-text search;
 *   - sort Issue Cards by one of five orderings (default: pending first,
 *     then severity high → low);
 *   - compute the review dashboard counts.
 *
 * Living in `@contractops/core` so they can be unit-tested without React /
 * jsdom and so the UI does not duplicate decision logic.
 */
import type {
  AgentRun,
  IssueCard,
  IssueHumanDecision,
  IssueSeverity,
} from "@contractops/schemas";
import type { DeterministicQAResult } from "./qa/types";

// ─────────────────────────────────────────────────────────────────────────
// Filter
// ─────────────────────────────────────────────────────────────────────────

export interface IssueFilterCriteria {
  /** Allow-list of severities; empty array means "all". */
  severities?: IssueSeverity[];
  /** Allow-list of decisions; empty array means "all". */
  decisions?: IssueHumanDecision[];
  /** Allow-list of source_agent values; empty array means "all". */
  source_agents?: string[];
  /** Allow-list of issue_type values; empty array means "all". */
  issue_types?: string[];
  /**
   * Substring (case-insensitive) matched against problem +
   * recommended_revision + why_it_matters + business_impact. Empty string
   * means no text filter.
   */
  text?: string;
}

export function filterIssueCards(
  cards: IssueCard[],
  criteria: IssueFilterCriteria,
): IssueCard[] {
  const sevSet = (criteria.severities ?? []).length
    ? new Set(criteria.severities)
    : null;
  const decSet = (criteria.decisions ?? []).length
    ? new Set(criteria.decisions)
    : null;
  const agentSet = (criteria.source_agents ?? []).length
    ? new Set(criteria.source_agents)
    : null;
  const typeSet = (criteria.issue_types ?? []).length
    ? new Set(criteria.issue_types)
    : null;
  const needle = (criteria.text ?? "").trim().toLowerCase();

  return cards.filter((c) => {
    if (sevSet && !sevSet.has(c.severity)) return false;
    if (decSet && !decSet.has(c.human_decision)) return false;
    if (agentSet && !agentSet.has(c.source_agent)) return false;
    if (typeSet && !typeSet.has(c.issue_type)) return false;
    if (needle) {
      const haystack =
        c.problem.toLowerCase() +
        " " +
        c.recommended_revision.toLowerCase() +
        " " +
        c.why_it_matters.toLowerCase() +
        " " +
        c.business_impact.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Sort
// ─────────────────────────────────────────────────────────────────────────

export type IssueSortOrder =
  | "pending_first" // default: pending → others, then severity high → low
  | "severity_high_to_low"
  | "newest_first"
  | "oldest_first"
  | "decision_status";

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const DECISION_RANK: Record<IssueHumanDecision, number> = {
  pending: 0,
  accepted: 1,
  partially_accepted: 2,
  rejected: 3,
  deferred: 4,
};

/**
 * Partition the cards into [decided, undecided], sort the decided slice
 * by `decided_at` in the chosen direction, then append the undecided
 * slice unchanged at the bottom. This keeps "newest_first" / "oldest_first"
 * meaningfully about DECISION timestamps and never surfaces an undecided
 * card above a decided one in either direction.
 */
function sortByDecidedAt(cards: IssueCard[], direction: "asc" | "desc"): IssueCard[] {
  const decided: IssueCard[] = [];
  const undecided: IssueCard[] = [];
  for (const c of cards) {
    if (c.decided_at) decided.push(c);
    else undecided.push(c);
  }
  decided.sort((a, b) =>
    direction === "asc"
      ? (a.decided_at ?? "").localeCompare(b.decided_at ?? "")
      : (b.decided_at ?? "").localeCompare(a.decided_at ?? ""),
  );
  return [...decided, ...undecided];
}

export function sortIssueCards(cards: IssueCard[], order: IssueSortOrder = "pending_first"): IssueCard[] {
  const copy = cards.slice();
  switch (order) {
    case "pending_first":
      copy.sort((a, b) => {
        const aPending = a.human_decision === "pending" ? 0 : 1;
        const bPending = b.human_decision === "pending" ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      });
      return copy;
    case "severity_high_to_low":
      copy.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
      return copy;
    case "newest_first":
      return sortByDecidedAt(copy, "desc");
    case "oldest_first":
      return sortByDecidedAt(copy, "asc");
    case "decision_status":
      copy.sort(
        (a, b) => DECISION_RANK[a.human_decision] - DECISION_RANK[b.human_decision],
      );
      return copy;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Dashboard counts
// ─────────────────────────────────────────────────────────────────────────

export interface ReviewDashboardCounts {
  total: number;
  pending: number;
  accepted: number;
  partially_accepted: number;
  rejected: number;
  deferred: number;
  /** critical + high severity, regardless of decision. */
  critical_high: number;
  /** Issue Cards whose source_agent === "deterministic_qa". */
  deterministic_qa_findings: number;
  /**
   * Number of AgentRuns with mode === "real". Renders the
   * "real-provider activity" badge on the dashboard. 0 when running purely
   * mock — the default in CI.
   */
  real_agent_runs: number;
  /**
   * Sum of deterministic-QA findings across all qa_runs. Mirrors what the
   * QA panel shows; surfaced on the Issues dashboard so the lawyer sees
   * the full inflight finding load in one place.
   */
  deterministic_qa_finding_total: number;
  /** True iff `pending > 0` — i.e. final approval is currently blocked. */
  blocks_final_approval: boolean;
}

export function dashboardCounts(
  cards: IssueCard[],
  agent_runs: AgentRun[] = [],
  qa_runs: DeterministicQAResult[] = [],
): ReviewDashboardCounts {
  let pending = 0;
  let accepted = 0;
  let partially_accepted = 0;
  let rejected = 0;
  let deferred = 0;
  let critical_high = 0;
  let deterministic_qa_findings = 0;
  for (const c of cards) {
    switch (c.human_decision) {
      case "pending":
        pending++;
        break;
      case "accepted":
        accepted++;
        break;
      case "partially_accepted":
        partially_accepted++;
        break;
      case "rejected":
        rejected++;
        break;
      case "deferred":
        deferred++;
        break;
    }
    if (c.severity === "critical" || c.severity === "high") critical_high++;
    if (c.source_agent === "deterministic_qa") deterministic_qa_findings++;
  }
  return {
    total: cards.length,
    pending,
    accepted,
    partially_accepted,
    rejected,
    deferred,
    critical_high,
    deterministic_qa_findings,
    real_agent_runs: agent_runs.filter((r) => r.mode === "real").length,
    deterministic_qa_finding_total: qa_runs.reduce(
      (acc, run) => acc + run.findings.length,
      0,
    ),
    blocks_final_approval: pending > 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Decision history
// ─────────────────────────────────────────────────────────────────────────

import type { IssueDecisionHistoryEntry } from "@contractops/schemas";

/**
 * Return all history entries for a single Issue Card, ordered oldest →
 * newest. Source list is already append-only; this helper just narrows and
 * preserves order.
 */
export function decisionHistoryForCard(
  history: IssueDecisionHistoryEntry[],
  issue_id: string,
): IssueDecisionHistoryEntry[] {
  return history.filter((h) => h.issue_id === issue_id);
}
