"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import { actAddSource, actAddSourceContent, actLockSourcePack } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { SourceDocument, SourceType } from "@contractops/schemas";

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

const CONTENT_SOFT_LIMIT = 5 * 1024; // 5KB warning threshold

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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!fileName.trim()) return;
    try {
      setError(null);
      await applyProjectOp(
        params.id,
        actAddSource({
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

  async function lock() {
    if (!confirm("Lock the Source Pack? No documents can be added or removed after lock.")) return;
    try {
      setError(null);
      await applyProjectOp(params.id, actLockSourcePack());
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
            Upload (mock) source documents and lock the Source Pack. Optional
            text bodies feed the mock review/draft agents.
          </p>
        </div>
        <Badge variant={locked ? "warning" : "secondary"} data-testid="source-pack-status">
          {locked ? "Locked" : "Open"}
        </Badge>
      </div>

      <div className="rounded-md border border-warning bg-warning/10 p-3 text-xs">
        <strong>Synthetic / sample text only.</strong> This is mock mode — do
        not paste real confidential source documents. Anything pasted here will
        be stored in localStorage and may be sent to a real LLM provider once
        real mode is wired (later milestone).
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
          <CardDescription>
            Click a row to attach synthetic text content used by the mock agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.source_documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="text-sm divide-y">
              {state.source_documents.map((d) => (
                <SourceDocumentRow
                  key={d.id}
                  doc={d}
                  existingContent={state.source_contents.find((c) => c.source_document_id === d.id)?.text_content ?? ""}
                  onSaveContent={async (text) => {
                    try {
                      setError(null);
                      await applyProjectOp(
                        params.id,
                        actAddSourceContent({ source_document_id: d.id, text_content: text }),
                      );
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
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
              Any new source material requires a new Source Pack. (Editing text
              content of an already-uploaded document is still allowed.)
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

function SourceDocumentRow({
  doc,
  existingContent,
  onSaveContent,
}: {
  doc: SourceDocument;
  existingContent: string;
  onSaveContent: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(existingContent);
  const tooBig = draft.length > CONTENT_SOFT_LIMIT;

  return (
    <li className="py-2" data-testid="source-row">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{doc.file_name}</div>
          <div className="text-xs text-muted-foreground">
            {doc.source_type} · v{doc.version} · priority {doc.source_priority} ·{" "}
            {doc.incorporated ? "incorporated" : "reference only"}
            {existingContent ? " · content attached" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatDateTime(doc.upload_date)}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(!open)}
            data-testid={`toggle-content-${doc.id}`}
          >
            {open ? "Hide content" : existingContent ? "Edit content" : "Add content"}
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste synthetic content (no real confidential text). Used by the mock review/draft agents."
            rows={6}
            data-testid={`source-content-textarea-${doc.id}`}
          />
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {draft.length.toLocaleString()} characters
              {tooBig && (
                <span className="text-warning ml-2">
                  ⚠ over 5KB — mock prompts will truncate.
                </span>
              )}
            </div>
            <Button
              size="sm"
              onClick={async () => {
                await onSaveContent(draft);
                setOpen(false);
              }}
              disabled={!draft.trim()}
              data-testid={`save-content-${doc.id}`}
            >
              Save content
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
