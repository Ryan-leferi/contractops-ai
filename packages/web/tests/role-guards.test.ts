import { describe, expect, it } from "vitest";

import {
  DEMO_ACTOR_REGISTRY,
  REQUIRES_LAWYER_MESSAGE,
  canActAsLawyer,
} from "../lib/demo-actors";

/**
 * Milestone 3G — role-aware UI helpers.
 *
 * `canActAsLawyer` is the same predicate the core role guards use
 * (`actor.role === "human_lawyer"`). UI pages call it to pre-disable
 * lawyer-only controls before the server rejects them. These tests
 * pin its semantics and the tolerance for missing input.
 *
 * Server-side enforcement is NOT exercised here — that suite is
 * `tests/actor-context.test.ts`. UI helper is convenience only.
 */

describe("canActAsLawyer", () => {
  it("returns true ONLY for actors with role === 'human_lawyer'", () => {
    expect(canActAsLawyer(DEMO_ACTOR_REGISTRY.lawyer_kim)).toBe(true);
    expect(canActAsLawyer(DEMO_ACTOR_REGISTRY.lawyer_park)).toBe(true);
  });

  it("returns false for actors with role === 'user'", () => {
    expect(canActAsLawyer(DEMO_ACTOR_REGISTRY.business_choi)).toBe(false);
  });

  it("returns false for actors with other roles (system, agent, etc.)", () => {
    expect(canActAsLawyer({ role: "system" })).toBe(false);
    expect(canActAsLawyer({ role: "agent" })).toBe(false);
    expect(canActAsLawyer({ role: "unknown" })).toBe(false);
  });

  it("tolerates undefined / null without throwing — used during initial hydration", () => {
    expect(canActAsLawyer(undefined)).toBe(false);
    expect(canActAsLawyer(null)).toBe(false);
    expect(canActAsLawyer({})).toBe(false);
  });
});

describe("REQUIRES_LAWYER_MESSAGE", () => {
  it("is a non-empty bilingual string for UI tooltips and inline notes", () => {
    expect(typeof REQUIRES_LAWYER_MESSAGE).toBe("string");
    expect(REQUIRES_LAWYER_MESSAGE.length).toBeGreaterThan(0);
    // English half — what a developer or English-only auditor reads.
    expect(REQUIRES_LAWYER_MESSAGE.toLowerCase()).toContain("requires");
    expect(REQUIRES_LAWYER_MESSAGE.toLowerCase()).toContain("human_lawyer");
    // Korean half — what an in-house Korean legal team reads.
    expect(REQUIRES_LAWYER_MESSAGE).toContain("변호사");
  });
});
