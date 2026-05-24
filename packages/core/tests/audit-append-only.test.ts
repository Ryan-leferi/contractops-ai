import { describe, expect, it } from "vitest";
import {
  AppendOnlyViolationError,
  aggAddSource,
  aggCreateProject,
  aggLockSourcePack,
  createAuditLog,
  createInMemoryAppendOnlyRepository,
} from "@contractops/core";
import type { AuditLog } from "@contractops/schemas";
import { humanLawyer, testEnv, user } from "./helpers";

describe("AuditLog append-only repository", () => {
  it("aggregate ops emit append-friendly audits with unique ids", () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    const added = aggAddSource(created.state, {
      file_name: "p.pdf",
      source_type: "proposal",
      version: "1",
      incorporated: true,
      source_priority: 1,
      uploaded_by: user,
    }, env);
    const locked = aggLockSourcePack(added.state, user, env);

    const allAudits = [...created.audits, ...added.audits, ...locked.audits];
    const ids = allAudits.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);

    const repo = createInMemoryAppendOnlyRepository<AuditLog>((a) => a.id);
    for (const a of allAudits) repo.append(a);
    expect(repo.list().length).toBe(allAudits.length);
  });

  it("re-appending the same audit id throws AppendOnlyViolationError", () => {
    const env = testEnv();
    const repo = createInMemoryAppendOnlyRepository<AuditLog>((a) => a.id);
    const audit = createAuditLog({
      project_id: "p1",
      actor: user,
      event_type: "project_created",
      ref_id: "p1",
      env,
    });
    repo.append(audit);
    expect(() => repo.append(audit)).toThrowError(AppendOnlyViolationError);
    // The original is unchanged
    expect(repo.get(audit.id)).toEqual(audit);
  });

  it("cannot tamper with an existing audit via the repo API", () => {
    const env = testEnv();
    const repo = createInMemoryAppendOnlyRepository<AuditLog>((a) => a.id);
    const audit = createAuditLog({
      project_id: "p1",
      actor: humanLawyer,
      event_type: "final_approved",
      ref_id: "v1",
      env,
    });
    repo.append(audit);
    const tampered: AuditLog = { ...audit, payload: { malicious: true } };
    expect(() => repo.append(tampered)).toThrowError(AppendOnlyViolationError);
    expect(repo.get(audit.id)?.payload).toEqual({});
  });
});
