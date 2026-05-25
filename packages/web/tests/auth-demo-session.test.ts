/**
 * DemoSessionAuthProvider + resolver unit tests (Milestone 3I).
 *
 * Pure-function tests of the auth boundary: no Next.js, no HTTP — we
 * construct standard `Request` objects and assert that the right
 * Actor / source / error comes out.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetAuthSessionResolverForTests,
  DEMO_SESSION_COOKIE_NAME,
  DemoSessionAuthProvider,
  InvalidSessionError,
  parseCookieHeader,
  requireAuthenticatedActor,
  resolveActorFromRequest,
  resolveSessionFromRequest,
} from "../lib/auth";

function requestWithCookie(value: string | null): Request {
  const headers: Record<string, string> = {};
  if (value !== null) headers["cookie"] = value;
  return new Request("http://localhost/test", { headers });
}

afterEach(() => {
  __resetAuthSessionResolverForTests();
});

// ─────────────────────────────────────────────────────────────────────
// parseCookieHeader
// ─────────────────────────────────────────────────────────────────────

describe("parseCookieHeader", () => {
  it("returns null when the header is missing / null / empty", () => {
    expect(parseCookieHeader(null, "x")).toBeNull();
    expect(parseCookieHeader(undefined, "x")).toBeNull();
    expect(parseCookieHeader("", "x")).toBeNull();
  });

  it("returns the value when the cookie is the only entry", () => {
    expect(parseCookieHeader("contractops_demo_actor=lawyer_kim", "contractops_demo_actor")).toBe(
      "lawyer_kim",
    );
  });

  it("returns the value when the cookie is one of many entries", () => {
    expect(
      parseCookieHeader(
        "ga=GA1.1.x; contractops_demo_actor=lawyer_park; theme=dark",
        "contractops_demo_actor",
      ),
    ).toBe("lawyer_park");
  });

  it("URL-decodes percent-encoded values", () => {
    expect(parseCookieHeader("k=hello%20world", "k")).toBe("hello world");
  });

  it("returns null when the cookie isn't present in the header", () => {
    expect(parseCookieHeader("a=1; b=2", "contractops_demo_actor")).toBeNull();
  });

  it("returns the first occurrence on duplicates", () => {
    expect(parseCookieHeader("x=first; x=second", "x")).toBe("first");
  });
});

// ─────────────────────────────────────────────────────────────────────
// DemoSessionAuthProvider
// ─────────────────────────────────────────────────────────────────────

describe("DemoSessionAuthProvider — cookie name + max-age constants", () => {
  it("cookie name is the documented 'contractops_demo_actor'", () => {
    expect(DEMO_SESSION_COOKIE_NAME).toBe("contractops_demo_actor");
  });
});

describe("DemoSessionAuthProvider.resolveSession", () => {
  it("returns null when no cookie is present (no implicit default)", async () => {
    const p = new DemoSessionAuthProvider();
    expect(await p.resolveSession(requestWithCookie(null))).toBeNull();
  });

  it("returns null when the cookie header omits our cookie", async () => {
    const p = new DemoSessionAuthProvider();
    expect(await p.resolveSession(requestWithCookie("other=1"))).toBeNull();
  });

  it("returns the actor + source=demo_cookie for a known cookie", async () => {
    const p = new DemoSessionAuthProvider();
    const sess = await p.resolveSession(
      requestWithCookie("contractops_demo_actor=lawyer_park"),
    );
    expect(sess).not.toBeNull();
    expect(sess!.actor.id).toBe("lawyer_park");
    expect(sess!.actor.role).toBe("human_lawyer");
    expect(sess!.source).toBe("demo_cookie");
  });

  it("returns business_choi (non-lawyer) when that cookie is set", async () => {
    const p = new DemoSessionAuthProvider();
    const sess = await p.resolveSession(
      requestWithCookie("contractops_demo_actor=business_choi"),
    );
    expect(sess!.actor.id).toBe("business_choi");
    expect(sess!.actor.role).toBe("user");
  });

  it("THROWS InvalidSessionError for an unknown actor cookie (no silent fallback)", async () => {
    const p = new DemoSessionAuthProvider();
    await expect(
      p.resolveSession(requestWithCookie("contractops_demo_actor=hacker_x")),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});

describe("DemoSessionAuthProvider.resolveActor", () => {
  it("defaults to lawyer_kim with source=demo_default when no cookie", async () => {
    const p = new DemoSessionAuthProvider();
    const sess = await p.resolveActor(requestWithCookie(null));
    expect(sess.actor.id).toBe("lawyer_kim");
    expect(sess.source).toBe("demo_default");
  });

  it("returns the cookie's actor when one is present", async () => {
    const p = new DemoSessionAuthProvider();
    const sess = await p.resolveActor(
      requestWithCookie("contractops_demo_actor=lawyer_park"),
    );
    expect(sess.actor.id).toBe("lawyer_park");
    expect(sess.source).toBe("demo_cookie");
  });

  it("still throws on an invalid cookie — does NOT silently fall back to default", async () => {
    const p = new DemoSessionAuthProvider();
    await expect(
      p.resolveActor(requestWithCookie("contractops_demo_actor=hacker_x")),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveActorFromRequest / requireAuthenticatedActor façades
// ─────────────────────────────────────────────────────────────────────

describe("resolveActorFromRequest", () => {
  it("returns lawyer_kim by default when no cookie present", async () => {
    const a = await resolveActorFromRequest(requestWithCookie(null));
    expect(a.id).toBe("lawyer_kim");
  });

  it("returns the cookie's actor when present", async () => {
    const a = await resolveActorFromRequest(
      requestWithCookie("contractops_demo_actor=business_choi"),
    );
    expect(a.id).toBe("business_choi");
    expect(a.role).toBe("user");
  });
});

describe("requireAuthenticatedActor", () => {
  it("behaves like resolveActorFromRequest in demo mode (always returns an Actor)", async () => {
    const a = await requireAuthenticatedActor(requestWithCookie(null));
    expect(a.id).toBe("lawyer_kim");
    const b = await requireAuthenticatedActor(
      requestWithCookie("contractops_demo_actor=lawyer_park"),
    );
    expect(b.id).toBe("lawyer_park");
  });
});

describe("resolveSessionFromRequest", () => {
  it("returns full session shape with actor + source label", async () => {
    const s = await resolveSessionFromRequest(requestWithCookie(null));
    expect(s.actor.id).toBe("lawyer_kim");
    expect(s.source).toBe("demo_default");
  });

  it("returns source=demo_cookie for explicit cookie", async () => {
    const s = await resolveSessionFromRequest(
      requestWithCookie("contractops_demo_actor=lawyer_park"),
    );
    expect(s.source).toBe("demo_cookie");
  });
});
