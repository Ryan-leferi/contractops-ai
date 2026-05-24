import type {
  Actor,
  AuditLog,
  IssueCard,
  IssueHumanDecision,
  IssueLocation,
  IssueRecommendedAction,
  IssueSeverity,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface IssueCardSeed {
  project_id: string;
  source_agent: string;
  severity: IssueSeverity;
  location: IssueLocation;
  issue_type: string;
  problem: string;
  why_it_matters: string;
  recommended_revision: string;
  business_impact: string;
  recommended_action: IssueRecommendedAction;
}

export interface CreateIssueCardsInput {
  seeds: IssueCardSeed[];
  env: Env;
}

export function createIssueCards(input: CreateIssueCardsInput): IssueCard[] {
  return input.seeds.map((seed) => ({
    issue_id: input.env.newId(),
    project_id: seed.project_id,
    source_agent: seed.source_agent,
    severity: seed.severity,
    location: seed.location,
    issue_type: seed.issue_type,
    problem: seed.problem,
    why_it_matters: seed.why_it_matters,
    recommended_revision: seed.recommended_revision,
    business_impact: seed.business_impact,
    recommended_action: seed.recommended_action,
    human_decision: "pending",
    partial_note: null,
    decided_by: null,
    decided_at: null,
    applied_version: null,
  }));
}

export type IssueDecisionOutcome = Exclude<IssueHumanDecision, "pending">;

export interface DecideIssueCardInput {
  issue_card: IssueCard;
  decision: IssueDecisionOutcome;
  decided_by: Actor;
  partial_note?: string;
  env: Env;
}

export interface DecideIssueCardResult {
  issue_card: IssueCard;
  audit: AuditLog;
}

export function decideIssueCard(input: DecideIssueCardInput): DecideIssueCardResult {
  if (input.decided_by.role !== "human_lawyer") {
    throw errors.notHumanLawyer();
  }
  if (input.decision === "partially_accepted") {
    if (!input.partial_note || input.partial_note.trim().length === 0) {
      throw errors.partialNoteRequired();
    }
  }
  const now = input.env.now();
  const updated: IssueCard = {
    ...input.issue_card,
    human_decision: input.decision,
    partial_note:
      input.decision === "partially_accepted" ? (input.partial_note ?? null) : null,
    decided_by: input.decided_by.id,
    decided_at: now,
  };
  const audit = createAuditLog({
    project_id: input.issue_card.project_id,
    actor: input.decided_by,
    event_type: "issue_card_decided",
    ref_id: updated.issue_id,
    payload: { decision: input.decision, partial_note: updated.partial_note },
    env: input.env,
  });
  return { issue_card: updated, audit };
}
