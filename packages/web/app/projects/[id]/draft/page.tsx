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

  function generate() {
    try {
      setError(null);
      applyProjectOp(params.id, (s) => actCreateV0(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const versions = state.contract_versions;
  const v0 = versions.find((v) => v.version_number === "v0") ?? versions[0];

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
          <CardContent>
            <Button onClick={generate} data-testid="generate-v0-btn">
              Generate mock v0 draft
            </Button>
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
