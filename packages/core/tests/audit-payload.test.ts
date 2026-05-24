import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  aggCreateRevision,
  aggDecideIssue,
  aggRunMockReviews,
} from "@contractops/core";
import { humanLawyer } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";

/**
 * Milestone 2B requirement: AuditLog payload for agent-backed operations
 * must carry provider_id, mode, role, and agent_run_id so a lawyer can later
 * see whether a change came from a mock or real backend.
 */

describe("Agent-backed audit log payloads", () => {
  it("draft_created audit (from aggCreateV0) carries provider provenance", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const draftAudits = ready.audits.filter((a) => a.event_type === "draft_created");
    expect(draftAudits.length).toBe(1);
    const a = draftAudits[0]!;
    const payload = a.payload as Record<string, unknown>;
    expect(payload.provider_id).toBe("mock");
    expect(payload.mode).toBe("mock");
    expect(payload.role).toBe("contract_drafter");
    expect(typeof payload.agent_run_id).toBe("string");
    expect((payload.agent_run_id as string).length).toBeGreaterThan(0);
  });

  it("revision_generated audit carries provider provenance + applied/skipped lists", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    let s = (await aggRunMockReviews(ready.s, ready.ctx)).state;
    if (s.issue_cards.length > 0) {
      // accept first, reject second (if exists)
      s = aggDecideIssue(s, {
        issue_id: s.issue_cards[0]!.issue_id,
        decision: "accepted",
        decided_by: humanLawyer,
      }, ready.env).state;
      if (s.issue_cards.length > 1) {
        s = aggDecideIssue(s, {
          issue_id: s.issue_cards[1]!.issue_id,
          decision: "rejected",
          decided_by: humanLawyer,
        }, ready.env).state;
      }
    }
    const rev = await aggCreateRevision(s, ready.ctx);
    expect(rev.audits.length).toBe(1);
    const payload = rev.audits[0]!.payload as Record<string, unknown>;
    expect(payload.provider_id).toBe("mock");
    expect(payload.mode).toBe("mock");
    expect(payload.role).toBe("revision_agent");
    expect(typeof payload.agent_run_id).toBe("string");
    expect(Array.isArray(payload.applied_issue_card_ids)).toBe(true);
    expect(Array.isArray(payload.skipped)).toBe(true);
  });
});
