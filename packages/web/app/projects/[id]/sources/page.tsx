"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { actAddSource, actLockSourcePack } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { SourceType } from "@contractops/schemas";

const SOURCE_TYPES: SourceType[] = [
  "proposal",
  "email",
  "term_sheet",
  "quote",
  "existing_contract",
  "operation_guide",
  "policy",
  "internal_memo",
  "counterparty_request",
  "redline_draft",
];

export default function SourcesPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const locked = state.source_pack.locked;

  const [fileName, setFileName] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("proposal");
  const [version, setVersion] = useState("1");
  const [priority, setPriority] = useState(1);
  const [incorporated, setIncorporated] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!fileName.trim()) return;
    try {
      setError(null);
      applyProjectOp(params.id, (s) =>
        actAddSource(s, {
          file_name: fileName.trim(),
          source_type: sourceType,
          version,
          incorporated,
          source_priority: priority,
        }),
      );
      setFileName("");
      setPriority(priority + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function lock() {
    if (!confirm("Lock the Source Pack? No documents can be added or removed after lock.")) return;
    try {
      setError(null);
      applyProjectOp(params.id, (s) => actLockSourcePack(s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sources</h1>
          <p className="text-sm text-muted-foreground">
            Upload (mock) source documents and lock the Source Pack.
          </p>
        </div>
        <Badge variant={locked ? "warning" : "secondary"} data-testid="source-pack-status">
          {locked ? "Locked" : "Open"}
        </Badge>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="page-error"
        >
          {error}
        </div>
      )}

      {!locked && (
        <Card>
          <CardHeader>
            <CardTitle>Add a source document</CardTitle>
            <CardDescription>Mock — file name only. No actual upload.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <Label htmlFor="fname">File name</Label>
                <Input
                  id="fname"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="e.g. proposal_v1.pdf"
                  data-testid="source-file-name"
                />
              </div>
              <div>
                <Label htmlFor="stype">Source type</Label>
                <select
                  id="stype"
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as SourceType)}
                >
                  {SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="ver">Version</Label>
                <Input id="ver" value={version} onChange={(e) => setVersion(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="prio">Priority</Label>
                <Input
                  id="prio"
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 1)}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input
                  id="incorp"
                  type="checkbox"
                  checked={incorporated}
                  onChange={(e) => setIncorporated(e.target.checked)}
                />
                <Label htmlFor="incorp" className="!mb-0">Incorporated</Label>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!fileName.trim()} data-testid="add-source-btn">
                  Add document
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Source documents ({state.source_documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {state.source_documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="text-sm divide-y">
              {state.source_documents.map((d) => (
                <li key={d.id} className="py-2 flex items-center justify-between gap-2" data-testid="source-row">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.source_type} · v{d.version} · priority {d.source_priority} ·{" "}
                      {d.incorporated ? "incorporated" : "reference only"}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(d.upload_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardFooter>
          {!locked ? (
            <Button
              variant="warning"
              disabled={state.source_documents.length === 0}
              onClick={lock}
              data-testid="lock-pack-btn"
            >
              Lock Source Pack
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="pack-locked-info">
              Locked at {state.source_pack.locked_at ? formatDateTime(state.source_pack.locked_at) : "—"}.
              Any new source material requires a new Source Pack.
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
