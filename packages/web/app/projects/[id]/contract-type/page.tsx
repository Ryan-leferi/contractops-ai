"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { usePlaybooks } from "@/components/playbooks-provider";
import { actClassifyAndConfirm } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function ContractTypePage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const { playbooks } = usePlaybooks();
  const state = store.projects[params.id]!;

  const [confirmedType, setConfirmedType] = useState(
    state.contract_type?.confirmed_type ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const sourcePackLocked = state.source_pack.locked;
  const playbookTypes = playbooks?.filter((p) => !p.is_custom_marker).map((p) => p.contract_type) ?? [];

  function confirmType(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmedType.trim()) return;
    try {
      setError(null);
      applyProjectOp(params.id, (s) =>
        actClassifyAndConfirm(s, {
          confirmed_type: confirmedType.trim(),
          hint: confirmedType.trim(),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Contract Type</h1>
        <p className="text-sm text-muted-foreground">
          A human lawyer confirms the contract type. The mock classifier does not bind the decision.
        </p>
      </div>

      {!sourcePackLocked && (
        <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
          Tip: lock the Source Pack first so classification has a stable basis.
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Confirm contract type</CardTitle>
          <CardDescription>
            Type or pick a contract type. If no Playbook matches, Custom Contract mode applies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={confirmType} className="space-y-3">
            <div>
              <Label htmlFor="ctype">Contract type</Label>
              <Input
                id="ctype"
                value={confirmedType}
                onChange={(e) => setConfirmedType(e.target.value)}
                list="ctype-options"
                placeholder="e.g. NDA"
                data-testid="contract-type-input"
              />
              <datalist id="ctype-options">
                {playbookTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground mt-1">
                Available Playbooks: {playbookTypes.join(", ") || "(loading…)"}
              </p>
            </div>
            <Button type="submit" disabled={!confirmedType.trim() || !sourcePackLocked} data-testid="confirm-type-btn">
              Confirm contract type (as human lawyer)
            </Button>
          </form>
        </CardContent>
      </Card>

      {state.contract_type && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Current state</CardTitle>
              <Badge variant={state.contract_type.is_confirmed ? "success" : "secondary"} data-testid="contract-type-status">
                {state.contract_type.is_confirmed ? "Confirmed" : "Suggested only"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Suggested: <code>{state.contract_type.suggested_type ?? "—"}</code></div>
            <div>Confirmed: <code>{state.contract_type.confirmed_type ?? "—"}</code></div>
            <div className="text-xs text-muted-foreground">
              Confirmed by: {state.contract_type.confirmed_by ?? "—"}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
