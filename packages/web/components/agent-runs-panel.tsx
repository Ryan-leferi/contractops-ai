"use client";

import type { AgentRun } from "@contractops/schemas";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  classifier: "Classifier",
  deal_memo_drafter: "Deal Memo drafter",
  drafting_plan_drafter: "Drafting Plan drafter",
  contract_drafter: "Contract drafter",
  counterparty_reviewer: "Counterparty reviewer",
  source_consistency_reviewer: "Source consistency reviewer",
  legal_style_reviewer: "Legal style reviewer",
  deterministic_qa: "Deterministic QA",
  revision_agent: "Revision agent",
  final_qa_assistant: "Final QA assistant",
};

export function AgentRunsPanel({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent runs</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No agent runs yet.</CardContent>
      </Card>
    );
  }
  const sorted = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at));
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Agent runs{" "}
          <span className="text-xs text-muted-foreground font-normal">({runs.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
        {sorted.map((r) => (
          <div
            key={r.id}
            className="text-xs border-l-2 border-border pl-3 py-1"
            data-testid={`agent-run-${r.role}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline">{ROLE_LABEL[r.role] ?? r.role}</Badge>
                <Badge
                  variant={r.mode === "real" ? "destructive" : "secondary"}
                  data-testid={`agent-run-mode-${r.role}`}
                >
                  {r.mode}
                </Badge>
                {r.status === "failed" && (
                  <Badge variant="destructive">failed</Badge>
                )}
              </div>
              <span className="text-muted-foreground">{formatDateTime(r.started_at)}</span>
            </div>
            <div className="mt-1 text-muted-foreground">
              provider: <code className="text-foreground" data-testid={`agent-run-provider-${r.role}`}>{r.provider_id}</code>
              {" · "}
              model: <code className="text-foreground">{r.model_id}</code>
              {r.prompt_version ? (
                <>
                  {" · "}prompt: <code className="text-foreground">{r.prompt_version}</code>
                </>
              ) : null}
            </div>
            {r.token_usage && (
              <div className="mt-1 text-muted-foreground">
                tokens: in={r.token_usage.input_tokens} · out={r.token_usage.output_tokens}
                {r.cost_estimate !== null && r.cost_estimate !== undefined ? (
                  <span> · est. ${r.cost_estimate.toFixed(4)}</span>
                ) : null}
              </div>
            )}
            {r.error_message && (
              <div className="mt-1 text-destructive">error: {r.error_message}</div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
