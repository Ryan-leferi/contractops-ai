"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useStore, useProjectAudits } from "@/components/store-provider";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { AgentRunsPanel } from "@/components/agent-runs-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { ProjectState } from "@contractops/core";

function nextSuggestion(state: ProjectState): { href: string; label: string } {
  if (!state.source_pack.locked) return { href: "sources", label: "Upload sources and lock the Source Pack" };
  if (!state.contract_type?.is_confirmed) return { href: "contract-type", label: "Confirm contract type" };
  if (!state.playbook) return { href: "playbook", label: "Select Playbook" };
  const reqIds = state.intake_questions.filter((q) => q.required).map((q) => q.id);
  const answered = new Set(state.intake_answers.map((a) => a.question_id));
  if (reqIds.length === 0 || !reqIds.every((id) => answered.has(id)))
    return { href: "intake", label: "Answer required intake questions" };
  if (!state.deal_memo?.approved) return { href: "deal-memo", label: "Generate and approve Deal Memo" };
  if (!state.drafting_plan?.approved)
    return { href: "drafting-plan", label: "Generate and approve Drafting Plan" };
  if (state.contract_versions.length === 0) return { href: "draft", label: "Generate v0 draft" };
  const pending = state.issue_cards.filter((c) => c.human_decision === "pending");
  if (state.issue_cards.length === 0 || pending.length > 0)
    return { href: "issues", label: "Run reviews and decide Issue Cards" };
  if (!state.contract_versions.some((v) => v.final))
    return { href: "qa", label: "Run QA, revise, and approve final" };
  if (state.exports.length === 0) return { href: "exports", label: "Generate export placeholders" };
  return { href: "exports", label: "All steps complete" };
}

export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>();
  const { store } = useStore();
  const audits = useProjectAudits(params.id);
  const state = store.projects[params.id]!;

  const suggestion = nextSuggestion(state);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle data-testid="project-name">{state.project.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Created {formatDateTime(state.project.created_at)} · by {state.project.created_by}
                </p>
              </div>
              <Badge variant="outline" data-testid="project-status">{state.project.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-info/30 bg-info/5 p-3 text-sm">
              <span className="font-medium">Next: </span>
              <Link
                href={`/projects/${params.id}/${suggestion.href}`}
                className="text-info hover:underline"
                data-testid="next-step-link"
              >
                {suggestion.label} →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <Stat label="Source documents" value={String(state.source_documents.length)} />
              <Stat label="Source Pack" value={state.source_pack.locked ? "Locked" : "Open"} />
              <Stat
                label="Contract type"
                value={state.contract_type?.confirmed_type ?? "(unconfirmed)"}
              />
              <Stat label="Playbook" value={state.playbook?.contract_type ?? "(none)"} />
              <Stat
                label="Intake answered"
                value={`${state.intake_answers.length}/${state.intake_questions.length}`}
              />
              <Stat label="Deal Memo" value={state.deal_memo?.approved ? "Approved" : state.deal_memo ? "Drafted" : "—"} />
              <Stat label="Drafting Plan" value={state.drafting_plan?.approved ? "Approved" : state.drafting_plan ? "Drafted" : "—"} />
              <Stat label="Versions" value={String(state.contract_versions.length)} />
              <Stat
                label="Issue Cards"
                value={`${state.issue_cards.filter((c) => c.human_decision !== "pending").length}/${state.issue_cards.length} decided`}
              />
              <Stat label="Final approved" value={state.contract_versions.some((v) => v.final) ? "Yes" : "No"} />
              <Stat label="Exports" value={String(state.exports.length)} />
              <Stat label="Agent runs" value={String(state.agent_runs.length)} />
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <AgentRunsPanel runs={state.agent_runs} />
        <AuditLogPanel logs={audits} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate" title={value}>{value}</div>
    </div>
  );
}
