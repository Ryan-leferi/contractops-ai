import type {
  Actor,
  AuditLog,
  ContractVersion,
  ExportFile,
  ExportType,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export const COMMENTARY_MARKERS = [
  "[COMMENTARY]",
  "[INTERNAL]",
  "[REDLINE_RATIONALE]",
  "[NEGOTIATION_GUIDANCE]",
] as const;

export interface CreateExportPlaceholderInput {
  version: ContractVersion;
  export_type: ExportType;
  content: string;
  created_by: Actor;
  env: Env;
}

export interface CreateExportPlaceholderResult {
  file: ExportFile;
  audit: AuditLog;
}

export function createExportPlaceholder(
  input: CreateExportPlaceholderInput,
): CreateExportPlaceholderResult {
  if (!input.version.final) {
    throw errors.finalNotApproved();
  }
  if (input.export_type === "clean_docx") {
    for (const marker of COMMENTARY_MARKERS) {
      if (input.content.includes(marker)) {
        throw errors.commentaryInCleanExport();
      }
    }
  }

  const now = input.env.now();
  const file: ExportFile = {
    id: input.env.newId(),
    project_id: input.version.project_id,
    contract_version_id: input.version.id,
    export_type: input.export_type,
    content: input.content,
    created_at: now,
    created_by: input.created_by.id,
  };
  const audit = createAuditLog({
    project_id: input.version.project_id,
    actor: input.created_by,
    event_type: "exported",
    ref_id: file.id,
    payload: {
      export_type: input.export_type,
      contract_version_id: input.version.id,
    },
    env: input.env,
  });

  return { file, audit };
}
