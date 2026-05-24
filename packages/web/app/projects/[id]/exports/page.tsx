"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/store-provider";
import {
  actCreateExport,
  mockCleanExportContent,
  mockCommentaryExportContent,
  mockCoverEmailContent,
  mockNegotiationMatrixContent,
} from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import type { ExportFile, ExportType, ContractVersion } from "@contractops/schemas";
import type { AggregateResult, ProjectState } from "@contractops/core";

interface ExportSpec {
  type: ExportType;
  title: string;
  audience: "external" | "internal";
  description: string;
  /**
   * If true, clicking the button downloads a real .docx binary from the
   * server-side /api/exports/docx route. The on-page `content` preview is
   * still a short metadata summary — the binary itself is NEVER stored in
   * ProjectState / localStorage (the brief forbids it).
   */
  docx?: boolean;
}

const SPECS: ExportSpec[] = [
  {
    type: "clean_docx",
    title: "External clean DOCX",
    audience: "external",
    description:
      "Counterparty-facing clean contract. Generated server-side as a real .docx. Contains no internal commentary.",
    docx: true,
  },
  {
    type: "cover_email",
    title: "Cover email draft",
    audience: "external",
    description: "Draft email to send the clean DOCX. Never sent automatically.",
  },
  {
    type: "commentary_docx",
    title: "Internal commentary DOCX",
    audience: "internal",
    description:
      "Internal legal commentary with rationale for every Issue Card. Generated server-side as a real .docx. Confidential — DO NOT send externally.",
    docx: true,
  },
  {
    type: "negotiation_matrix",
    title: "Negotiation matrix",
    audience: "internal",
    description: "Internal cheat sheet of positions and fallbacks. Do not share externally.",
  },
];

