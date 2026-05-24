import type {
  Actor,
  AuditLog,
  SourceDocument,
  SourcePack,
  SourceType,
} from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface CreateSourcePackInput {
  project_id: string;
  env: Env;
}

export function createSourcePack(input: CreateSourcePackInput): SourcePack {
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    locked: false,
    locked_at: null,
    document_ids: [],
  };
}

export interface AddSourceDocumentInput {
  pack: SourcePack;
  file_name: string;
  source_type: SourceType;
  version: string;
  incorporated: boolean;
  source_priority: number;
  uploaded_by: Actor;
  env: Env;
}

export interface AddSourceDocumentResult {
  pack: SourcePack;
  document: SourceDocument;
  audit: AuditLog;
}

export function addSourceDocument(input: AddSourceDocumentInput): AddSourceDocumentResult {
  if (input.pack.locked) {
    throw errors.sourcePackLocked();
  }
  const now = input.env.now();
  const document: SourceDocument = {
    id: input.env.newId(),
    project_id: input.pack.project_id,
    file_name: input.file_name,
    upload_date: now,
    source_type: input.source_type,
    version: input.version,
    incorporated: input.incorporated,
    source_priority: input.source_priority,
  };
  const pack: SourcePack = {
    ...input.pack,
    document_ids: [...input.pack.document_ids, document.id],
  };
  const audit = createAuditLog({
    project_id: input.pack.project_id,
    actor: input.uploaded_by,
    event_type: "source_uploaded",
    ref_id: document.id,
    payload: { file_name: input.file_name, source_type: input.source_type },
    env: input.env,
  });
  return { pack, document, audit };
}

export interface RemoveSourceDocumentInput {
  pack: SourcePack;
  document_id: string;
}

export function removeSourceDocument(input: RemoveSourceDocumentInput): SourcePack {
  if (input.pack.locked) {
    throw errors.sourcePackLocked();
  }
  return {
    ...input.pack,
    document_ids: input.pack.document_ids.filter((id) => id !== input.document_id),
  };
}

export interface LockSourcePackInput {
  pack: SourcePack;
  locked_by: Actor;
  env: Env;
}

export interface LockSourcePackResult {
  pack: SourcePack;
  audit: AuditLog;
}

export function lockSourcePack(input: LockSourcePackInput): LockSourcePackResult {
  const now = input.env.now();
  const pack: SourcePack = {
    ...input.pack,
    locked: true,
    locked_at: now,
  };
  const audit = createAuditLog({
    project_id: input.pack.project_id,
    actor: input.locked_by,
    event_type: "source_pack_locked",
    ref_id: pack.id,
    payload: { document_count: pack.document_ids.length },
    env: input.env,
  });
  return { pack, audit };
}
