"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { actCreateV0 } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export default function DraftPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    try {
      setError(null);
      await applyProjectOp(params.id, actCreateV0());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const versions = state.contract_versions;
  const v0 = versions.find((v) => v.version_number === "v0") ?? versions[0];

  // Pre-condition check for the generate-v0 button. Server-side guards
  // in `core.aggCreateV0` are still the authoritative check (they throw
  // `Invalid workflow transition: drafting_plan_drafted -> ...` when the
  // plan is not yet approved). The disabled state here is UX: a clear
  // visible "blocked because Drafting Plan not approved" affordance so
  // users don't click and watch a 422 error pop up.
  const dealMemoApproved = state.deal_memo?.approved === true;
  const draftingPlanApproved = state.drafting_plan?.approved === true;
  const v0BlockedReason = !dealMemoApproved
    ? "Deal Memo approval required"
    : !draftingPlanApproved
      ? "Drafting Plan approval required (변호사 승인된 Drafting Plan이 필요합니다)"
      : null;
  const v0Disabled = v0BlockedReason !== null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">v0 Draft</h1>
        <p className="text-sm text-muted-foreground">
          Mock GPT drafter. Requires approved Deal Memo and approved Drafting Plan. The created version
          is tied to <code>source_pack_id</code> and <code>playbook_id</code>.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      {!v0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No v0 draft yet</CardTitle>
            <CardDescription>Generate v0 once Deal Memo and Drafting Plan are approved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              onClick={generate}
              disabled={v0Disabled}
              title={v0BlockedReason ?? undefined}
              data-testid="generate-v0-btn"
            >
              Generate mock v0 draft
            </Button>
            {v0BlockedReason && (
              <p
                className="text-xs text-warning"
                data-testid="drafting-plan-required-note"
              >
                ⚠ {v0BlockedReason}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>v0 draft</CardTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">source_pack: {v0.source_pack_id.slice(0, 8)}</Badge>
                  <Badge variant="outline">playbook: {v0.playbook_id.slice(0, 8)}</Badge>
                </div>
              </div>
              <CardDescription>
                Created by {v0.created_by_agent} at {formatDateTime(v0.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3" data-testid="v0-content">
                {v0.content}
              </pre>
            </CardContent>
          </Card>

          {versions.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Other versions ({versions.length - 1})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm divide-y">
                  {versions.filter((v) => v.id !== v0.id).map((v) => (
                    <li key={v.id} className="py-2 flex items-center justify-between">
                      <div>
                        <span className="font-medium">{v.version_number}</span>{" "}
                        <span className="text-muted-foreground">by {v.created_by_agent}</span>
                      </div>
                      {v.final && <Badge variant="success">final</Badge>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