export default function ExportsPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportType | null>(null);

  const final = state.contract_versions.find((v) => v.final);

  async function handleAction(spec: ExportSpec) {
    if (!final) return;
    setError(null);
    setBusy(spec.type);
    try {
      if (spec.docx) {
        await downloadDocx(state, final, spec.type, params.id, applyProjectOp);
      } else {
        const content =
          spec.type === "negotiation_matrix"
            ? mockNegotiationMatrixContent(state)
            : mockCoverEmailContent(state, final);
        await applyProjectOp(params.id, (s) =>
          actCreateExport(s, { export_type: spec.type, content }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Exports</h1>
        <p className="text-sm text-muted-foreground">
          External-facing and internal-only artifacts are produced via separate
          render paths (PLATFORM_BRIEF.md §5 rule 6) and visually separated
          below. DOCX exports are generated in memory on the server and
          streamed to your browser — they are never persisted on disk nor
          sent externally.
        </p>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="page-error"
        >
          {error}
        </div>
      )}

      {!final && (
        <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
          Approve a final version on the QA &amp; Final page before generating exports.
        </div>
      )}

      <section data-testid="external-section">
        <h2 className="text-sm font-medium text-success mb-2">
          External (clean) — safe to send to counterparty
        </h2>
        <div className="grid md:grid-cols-2 gap-3">
          {SPECS.filter((s) => s.audience === "external").map((s) => {
            const existing = state.exports.find((e) => e.export_type === s.type);
            return (
              <ExportCard
                key={s.type}
                spec={s}
                existing={existing}
                onAction={() => handleAction(s)}
                disabled={!final || busy !== null}
                busy={busy === s.type}
              />
            );
          })}
        </div>
      </section>

      <section data-testid="internal-section">
        <h2 className="text-sm font-medium text-destructive mb-2">
          Internal (commentary) — never send externally
        </h2>
        <div className="grid md:grid-cols-2 gap-3">
          {SPECS.filter((s) => s.audience === "internal").map((s) => {
            const existing = state.exports.find((e) => e.export_type === s.type);
            return (
              <ExportCard
                key={s.type}
                spec={s}
                existing={existing}
                onAction={() => handleAction(s)}
                disabled={!final || busy !== null}
                busy={busy === s.type}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ExportCard({
  spec,
  existing,
  onAction,
  disabled,
  busy,
}: {
  spec: ExportSpec;
  existing: ExportFile | undefined;
  onAction: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  const externalClasses = "border-success/40 bg-success/5";
  const internalClasses = "border-destructive/40 bg-destructive/5";
  const label = spec.docx
    ? spec.audience === "external"
      ? "Download external clean DOCX"
      : "Download internal commentary DOCX"
    : existing
      ? "Re-generate"
      : "Create export";

  return (
    <Card
      className={cn(spec.audience === "external" ? externalClasses : internalClasses)}
      data-testid={`export-card-${spec.type}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{spec.title}</CardTitle>
          <Badge variant={spec.audience === "external" ? "success" : "destructive"}>
            {spec.audience === "external" ? "external" : "internal"}
          </Badge>
        </div>
        <CardDescription>{spec.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {existing ? (
          <pre
            className="text-xs whitespace-pre-wrap bg-background border rounded-md p-3 max-h-60 overflow-y-auto"
            data-testid={`export-content-${spec.type}`}
          >
            {existing.content}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground italic">Not yet generated.</p>
        )}
      </CardContent>
      <div className="p-4 border-t flex items-center justify-between gap-2 flex-wrap">
        <Button
          size="sm"
          variant={spec.audience === "external" ? "success" : "destructive"}
          onClick={onAction}
          disabled={disabled}
          data-testid={`create-export-${spec.type}-btn`}
        >
          {busy ? "Working…" : label}
        </Button>
        {existing && (
          <span className="text-xs text-muted-foreground" data-testid={`export-filename-${spec.type}`}>
            {existing.file_name ?? formatDateTime(existing.created_at)}
          </span>
        )}
      </div>
    </Card>
  );
}

// ---------- DOCX download helper ----------

/**
 * 1. Registers the ExportFile + AuditLog locally (this is what enforces the
 *    final-approval guard via aggCreateExport — throws if not approved).
 * 2. POSTs the current ProjectState to /api/exports/docx, receives the
 *    binary, and triggers a browser download via a Blob URL.
 *
 * Binary bytes never enter ProjectState or localStorage. The local record
 * stores a short metadata summary in `ExportFile.content` so the page can
 * show "this was generated at HH:MM with file_name=...".
 */
async function downloadDocx(
  state: ProjectState,
  final: ContractVersion,
  export_type: ExportType,
  projectId: string,
  applyProjectOp: (
    id: string,
    op: (s: ProjectState) => AggregateResult | Promise<AggregateResult>,
  ) => Promise<void>,
): Promise<void> {
  const res = await fetch("/api/exports/docx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ export_type, project_state: state }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // body wasn't JSON; keep the HTTP status text
    }
    throw new Error(`DOCX render failed: ${detail}`);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const file_name =
    decodeFilename(disposition) ??
    (export_type === "clean_docx"
      ? `${slug(state.project.name)}_${slug(final.version_number)}_clean.docx`
      : `${slug(state.project.name)}_${slug(final.version_number)}_commentary_INTERNAL.docx`);

  const blob = await res.blob();

  // Trigger the browser download. URL.createObjectURL + an anchor is the
  // standard browser pattern; the URL is revoked on the next tick.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file_name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);

  // Record the export in ProjectState + AuditLog (this also enforces the
  // final-approval guard — if the server somehow returned a binary without
  // a final-approved version, this throws and the user sees the error).
  const summary =
    export_type === "clean_docx"
      ? mockCleanExportContent(state, final)
      : mockCommentaryExportContent(state, final);
  const metaBlurb = [
    `[${export_type.toUpperCase()}] Downloaded ${file_name} (${blob.size.toLocaleString()} bytes)`,
    `Source Pack: ${final.source_pack_id}  |  Playbook: ${final.playbook_id}  |  Version: ${final.version_number}`,
    "",
    summary,
  ].join("\n");
  await applyProjectOp(projectId, (s) =>
    actCreateExport(s, { export_type, content: metaBlurb, file_name }),
  );
}

function decodeFilename(disposition: string): string | null {
  // Try RFC 5987 filename* first.
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
    } catch {
      // fall through
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  if (plain) return plain[1];
  return null;
}

function slug(raw: string): string {
  return (raw || "untitled")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}
