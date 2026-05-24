import type { Actor, AuditLog, Project } from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";

export interface CreateProjectInput {
  name: string;
  created_by: Actor;
  env: Env;
}

export interface CreateProjectResult {
  project: Project;
  audit: AuditLog;
}

export function createProject(input: CreateProjectInput): CreateProjectResult {
  const id = input.env.newId();
  const now = input.env.now();
  const project: Project = {
    id,
    name: input.name,
    created_at: now,
    created_by: input.created_by.id,
    status: "created",
  };
  const audit = createAuditLog({
    project_id: id,
    actor: input.created_by,
    event_type: "project_created",
    ref_id: id,
    payload: { name: input.name },
    env: input.env,
  });
  return { project, audit };
}
