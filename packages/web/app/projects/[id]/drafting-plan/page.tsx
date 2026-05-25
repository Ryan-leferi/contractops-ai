"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { actApproveDraftingPlan, actDraftDraftingPlan } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export default function DraftingPlanPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    try {
      setError(null);
      await applyProjectOp(params.id, actDraftDraftingPlan());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function approve() {
    try {
      setError(null);
      await applyProjectOp(params.id, actApproveDraftingPlan());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const plan = state.drafting_plan;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Drafting Plan</h1>
        <p className="text-sm text-muted-foreground">
          Built from the Playbook's table of contents, mandatory clauses, and style notes. In Custom
          Contract mode, the plan must be human-approved before any draft is generated.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      {plan?.is_custom && (
        <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm" data-testid="custom-warning">
          <span className="font-medium">Custom Contract mode.</span> A human lawyer must approve this
          plan before v0 can be generated (PLATFORM_BRIEF.md §3).
        </div>
      )}

      {!plan ? (
        <Card>
          <CardHeader>
            <CardTitle>No Drafting Plan yet</CardTitle>
            <CardDescription>Generate a plan from the selected Playbook.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={generate} data-testid="generate-plan-btn">
              Generate mock Drafting Plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Drafting Plan</CardTitle>
              <Badge variant={plan.approved ? "success" : "secondary"} data-testid="plan-status">
                {plan.approved ? "Approved" : "Drafted"}
              </Badge>
            </div>
            {plan.approved && (
              <CardDescription>
                Approved by {plan.approved_by} ({plan.approved_by_role}) at{" "}
                {plan.approved_at ? formatDateTime(plan.approved_at) : "—"}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3" data-testid="plan-content">
              {plan.content}
            </pre>
          </CardContent>
          {!plan.approved && (
            <div className="p-4 border-t flex gap-2">
              <Button variant="success" onClick={approve} data-testid="approve-plan-btn">
                Approve Drafting Plan (as human lawyer)
              </Button>
              <Button variant="outline" onClick={generate}>
                Regenerate
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
