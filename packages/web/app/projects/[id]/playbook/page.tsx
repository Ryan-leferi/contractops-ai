"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { usePlaybooks } from "@/components/playbooks-provider";
import { actSelectPlaybook } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function PlaybookPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const { playbooks, loading } = usePlaybooks();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);

  function select() {
    if (!playbooks) return;
    try {
      setError(null);
      applyProjectOp(params.id, (s) => actSelectPlaybook(s, playbooks));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Playbook</h1>
        <p className="text-sm text-muted-foreground">
          The system selects a Playbook whose <code>contract_type</code> matches the confirmed type, or falls
          back to the Custom Contract sentinel. Playbooks are data, not code.
        </p>
      </div>

      {!state.contract_type?.is_confirmed && (
        <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
          Confirm the contract type first.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Selection</CardTitle>
          <CardDescription>
            Confirmed contract type: <code data-testid="confirmed-type">{state.contract_type?.confirmed_type ?? "(none)"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.playbook ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={state.playbook.is_custom_marker ? "warning" : "success"} data-testid="playbook-badge">
                  {state.playbook.is_custom_marker ? "Custom Contract mode" : "Playbook matched"}
                </Badge>
                <span className="font-medium" data-testid="playbook-name">{state.playbook.contract_type}</span>
              </div>
              <div className="text-muted-foreground">
                Family: {state.playbook.contract_family} · Characterization:{" "}
                {state.playbook.legal_characterization}
              </div>
            </div>
          ) : (
            <Button
              onClick={select}
              disabled={!state.contract_type?.is_confirmed || loading || !playbooks}
              data-testid="select-playbook-btn"
            >
              {loading ? "Loading Playbooks…" : "Select Playbook"}
            </Button>
          )}
        </CardContent>
      </Card>

      {state.playbook && (
        <Card>
          <CardHeader><CardTitle>Playbook detail</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Detail label="Default ToC" items={state.playbook.default_table_of_contents} />
            <Detail label="Mandatory clauses" items={state.playbook.mandatory_clauses.map((c) => c.heading)} />
            <Detail label="Common risks" items={state.playbook.common_risks} />
            <Detail label="Red flags" items={state.playbook.red_flags} />
            <Detail
              label="Required intake questions"
              items={state.playbook.required_intake_questions.map((q) => `${q.key}: ${q.text}`)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Detail({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground italic">(none)</div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-medium">{label}</div>
      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
