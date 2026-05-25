/**
 * Auth event route integration tests (Milestone 3K).
 *
 * Imports the App Router route handlers directly and invokes them
 * with constructed `Request` objects (no Next dev server). Asserts
 * that each route emits the expected auth event AND — critically —
 * that no event ever contains the plaintext password, the signed
 * session token, or the cookie value.
 *
 * Coverage:
 *   - login_success on valid credentials.
 *   - login_failed on unknown email / wrong password / disabled user,
 *     each with the right metadata.detail and NO password.
 *   - logout always emits logout.
 *   - GET /api/auth/session emits session_expired / session_tampered
 *     / session_invalid for each cause class.
 *   - POST /api/auth/demo/actor in demo mode emits demo_actor_switch
 *     with metadata.previous_actor_id.
 *   - POST /api/auth/demo/actor in signed_cookie mode (demoEnabled=false)
 *     emits demo_auth_forbidden.
 *   - GET /api/auth/events gating (403 by default, 200 when
 *     AUTH_EVENTS_INSPECT=true).
 *   - Privacy sweep: every emitted event JSON contains zero
 *     occurrences of the password / token / secret strings used in
 *     the test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as authSessionGET } from "../app/api/auth/session/route";
import { POST as authLoginPOST } from "../app/api/auth/login/route";
import { POST as authLogoutPOST } from "../app/api/auth/logout/route";
import {
  POST as authDemoActorPOST,
  DELETE as authDemoActorDELETE,
} from "../app/api/auth/demo/actor/route";
import { GET as authEventsGET } from "../app/api/auth/events/route";

import {
  __resetAuthConfigForTests,
  __resetAuthEventStoreForTests,
  __resetAuthSessionResolverForTests,
  __resetUserStoreForTests,
  createSessionToken,
  getAuthEventStore,
  getUserStore,
  seedDemoUsers,
} from "../lib/auth";
import { resetStore } from "../lib/server-store";
import { __resetPersistenceAdapterCacheForTests } from "../lib/persistence";

const SECRET = "this-is-a-32-char-test-secret-aaa";
const TEST_PASSWORD = "demo-password-not-real";

function buildRequest(opts: {
  url: string;
  method?: string;
  cookie?: string;
  body?: unknown;
  ua?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.ua) headers["user-agent"] = opts.ua;
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
  }
  return new Request(opts.url, {
    method: opts.method ?? "GET",
    headers,
    body,
  });
}

function sessionCookieFor(userId: string, expiresInSec = 60): string {
  const now = Math.floor(Date.now() / 1000);
  const token = createSessionToken(
    { user_id: userId, issued_at: now, expires_at: now + expiresInSec },
    SECRET,
  );
  return `contractops_session=${token}`;
}

async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function setSignedCookieMode() {
  process.env.AUTH_MODE = "signed_cookie";
  process.env.AUTH_SESSION_SECRET = SECRET;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
}

function setDemoMode() {
  delete process.env.AUTH_MODE;
  delete process.env.AUTH_SESSION_SECRET;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
}

beforeEach(async () => {
  __resetUserStoreForTests();
  __resetAuthEventStoreForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

afterEach(async () => {
  delete process.env.AUTH_MODE;
  delete process.env.AUTH_SESSION_SECRET;
  delete process.env.AUTH_EVENTS_INSPECT;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
  __resetAuthEventStoreForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/login — login_success + login_failed paths
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/login — auth events", () => {
  it("login_success emitted with user_id + email; no password recorded", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test", password: TEST_PASSWORD },
        ua: "vitest/1.0",
      }),
    );
    expect(res.status).toBe(200);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.event_type).toBe("login_success");
    expect(e.actor_id).toBe("lawyer_kim");
    expect(e.user_id).toBe("lawyer_kim");
    expect(e.email).toBe("lawyer.kim@example.test");
    expect(e.result).toBe("success");
    expect(e.request_context?.user_agent).toBe("vitest/1.0");
    // PRIVACY: the password, the session token, and the secret must
    // never appear anywhere in the event payload.
    const json = JSON.stringify(e);
    expect(json).not.toContain(TEST_PASSWORD);
    expect(json).not.toContain(SECRET);
  });

  it("login_failed UNKNOWN_EMAIL emitted; user_id null; password not recorded", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "nobody@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(401);
    // Client-visible error stays generic.
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "INVALID_CREDENTIALS",
    );
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.event_type).toBe("login_failed");
    expect(e.user_id).toBeNull();
    expect(e.email).toBe("nobody@example.test");
    expect(e.reason_code).toBe("INVALID_CREDENTIALS");
    expect(e.metadata.detail).toBe("UNKNOWN_EMAIL");
    expect(JSON.stringify(e)).not.toContain(TEST_PASSWORD);
  });

  it("login_failed WRONG_PASSWORD emitted; user_id known; password not recorded", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test", password: "wrong-password" },
      }),
    );
    expect(res.status).toBe(401);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.event_type).toBe("login_failed");
    expect(e.user_id).toBe("lawyer_kim");
    expect(e.email).toBe("lawyer.kim@example.test");
    expect(e.metadata.detail).toBe("WRONG_PASSWORD");
    expect(JSON.stringify(e)).not.toContain("wrong-password");
    expect(JSON.stringify(e)).not.toContain(TEST_PASSWORD);
  });

  it("login_failed DISABLED_USER emitted; user_id known", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    await getUserStore().setDisabled("lawyer_kim", "2026-01-01T00:00:00.000Z");
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(401);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata.detail).toBe("DISABLED_USER");
    expect(events[0]!.user_id).toBe("lawyer_kim");
  });

  it("malformed BAD_CREDENTIALS request does NOT emit login_failed (would be noise)", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test" }, // no password
      }),
    );
    expect(res.status).toBe(400);
    expect(await getAuthEventStore().count()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/logout — emits logout", () => {
  it("emits logout with resolved actor when a valid session cookie is present", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const res = await authLogoutPOST(
      buildRequest({
        url: "http://x/api/auth/logout",
        method: "POST",
        cookie: sessionCookieFor("lawyer_park"),
      }),
    );
    expect(res.status).toBe(200);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("logout");
    expect(events[0]!.actor_id).toBe("lawyer_park");
    expect(events[0]!.user_id).toBe("lawyer_park");
  });

  it("emits logout with actor_id null when no session is present", async () => {
    setDemoMode();
    const res = await authLogoutPOST(
      buildRequest({ url: "http://x/api/auth/logout", method: "POST" }),
    );
    expect(res.status).toBe(200);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("logout");
    expect(events[0]!.actor_id).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/session — session_expired / session_tampered / session_invalid
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/auth/session — emits session failure events", () => {
  it("expired signed cookie → session_expired event + 401", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: sessionCookieFor("lawyer_kim", -1), // already past expires_at
      }),
    );
    expect(res.status).toBe(401);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("session_expired");
    expect(events[0]!.reason_code).toBe("EXPIRED");
    expect(JSON.stringify(events[0])).not.toContain(SECRET);
  });

  it("tampered signature → session_tampered event + 401", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    const goodToken = sessionCookieFor("lawyer_kim").split("=")[1]!;
    const dot = goodToken.indexOf(".");
    const payload = goodToken.slice(0, dot);
    const sig = goodToken.slice(dot + 1);
    const firstChar = sig.charAt(0);
    const flipped = firstChar === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${sig.slice(1)}`;
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: `contractops_session=${tampered}`,
      }),
    );
    expect(res.status).toBe(401);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("session_tampered");
    expect(events[0]!.reason_code).toBe("INVALID_SIGNATURE");
  });

  it("malformed token (no dot separator) → session_invalid event + 401", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);
    // No "." means verifySessionToken throws INVALID_TOKEN_SHAPE,
    // which maps to session_invalid. A multi-dot value would be
    // parsed as "payload + sig" and yield INVALID_SIGNATURE (→
    // session_tampered) instead — exercised in the tampered test
    // above.
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: "contractops_session=garbage-no-dot",
      }),
    );
    expect(res.status).toBe(401);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("session_invalid");
    expect(events[0]!.reason_code).toBe("INVALID_TOKEN_SHAPE");
  });

  it("demo cookie with unknown actor → session_invalid event + 401", async () => {
    setDemoMode();
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: "contractops_demo_actor=hacker_x",
      }),
    );
    expect(res.status).toBe(401);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("session_invalid");
    expect(events[0]!.reason_code).toBe("UNKNOWN_ACTOR_COOKIE");
  });

  it("valid session 200 path does NOT emit an event (would be too noisy)", async () => {
    setDemoMode();
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: "contractops_demo_actor=lawyer_kim",
      }),
    );
    expect(res.status).toBe(200);
    expect(await getAuthEventStore().count()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/demo/actor — demo_actor_switch + demo_auth_forbidden
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/demo/actor — emits demo_actor_switch + demo_auth_forbidden", () => {
  it("successful switch in demo mode emits demo_actor_switch with previous_actor_id", async () => {
    setDemoMode();
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        cookie: "contractops_demo_actor=lawyer_kim",
        body: { actor_id: "lawyer_park" },
      }),
    );
    expect(res.status).toBe(200);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("demo_actor_switch");
    expect(events[0]!.actor_id).toBe("lawyer_park");
    expect(events[0]!.metadata.previous_actor_id).toBe("lawyer_kim");
    expect(events[0]!.metadata.new_actor_id).toBe("lawyer_park");
  });

  it("emits demo_auth_forbidden + 403 in signed_cookie mode", async () => {
    setSignedCookieMode();
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: { actor_id: "lawyer_kim" },
      }),
    );
    expect(res.status).toBe(403);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("demo_auth_forbidden");
    expect(events[0]!.metadata.attempted_actor_id).toBe("lawyer_kim");
    expect(events[0]!.metadata.method).toBe("POST");
  });

  it("DELETE in signed_cookie mode also emits demo_auth_forbidden", async () => {
    setSignedCookieMode();
    const res = await authDemoActorDELETE(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe("demo_auth_forbidden");
    expect(events[0]!.metadata.method).toBe("DELETE");
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/events — gating
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/auth/events — dev inspect gating", () => {
  it("returns 403 AUTH_EVENTS_INSPECT_DISABLED by default", async () => {
    const res = await authEventsGET();
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "AUTH_EVENTS_INSPECT_DISABLED",
    );
  });

  it("returns the event list when AUTH_EVENTS_INSPECT=true", async () => {
    setDemoMode();
    // Generate one event so the response isn't empty.
    await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: { actor_id: "lawyer_park" },
      }),
    );
    process.env.AUTH_EVENTS_INSPECT = "true";
    const res = await authEventsGET();
    expect(res.status).toBe(200);
    const body = await readJson<{ events: { event_type: string }[] }>(res);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.event_type).toBe("demo_actor_switch");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Privacy sweep — full route trace must never leak password / token
// ─────────────────────────────────────────────────────────────────────

describe("PRIVACY — full route trace contains no password / token / secret", () => {
  it("login_failed + login_success + logout cycle leaks nothing", async () => {
    setSignedCookieMode();
    await seedDemoUsers(getUserStore(), TEST_PASSWORD);

    // Wrong password
    await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test", password: "guess-1" },
      }),
    );
    // Correct password
    const okRes = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(okRes.status).toBe(200);
    // Extract the signed token from the response cookie so we can
    // explicitly assert it never appears in the event log.
    const setCookieHeaders = (
      okRes.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie?.() ?? [okRes.headers.get("set-cookie") ?? ""];
    const sessionSetCookie =
      setCookieHeaders.find((c) => c.startsWith("contractops_session=")) ?? "";
    const tokenValue = sessionSetCookie
      .split(";")[0]!
      .replace("contractops_session=", "");
    expect(tokenValue.length).toBeGreaterThan(20);

    // Logout
    await authLogoutPOST(
      buildRequest({
        url: "http://x/api/auth/logout",
        method: "POST",
        cookie: `contractops_session=${tokenValue}`,
      }),
    );

    const allEventsJson = JSON.stringify(await getAuthEventStore().list());
    expect(allEventsJson).not.toContain(TEST_PASSWORD);
    expect(allEventsJson).not.toContain("guess-1");
    expect(allEventsJson).not.toContain(tokenValue);
    expect(allEventsJson).not.toContain(SECRET);
  });
});
