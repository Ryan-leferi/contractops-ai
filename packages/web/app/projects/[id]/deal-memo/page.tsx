"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useCurrentActor, useStore } from "@/components/store-provider";
import { actApproveDealMemo, actDraftDealMemo } from "@/lib/actions";
import { REQUIRES_LAWYER_MESSAGE, canActAsLawyer } from "@/lib/demo-actors";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export default function DealMemoPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    try {
      setError(null);
      await applyProjectOp(params.id, actDraftDealMemo());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function approve() {
    try {
      setError(null);
      await applyProjectOp(params.id, actApproveDealMemo());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const dealMemo = state.deal_memo;
  const isLawyer = canActAsLawyer(useCurrentActor());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Deal Memo</h1>
        <p className="text-sm text-muted-foreground">
          Mock GPT drafts the Deal Memo from the Source Pack + intake answers. Approval requires every
          required intake question to be answered.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
          {error}
        </div>
      )}

      {!dealMemo ? (
        <Card>
          <CardHeader>
            <CardTitle>No Deal Memo yet</CardTitle>
            <CardDescription>Click below to generate a mock Deal Memo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={generate} data-testid="generate-deal-memo-btn">
              Generate mock Deal Memo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Deal Memo</CardTitle>
              <Badge variant={dealMemo.approved ? "success" : "secondary"} data-testid="deal-memo-status">
                {dealMemo.approved ? "Approved" : "Drafted"}
              </Badge>
            </div>
            {dealMemo.approved && (
              <CardDescription>
                Approved by {dealMemo.approved_by} ({dealMemo.approved_by_role}) at{" "}
                {dealMemo.approved_at ? formatDateTime(dealMemo.approved_at) : "—"}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3" data-testid="deal-memo-content">
              {dealMemo.content}
            </pre>
          </CardContent>
          {!dealMemo.approved && (
            <div className="p-4 border-t space-y-2">
              <div className="flex gap-2">
                <Button
                  variant="success"
                  onClick={approve}
                  disabled={!isLawyer}
                  title={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
                  data-testid="approve-deal-memo-btn"
                >
                  Approve Deal Memo (as human lawyer)
                </Button>
                <Button variant="outline" onClick={generate}>
                  Regenerate
                </Button>
              </div>
              {!isLawyer && (
                <p
                  className="text-xs text-warning"
                  data-testid="lawyer-required-note"
                >
                  ⚠ {REQUIRES_LAWYER_MESSAGE}
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
