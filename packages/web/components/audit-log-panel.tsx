"use client";

import type { AuditLog } from "@contractops/schemas";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

const EVENT_LABEL: Record<string, string> = {
  project_created: "Project created",
  source_uploaded: "Source uploaded",
  source_pack_locked: "Source Pack locked",
  contract_type_confirmed: "Contract type confirmed",
  playbook_confirmed: "Playbook confirmed",
  deal_memo_approved: "Deal Memo approved",
  drafting_plan_approved: "Drafting Plan approved",
  draft_created: "Draft created",
  issue_card_decided: "Issue Card decided",
  revision_generated: "Revision generated",
  final_approved: "Final approved",
  exported: "Exported",
};

export function AuditLogPanel({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Audit log</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">No events yet.</CardContent>
      </Card>
    );
  }
  const sorted = [...logs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log <span className="text-xs text-muted-foreground font-normal">({logs.length})</span></CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[420px] overflow-y-auto">
        {sorted.map((log) => (
          <div key={log.id} className="text-xs border-l-2 border-border pl-3 py-1">
            <div className="flex items-center justify-between">
              <Badge variant="outline">{EVENT_LABEL[log.event_type] ?? log.event_type}</Badge>
              <span className="text-muted-foreground">{formatDateTime(log.timestamp)}</span>
            </div>
            <div className="mt-1 text-muted-foreground">
              actor: <code className="text-foreground">{log.actor}</code> · ref:{" "}
              <code className="text-foreground">{log.ref_id}</code>
            </div>
            {Object.keys(log.payload).length > 0 && (
              <pre className="mt-1 text-[10px] bg-muted rounded p-2 overflow-x-auto">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
