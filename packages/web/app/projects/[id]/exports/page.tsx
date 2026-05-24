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
import type { ExportFile, ExportType } from "@contractops/schemas";

interface ExportSpec {
  type: ExportType;
  title: string;
  audience: "external" | "internal";
  description: string;
}

const SPECS: ExportSpec[] = [
  {
    type: "clean_docx",
    title: "Clean DOCX",
    audience: "external",
    description: "External-facing clean contract. Must contain no internal commentary.",
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
    description: "Legal commentary with rationale for each Issue Card decision. Confidential.",
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

  const final = state.contract_versions.find((v) => v.final);

  function create(type: ExportType) {
    if (!final) return;
    try {
      setError(null);
      const content =
        type === "clean_docx"
          ? mockCleanExportContent(state, final)
          : type === "commentary_docx"
          ? mockCommentaryExportContent(state, final)
          : type === "negotiation_matrix"
          ? mockNegotiationMatrixContent(state)
          : mockCoverEmailContent(state, final);
      applyProjectOp(params.id, (s) =>
        actCreateExport(s, { export_type: type, content }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Exports</h1>
        <p className="text-sm text-muted-foreground">
          Placeholder export artifacts. External-facing and internal-only outputs are produced via
          separate render paths and visually separated below.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive" data-testid="page-error">
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
            return <ExportCard key={s.type} spec={s} existing={existing} onCreate={() => create(s.type)} disabled={!final} />;
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
            return <ExportCard key={s.type} spec={s} existing={existing} onCreate={() => create(s.type)} disabled={!final} />;
          })}
        </div>
      </section>
    </div>
  );
}

function ExportCard({
  spec,
  existing,
  onCreate,
  disabled,
}: {
  spec: ExportSpec;
  existing: ExportFile | undefined;
  onCreate: () => void;
  disabled: boolean;
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
          <pre className="text-xs whitespace-pre-wrap bg-background border rounded-md p-3 max-h-60 overflow-y-auto" data-testid={`export-content-${spec.type}`}>
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
          onClick={onCreate}
          disabled={disabled}
          data-testid={`create-export-${spec.type}-btn`}
        >
          {existing ? "Re-generate" : "Create export"}
        </Button>
        {existing && (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(existing.created_at)}
          </span>
        )}
      </div>
    </Card>
  );
}
