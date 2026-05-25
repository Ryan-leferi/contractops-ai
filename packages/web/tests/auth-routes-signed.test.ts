/**
 * Signed-cookie auth route integration tests (Milestone 3J).
 *
 * Imports the App Router route handlers directly and invokes them
 * with constructed `Request` objects (no Next dev server). Tests:
 *
 *   - POST /api/auth/login: valid creds → 200 + Set-Cookie;
 *                            unknown email → 401 INVALID_CREDENTIALS;
 *                            wrong password → 401 INVALID_CREDENTIALS;
 *                            disabled user → 401 INVALID_CREDENTIALS (same code, no leak);
 *                            missing fields → 400 BAD_CREDENTIALS;
 *                            wrong auth mode → 400 AUTH_MODE_MISMATCH.
 *   - POST /api/auth/logout: clears the signed cookie + demo cookie.
 *   - GET /api/auth/session: in signed mode, no cookie → 200 anonymous;
 *                            valid cookie → 200 authenticated;
 *                            bad cookie   → 401 INVALID_SESSION + clear.
 *   - POST /api/auth/demo/actor: in signed mode with demo disabled → 403.
 *   - POST /api/projects/[id]/operations:
 *       signed-in business_choi cannot approve_deal_memo (422);
 *       signed-in lawyer_park can approve_deal_memo (200);
 *       AuditLog records signed-in actor;
 *       body.actor_id rejection still fires.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as authSessionGET } from "../app/api/auth/session/route";
import { POST as authLoginPOST } from "../app/api/auth/login/route";
import { POST as authLogoutPOST } from "../app/api/auth/logout/route";
import { POST as authDemoActorPOST } from "../app/api/auth/demo/actor/route";
import { POST as operationsPOST } from "../app/api/projects/[id]/operations/route";

import {
  __resetAuthConfigForTests,
  __resetAuthSessionResolverForTests,
  __resetUserStoreForTests,
  createSessionToken,
  getUserStore,
  seedDemoUsers,
} from "../lib/auth";
import { createProjectInStore, resetStore } from "../lib/server-store";
import { __resetPersistenceAdapterCacheForTests } from "../lib/persistence";
import { DEMO_ACTOR_REGISTRY } from "../lib/demo-actors";

const SECRET = "this-is-a-32-char-test-secret-aaa";
const TEST_PASSWORD = "demo-password";
const KIM = DEMO_ACTOR_REGISTRY.lawyer_kim;
const PARK = DEMO_ACTOR_REGISTRY.lawyer_park;
const CHOI = DEMO_ACTOR_REGISTRY.business_choi;

beforeEach(async () => {
  process.env.AUTH_MODE = "signed_cookie";
  process.env.AUTH_SESSION_SECRET = SECRET;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
  await seedDemoUsers(getUserStore(), TEST_PASSWORD);
});

afterEach(async () => {
  delete process.env.AUTH_MODE;
  delete process.env.AUTH_SESSION_SECRET;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

// ── Helpers ────────────────────────────────────────────────────────

function buildRequest(opts: {
  url: string;
  method?: string;
  cookie?: string;
  body?: unknown;
}): Request {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;
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

function extractCookie(res: Response, name: string): string | null {
  // Next's NextResponse.cookies.set emits one Set-Cookie per call;
  // headers.get("set-cookie") returns the FIRST one. We need to find
  // ours by name — use getSetCookie if available, fall back to a
  // simple split (Node 18.16+ has getSetCookie on Headers).
  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const raw = headers.getSetCookie?.() ?? [];
  const flat = raw.length === 0 ? [res.headers.get("set-cookie") ?? ""] : raw;
  for (const line of flat) {
    if (line.startsWith(`${name}=`)) return line;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/login (signed_cookie mode)", () => {
  it("valid credentials → 200 with actor + Set-Cookie containing the signed token", async () => {
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.park@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ actor: { id: string }; source: string }>(res);
    expect(body.actor.id).toBe(PARK.id);
    expect(body.source).toBe("signed_cookie");
    const setCookie = extractCookie(res, "contractops_session");
    expect(setCookie).not.toBeNull();
    expect(setCookie!).toMatch(/contractops_session=[^.]+\.[^;]+/); // token has the .signature
    expect(setCookie!.toLowerCase()).toContain("httponly");
    expect(setCookie!.toLowerCase()).toContain("samesite=lax");
  });

  it("email lookup is case-insensitive", async () => {
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "LAWYER.PARK@Example.Test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("unknown email → 401 INVALID_CREDENTIALS (generic)", async () => {
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "nobody@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ code: string; error: string }>(res);
    expect(body.code).toBe("INVALID_CREDENTIALS");
    expect(body.error).toBe("invalid email or password");
  });

  it("wrong password → 401 INVALID_CREDENTIALS (same generic error)", async () => {
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.park@example.test", password: "wrong" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  it("disabled user → 401 INVALID_CREDENTIALS (same generic error, no leak)", async () => {
    await getUserStore().setDisabled("lawyer_kim", "2026-01-01T00:00:00.000Z");
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.kim@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(401);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "INVALID_CREDENTIALS",
    );
  });

  it("missing email/password → 400 BAD_CREDENTIALS", async () => {
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.park@example.test" },
      }),
    );
    expect(res.status).toBe(400);
    expect((await readJson<{ code: string }>(res)).code).toBe("BAD_CREDENTIALS");
  });

  it("AUTH_MODE=demo → 400 AUTH_MODE_MISMATCH", async () => {
    process.env.AUTH_MODE = "demo";
    delete process.env.AUTH_SESSION_SECRET;
    __resetAuthConfigForTests();
    __resetAuthSessionResolverForTests();
    const res = await authLoginPOST(
      buildRequest({
        url: "http://x/api/auth/login",
        method: "POST",
        body: { email: "lawyer.park@example.test", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(400);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "AUTH_MODE_MISMATCH",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/logout", () => {
  it("clears both contractops_session and contractops_demo_actor", async () => {
    const res = await authLogoutPOST(
      buildRequest({ url: "http://x/api/auth/logout", method: "POST" }),
    );
    expect(res.status).toBe(200);
    const signedClear = extractCookie(res, "contractops_session");
    expect(signedClear).not.toBeNull();
    expect(signedClear!.toLowerCase()).toMatch(/max-age=0/);
    const demoClear = extractCookie(res, "contractops_demo_actor");
    expect(demoClear).not.toBeNull();
    expect(demoClear!.toLowerCase()).toMatch(/max-age=0/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/session in signed_cookie mode
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/auth/session (signed_cookie mode)", () => {
  it("no cookie → 200 anonymous (authenticated:false, actor:null)", async () => {
    const res = await authSessionGET(
      buildRequest({ url: "http://x/api/auth/session" }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      auth_mode: string;
      authenticated: boolean;
      actor: unknown;
    }>(res);
    expect(body.auth_mode).toBe("signed_cookie");
    expect(body.authenticated).toBe(false);
    expect(body.actor).toBeNull();
  });

  it("valid cookie → 200 authenticated with the signed-in user as actor", async () => {
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: sessionCookieFor(PARK.id),
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      authenticated: boolean;
      actor: { id: string };
      source: string;
    }>(res);
    expect(body.authenticated).toBe(true);
    expect(body.actor.id).toBe(PARK.id);
    expect(body.source).toBe("signed_cookie");
  });

  it("expired cookie → 401 INVALID_SESSION + Set-Cookie clear", async () => {
    const res = await authSessionGET(
      buildRequest({
        url: "http://x/api/auth/session",
        cookie: sessionCookieFor(PARK.id, -1), // already expired
      }),
    );
    expect(res.status).toBe(401);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "INVALID_SESSION",
    );
    const cleared = extractCookie(res, "contractops_session");
    expect(cleared!.toLowerCase()).toMatch(/max-age=0/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Demo actor route hardening
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/demo/actor (hardened in signed_cookie mode)", () => {
  it("returns 403 DEMO_AUTH_DISABLED when demoEnabled=false", async () => {
    // beforeEach sets AUTH_MODE=signed_cookie which defaults DEMO_AUTH_ENABLED=false.
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: { actor_id: KIM.id },
      }),
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "DEMO_AUTH_DISABLED",
    );
  });

  it("opens up when DEMO_AUTH_ENABLED=true is explicitly set (dev override)", async () => {
    process.env.DEMO_AUTH_ENABLED = "true";
    __resetAuthConfigForTests();
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: { actor_id: KIM.id },
      }),
    );
    expect(res.status).toBe(200);
    delete process.env.DEMO_AUTH_ENABLED;
  });
});

// ─────────────────────────────────────────────────────────────────────
// /api/projects/[id]/operations in signed_cookie mode
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/projects/[id]/operations (signed_cookie mode)", () => {
  it("body.actor_id still rejected with 400 OPERATION_ACTOR_ID_FORBIDDEN", async () => {
    const { state } = await createProjectInStore("signed-mode-reject", KIM);
    const projectId = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${projectId}/operations`,
        method: "POST",
        cookie: sessionCookieFor(CHOI.id),
        body: {
          name: "add_source",
          args: {
            file_name: "p.pdf",
            source_type: "proposal",
            version: "1",
            incorporated: true,
            source_priority: 1,
          },
          actor_id: KIM.id, // impersonation attempt
        },
      }),
      { params: { id: projectId } },
    );
    expect(res.status).toBe(400);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "OPERATION_ACTOR_ID_FORBIDDEN",
    );
  });

  it("no cookie → 401 INVALID_SESSION (no demo default in signed_cookie mode)", async () => {
    const { state } = await createProjectInStore("no-cookie", KIM);
    const projectId = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${projectId}/operations`,
        method: "POST",
        body: { name: "lock_source_pack", args: {} },
      }),
      { params: { id: projectId } },
    );
    expect(res.status).toBe(401);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "INVALID_SESSION",
    );
  });

  it("signed-in business_choi → approve_deal_memo refused (422 OPERATION_REJECTED, /lawyer/)", async () => {
    const { state } = await createProjectInStore("choi-blocked", KIM);
    const id = state.project.id;
    const walk = async (cookie: string, body: unknown) =>
      operationsPOST(
        buildRequest({
          url: `http://x/api/projects/${id}/operations`,
          method: "POST",
          cookie,
          body,
        }),
        { params: { id } },
      );

    const kimCookie = sessionCookieFor(KIM.id);
    await walk(kimCookie, {
      name: "add_source",
      args: {
        file_name: "p.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
      },
    });
    await walk(kimCookie, { name: "lock_source_pack", args: {} });
    await walk(kimCookie, {
      name: "classify_and_confirm",
      args: { confirmed_type: "NDA" },
    });
    await walk(kimCookie, { name: "select_playbook", args: {} });
    // Pull intake question list via direct state read.
    const { GET: projectGET } = await import("../app/api/projects/[id]/route");
    const stateRes = await projectGET(
      buildRequest({ url: `http://x/api/projects/${id}`, cookie: kimCookie }),
      { params: { id } },
    );
    const stateBody = (await stateRes.json()) as {
      state: { intake_questions: { id: string; required: boolean; key: string }[] };
    };
    for (const q of stateBody.state.intake_questions.filter((q) => q.required)) {
      await walk(kimCookie, {
        name: "answer_intake",
        args: { question_id: q.id, value: `a-${q.key}` },
      });
    }
    await walk(kimCookie, { name: "draft_deal_memo", args: {} });

    // Switch to a signed business_choi session → server-side role guard fires.
    const refused = await walk(sessionCookieFor(CHOI.id), {
      name: "approve_deal_memo",
      args: {},
    });
    expect(refused.status).toBe(422);
    const refusedBody = await readJson<{ code: string; error: string }>(refused);
    expect(refusedBody.code).toBe("OPERATION_REJECTED");
    expect(refusedBody.error.toLowerCase()).toMatch(/lawyer/);

    // Signed-in lawyer_park succeeds; AuditLog records park.
    const ok = await walk(sessionCookieFor(PARK.id), {
      name: "approve_deal_memo",
      args: {},
    });
    expect(ok.status).toBe(200);
    const okBody = await readJson<{
      audits: { event_type: string; actor: string }[];
    }>(ok);
    const approval = okBody.audits.find(
      (a) => a.event_type === "deal_memo_approved",
    );
    expect(approval!.actor).toBe(PARK.id);
  });
});
