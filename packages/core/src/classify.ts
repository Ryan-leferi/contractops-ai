import type { Actor, AuditLog, ContractType, SourcePack } from "@contractops/schemas";
import type { Env } from "./env";
import { createAuditLog } from "./audit-log";
import { errors } from "./errors";

export interface ClassifyContractTypeMockInput {
  project_id: string;
  source_pack: SourcePack;
  hint?: string;
  confidence?: number;
  env: Env;
}

export function classifyContractTypeMock(
  input: ClassifyContractTypeMockInput,
): ContractType {
  const suggested = input.hint ?? null;
  return {
    id: input.env.newId(),
    project_id: input.project_id,
    suggested_type: suggested,
    suggested_confidence: suggested ? (input.confidence ?? 0.5) : null,
    suggested_at: input.env.now(),
    confirmed_type: null,
    confirmed_by: null,
    confirmed_at: null,
    is_confirmed: false,
  };
}

export interface ConfirmContractTypeInput {
  contract_type: ContractType;
  confirmed_type: string;
  confirmed_by: Actor;
  env: Env;
}

export interface ConfirmContractTypeResult {
  contract_type: ContractType;
  audit: AuditLog;
}

export function confirmContractType(
  input: ConfirmContractTypeInput,
): ConfirmContractTypeResult {
  if (input.confirmed_by.role !== "human_lawyer") {
    throw errors.notHumanLawyer();
  }
  const now = input.env.now();
  const updated: ContractType = {
    ...input.contract_type,
    confirmed_type: input.confirmed_type,
    confirmed_by: input.confirmed_by.id,
    confirmed_at: now,
    is_confirmed: true,
  };
  const audit = createAuditLog({
    project_id: input.contract_type.project_id,
    actor: input.confirmed_by,
    event_type: "contract_type_confirmed",
    ref_id: updated.id,
    payload: { confirmed_type: input.confirmed_type },
    env: input.env,
  });
  return { contract_type: updated, audit };
}
