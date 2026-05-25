"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useCurrentActor, useStore } from "@/components/store-provider";
import { REQUIRES_LAWYER_MESSAGE, canActAsLawyer } from "@/lib/demo-actors";
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
import type { ProjectState } from "@contractops/core";
import type { Operation } from "@/lib/operations";

interface ExportSpec {
  type: ExportType;
  title: string;
  audience: "external" | "internal";
  description: string;
  /**
   * Server-side render endpoint produces the binary. All four MVP exports
   * now use this path (Milestone 3B). The on-page `content` preview is a
   * short metadata summary — the binary itself is NEVER stored in
   * ProjectState / localStorage (the brief forbids it).
   */
  buttonLabel: string;
  /** Fallback extension used when the API response has no filename hint. */
  defaultExt: "docx" | "md";
}

const SPECS: ExportSpec[] = [
  {
    type: "clean_docx",
    title: "External clean DOCX",
    audience: "external",
    description:
      "Counterparty-facing clean contract. Generated server-side as a real .docx. Contains no internal commentary.",
    buttonLabel: "Download external clean DOCX",
    defaultExt: "docx",
  },
  {
    type: "cover_email",
    title: "External cover email draft (Markdown)",
    audience: "external",
    description:
      "Polite Korean business email draft to accompany the clean DOCX. Generated as .md. The system NEVER sends email — a human lawyer copies, edits, and sends manually.",
    buttonLabel: "Download external cover email draft (.md)",
    defaultExt: "md",
  },
  {
    type: "commentary_docx",
    title: "Internal commentary DOCX",
    audience: "internal",
    description:
      "Internal legal commentary with rationale for every Issue Card. Generated server-side as a real .docx. Confidential — DO NOT send externally.",
    buttonLabel: "Download internal commentary DOCX",
    defaultExt: "docx",
  },
  {
    type: "negotiation_matrix",
    title: "Internal negotiation matrix",
    audience: "internal",
    description:
      "Per-Issue Card matrix: decision status, recommended response position, partial-acceptance notes, Playbook fallbacks. INTERNAL ONLY.",
    buttonLabel: "Download internal negotiation matrix DOCX",
    defaultExt: "docx",
  },
];

export default function ExportsPage() {
  const params = useParams<{ id: string }>();
  const { store, applyProjectOp } = useStore();
  const state = store.projects[params.id]!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportType | null>(null);

  const final = state.contract_versions.find((v) => v.final);
  const isLawyer = canActAsLawyer(useCurrentActor());

  async function handleAction(spec: ExportSpec) {
    if (!final) return;
    setError(null);
    setBusy(spec.type);
    try {
      await downloadExport(state, final, spec, params.id, applyProjectOp);
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
          All four MVP exports are produced server-side and streamed to your
          browser. External-facing and internal-only artifacts are produced
          via separate render paths (PLATFORM_BRIEF.md §5 rule 6) and visually
          separated below. <strong>The system never sends an external email
          automatically</strong> — the cover email draft is for a human
          lawyer to copy / edit / send.
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

      {!isLawyer && (
        <div
          className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-warning"
          data-testid="lawyer-required-note"
        >
          ⚠ {REQUIRES_LAWYER_MESSAGE} — Export 다운로드 버튼은 비활성화됩니다.
        </div>
      )}

      <section data-testid="external-section">
        <h2 className="text-sm font-medium text-success mb-2">
          External — safe to send to counterparty
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
                disabled={!final || busy !== null || !isLawyer}
                disabledReason={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
                busy={busy === s.type}
              />
            );
          })}
        </div>
      </section>

      <section data-testid="internal-section">
        <h2 className="text-sm font-medium text-destructive mb-2">
          Internal — never send externally
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
                disabled={!final || busy !== null || !isLawyer}
                disabledReason={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
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
  disabledReason,
  busy,
}: {
  spec: ExportSpec;
  existing: ExportFile | undefined;
  onAction: () => void;
  disabled: boolean;
  disabledReason?: string;
  busy: boolean;
}) {
  const externalClasses = "border-success/40 bg-success/5";
  const internalClasses = "border-destructive/40 bg-destructive/5";

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
          title={disabledReason}
          data-testid={`create-export-${spec.type}-btn`}
        >
          {busy ? "Working…" : spec.buttonLabel}
        </Button>
        {existing && (
          <span
            className="text-xs text-muted-foreground"
            data-testid={`export-filename-${spec.type}`}
          >
            {existing.file_name ?? formatDateTime(existing.created_at)}
          </span>
        )}
      </div>
    </Card>
  );
}

// ---------- export download helper ----------

/**
 * 1. POST ProjectState + export_type to /api/exports/render. The server
 *    re-validates the final-approval guard, picks the right renderer, and
 *    streams back the bytes with a matching MIME type and a filename.
 * 2. Trigger a browser download via a Blob URL.
 * 3. Register an ExportFile + AuditLog locally so the audit trail captures
 *    what was downloaded. The aggCreateExport guard inside actCreateExport
 *    would also throw if the project somehow isn't final-approved, but the
 *    server check is the authoritative one.
 *
 * Binary bytes never enter ProjectState or localStorage. ExportFile.content
 * stores a short metadata blurb (file name + size + summary) so the on-page
 * preview can show what was just downloaded.
 */
async function downloadExport(
  state: ProjectState,
  final: ContractVersion,
  spec: ExportSpec,
  projectId: string,
  applyProjectOp: (id: string, op: Operation) => Promise<void>,
): Promise<void> {
  const res = await fetch("/api/exports/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ export_type: spec.type, project_state: state }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // body wasn't JSON; keep the HTTP status text
    }
    throw new Error(`Export render failed: ${detail}`);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const file_name =
    decodeFilename(disposition) ??
    `${slug(state.project.name)}_${slug(final.version_number)}_${spec.type}.${spec.defaultExt}`;

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

  // Compose a small preview blurb. For external types (clean_docx,
  // cover_email) we use the existing mock content helpers — they are
  // already known to contain no internal markers. For internal types
  // (commentary_docx, negotiation_matrix) we use the internal mock helpers.
  const summary = previewBlurb(state, final, spec.type);
  const metaBlurb = [
    `[${spec.type.toUpperCase()}] Downloaded ${file_name} (${blob.size.toLocaleString()} bytes)`,
    `Source Pack: ${final.source_pack_id}  |  Playbook: ${final.playbook_id}  |  Version: ${final.version_number}`,
    "",
    summary,
  ].join("\n");

  await applyProjectOp(
    projectId,
    actCreateExport({ export_type: spec.type, content: metaBlurb, file_name }),
  );
}

function previewBlurb(
  state: ProjectState,
  final: ContractVersion,
  type: ExportType,
): string {
  switch (type) {
    case "clean_docx":
      return mockCleanExportContent(state, final);
    case "commentary_docx":
      return mockCommentaryExportContent(state, final);
    case "negotiation_matrix":
      return mockNegotiationMatrixContent(state);
    case "cover_email":
      return mockCoverEmailContent(state, final);
  }
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
