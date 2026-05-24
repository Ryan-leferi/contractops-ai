import type { Actor, AuditLog, AuditEventType } from "@contractops/schemas";
import type { Env } from "./env";

export interface CreateAuditLogInput {
  project_id: string;
  actor: Actor | "system";
  event_type: AuditEventType;
  ref_id: string;
  payload?: Record<string, unknown>;
  env: Env;
}

export function createAuditLog(input: CreateAuditLogInput): AuditLog {
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    actor: typeof input.actor === "string" ? input.actor : input.actor.id,
    event_type: input.event_type,
    ref_id: input.ref_id,
    timestamp: input.env.now(),
    payload: input.payload ?? {},
  };
}
