import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEMO_ACTOR_ID,
  DEMO_ACTOR_IDS,
  DEMO_ACTOR_REGISTRY,
  UnknownActorError,
  isKnownDemoActorId,
  listDemoActors,
  resolveDemoActor,
} from "../lib/demo-actors";

/**
 * Milestone 3F — demo actor registry unit tests.
 *
 * The registry is the entirety of "authorization" until a real
 * authentication milestone replaces it. These tests pin its shape and
 * the validation rules the API route relies on.
 */

describe("DEMO_ACTOR_REGISTRY", () => {
  it("contains exactly the three documented demo actors", () => {
    expect(DEMO_ACTOR_IDS).toEqual(["lawyer_kim", "lawyer_park", "business_choi"]);
    expect(Object.keys(DEMO_ACTOR_REGISTRY).sort()).toEqual(
      ["business_choi", "lawyer_kim", "lawyer_park"],
    );
  });

  it("assigns the expected roles", () => {
    expect(DEMO_ACTOR_REGISTRY.lawyer_kim.role).toBe("human_lawyer");
    expect(DEMO_ACTOR_REGISTRY.lawyer_park.role).toBe("human_lawyer");
    expect(DEMO_ACTOR_REGISTRY.business_choi.role).toBe("user");
  });

  it("ids match the field on each entry", () => {
    for (const id of DEMO_ACTOR_IDS) {
      expect(DEMO_ACTOR_REGISTRY[id].id).toBe(id);
    }
  });

  it("the registry default is a human_lawyer", () => {
    const def = DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID];
    expect(def.role).toBe("human_lawyer");
  });
});

describe("listDemoActors", () => {
  it("returns every registry entry in declaration order", () => {
    const list = listDemoActors();
    expect(list.map((a) => a.id)).toEqual([
      "lawyer_kim",
      "lawyer_park",
      "business_choi",
    ]);
  });
});

describe("resolveDemoActor", () => {
  it("resolves each known id to its registry entry", () => {
    for (const id of DEMO_ACTOR_IDS) {
      expect(resolveDemoActor(id)).toEqual(DEMO_ACTOR_REGISTRY[id]);
    }
  });

  it("falls back to the registry default when no id is given", () => {
    expect(resolveDemoActor(null)).toEqual(
      DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID],
    );
    expect(resolveDemoActor(undefined)).toEqual(
      DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID],
    );
    expect(resolveDemoActor("")).toEqual(
      DEMO_ACTOR_REGISTRY[DEFAULT_DEMO_ACTOR_ID],
    );
  });

  it("THROWS UnknownActorError for ids outside the registry — server returns 400 on this", () => {
    expect(() => resolveDemoActor("anonymous")).toThrow(UnknownActorError);
    expect(() => resolveDemoActor("lawyer_lee")).toThrow(UnknownActorError);
    expect(() => resolveDemoActor("evil_admin")).toThrow(UnknownActorError);
    // The thrown error names the offending id for debugging.
    try {
      resolveDemoActor("anonymous");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownActorError);
      expect((err as UnknownActorError).actor_id).toBe("anonymous");
      expect((err as UnknownActorError).code).toBe("UNKNOWN_ACTOR");
    }
  });
});

describe("isKnownDemoActorId", () => {
  it("type-narrows for the three valid ids", () => {
    expect(isKnownDemoActorId("lawyer_kim")).toBe(true);
    expect(isKnownDemoActorId("lawyer_park")).toBe(true);
    expect(isKnownDemoActorId("business_choi")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isKnownDemoActorId("anonymous")).toBe(false);
    expect(isKnownDemoActorId("")).toBe(false);
    expect(isKnownDemoActorId(null)).toBe(false);
    expect(isKnownDemoActorId(undefined)).toBe(false);
    expect(isKnownDemoActorId(42)).toBe(false);
    expect(isKnownDemoActorId({ id: "lawyer_kim" })).toBe(false);
  });
});
