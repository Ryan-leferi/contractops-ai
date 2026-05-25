/**
 * Auth + project route integration tests (Milestone 3I).
 *
 * Imports the route handlers directly (App Router route exports are
 * just async functions) and calls them with standard `Request`
 * objects. No Next.js dev server required.
 *
 * Covers:
 *   - GET /api/auth/session  — defaults / cookie / invalid cookie
 *   - POST /api/auth/demo/actor   — set, validate, reject unknown
 *   - DELETE /api/auth/demo/actor — clear cookie
 *   - POST /api/projects                — body.actor_id rejected,
 *                                          cookie actor stamped
 *   - POST /api/projects/[id]/operations — body.actor_id rejected,
 *                                          cookie actor enforced
 *                                          (business_choi blocked)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as authSessionGET } from "../app/api/auth/session/route";
import {
  POST as authDemoActorPOST,
  DELETE as authDemoActorDELETE,
} from "../app/api/auth/demo/actor/route";
import { POST as projectsPOST } from "../app/api/projects/route";
import { POST as operationsPOST } from "../app/api/projects/[id]/operations/route";

import { resetStore, createProjectInStore } from "../lib/server-store";
import { __resetAuthSessionResolverForTests } from "../lib/auth";
import { __resetPersistenceAdapterCacheForTests } from "../lib/persistence";
import { DEMO_ACTOR_REGISTRY } from "../lib/demo-actors";

const KIM = DEMO_ACTOR_REGISTRY.lawyer_kim;
const PARK = DEMO_ACTOR_REGISTRY.lawyer_park;
const CHOI = DEMO_ACTOR_REGISTRY.business_choi;

beforeEach(async () => {
  __resetAuthSessionResolverForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

afterEach(async () => {
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

function cookieFor(actorId: string): string {
  return `contractops_demo_actor=${actorId}`;
}

async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─────────────────────────────────────────────────────────────────────
// GET /api/auth/session
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/auth/session", () => {
  it("defaults to lawyer_kim with source=demo_default when no cookie", async () => {
    const res = await authSessionGET(buildRequest({ url: "http://x/api/auth/session" }));
    expect(res.status).toBe(200);
    const body = await readJson<{
      actor: { id: string; role: string };
      source: string;
    }>(res);
    expect(body.actor.id).toBe(KIM.id);
    expect(body.source).toBe("demo_default");
  });

  it("returns the cookie actor with source=demo_cookie", async () => {
    const res = await authSessionGET(
      buildRequest({ url: "http://x/api/auth/session", cookie: cookieFor(PARK.id) }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ actor: { id: string }; source: string }>(res);
    expect(body.actor.id).toBe(PARK.id);
    expect(body.source).toBe("demo_cookie");
  });

  it("returns 401 + clears the cookie for an invalid actor cookie", async () => {
    const res = await authSessionGET(
      buildRequest({ url: "http://x/api/auth/session", cookie: cookieFor("hacker_x") }),
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("INVALID_SESSION");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/contractops_demo_actor=/);
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/auth/demo/actor
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/auth/demo/actor", () => {
  it("accepts a known actor_id and sets the cookie", async () => {
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: { actor_id: PARK.id },
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ actor: { id: string }; source: string }>(res);
    expect(body.actor.id).toBe(PARK.id);
    expect(body.source).toBe("demo_cookie");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/contractops_demo_actor=lawyer_park/);
    expect(setCookie.toLowerCase()).toMatch(/path=\//);
  });

  it("rejects an unknown actor_id with UNKNOWN_ACTOR (400)", async () => {
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: { actor_id: "hacker_x" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("UNKNOWN_ACTOR");
  });

  it("rejects a missing actor_id with BAD_ACTOR_ID (400)", async () => {
    const res = await authDemoActorPOST(
      buildRequest({
        url: "http://x/api/auth/demo/actor",
        method: "POST",
        body: {},
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("BAD_ACTOR_ID");
  });
});

describe("DELETE /api/auth/demo/actor", () => {
  it("clears the cookie and returns the demo default", async () => {
    const res = await authDemoActorDELETE();
    expect(res.status).toBe(200);
    const body = await readJson<{ actor: { id: string }; source: string }>(res);
    expect(body.actor.id).toBe(KIM.id);
    expect(body.source).toBe("demo_default");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/contractops_demo_actor=/);
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/projects — session actor, body.actor_id rejected
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/projects (create) — session actor", () => {
  it("uses the session actor when no body.actor_id is provided", async () => {
    const res = await projectsPOST(
      buildRequest({
        url: "http://x/api/projects",
        method: "POST",
        cookie: cookieFor(PARK.id),
        body: { name: "park-project" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      state: { project: { name: string } };
      audits: { event_type: string; actor: string }[];
    }>(res);
    expect(body.state.project.name).toBe("park-project");
    const created = body.audits.find((a) => a.event_type === "project_created");
    expect(created!.actor).toBe(PARK.id);
  });

  it("falls back to lawyer_kim when no cookie is present", async () => {
    const res = await projectsPOST(
      buildRequest({
        url: "http://x/api/projects",
        method: "POST",
        body: { name: "no-cookie-project" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      audits: { event_type: string; actor: string }[];
    }>(res);
    const created = body.audits.find((a) => a.event_type === "project_created");
    expect(created!.actor).toBe(KIM.id);
  });

  it("REJECTS body.actor_id with OPERATION_ACTOR_ID_FORBIDDEN (400)", async () => {
    const res = await projectsPOST(
      buildRequest({
        url: "http://x/api/projects",
        method: "POST",
        cookie: cookieFor(CHOI.id),
        body: { name: "impersonation-attempt", actor_id: KIM.id },
      }),
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("OPERATION_ACTOR_ID_FORBIDDEN");
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/projects/[id]/operations — session actor, body.actor_id rejected
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/projects/[id]/operations — session actor", () => {
  it("REJECTS body.actor_id with OPERATION_ACTOR_ID_FORBIDDEN (400)", async () => {
    const { state } = await createProjectInStore("reject-body-actor", KIM);
    const projectId = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${projectId}/operations`,
        method: "POST",
        cookie: cookieFor(CHOI.id),
        body: {
          name: "add_source",
          args: {
            file_name: "p.pdf",
            source_type: "proposal",
            version: "1",
            incorporated: true,
            source_priority: 1,
          },
          actor_id: KIM.id, // ← impersonation attempt
        },
      }),
      { params: { id: projectId } },
    );
    expect(res.status).toBe(400);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("OPERATION_ACTOR_ID_FORBIDDEN");
  });

  it("uses the session actor; AuditLog records that actor (not the body)", async () => {
    const { state } = await createProjectInStore("session-actor-audit", KIM);
    const projectId = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${projectId}/operations`,
        method: "POST",
        cookie: cookieFor(PARK.id),
        body: {
          name: "add_source",
          args: {
            file_name: "p.pdf",
            source_type: "proposal",
            version: "1",
            incorporated: true,
            source_priority: 1,
          },
        },
      }),
      { params: { id: projectId } },
    );
    expect(res.status).toBe(200);
    const body = await readJson<{
      audits: { event_type: string; actor: string }[];
    }>(res);
    const sourceAdded = body.audits.find((a) => a.event_type === "source_uploaded");
    expect(sourceAdded).toBeDefined();
    expect(sourceAdded!.actor).toBe(PARK.id);
  });

  it("rejects an invalid session cookie with 401 + clears the cookie", async () => {
    const { state } = await createProjectInStore("bad-cookie", KIM);
    const projectId = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${projectId}/operations`,
        method: "POST",
        cookie: cookieFor("hacker_x"),
        body: { name: "lock_source_pack", args: {} },
      }),
      { params: { id: projectId } },
    );
    expect(res.status).toBe(401);
    const body = await readJson<{ code: string }>(res);
    expect(body.code).toBe("INVALID_SESSION");
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toMatch(/max-age=0/);
  });

  it("business_choi cookie → approve_deal_memo refused (422 OPERATION_REJECTED)", async () => {
    // Walk a project up to deal_memo_drafted as Kim so the role guard
    // is reachable when business_choi attempts to approve.
    const { state } = await createProjectInStore("choi-cannot-approve", KIM);
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

    const kimCookie = cookieFor(KIM.id);
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
    // Answer required intake as Kim.
    const { GET: projectGET } = await import(
      "../app/api/projects/[id]/route"
    );
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

    // Switch to business_choi via the cookie and try to approve.
    const refused = await walk(cookieFor(CHOI.id), {
      name: "approve_deal_memo",
      args: {},
    });
    expect(refused.status).toBe(422);
    const refusedBody = await readJson<{ code: string; error: string }>(refused);
    expect(refusedBody.code).toBe("OPERATION_REJECTED");
    expect(refusedBody.error.toLowerCase()).toMatch(/lawyer/);

    // And lawyer_park's cookie succeeds where Choi failed.
    const ok = await walk(cookieFor(PARK.id), {
      name: "approve_deal_memo",
      args: {},
    });
    expect(ok.status).toBe(200);
    const okBody = await readJson<{
      audits: { event_type: string; actor: string }[];
    }>(ok);
    const approval = okBody.audits.find((a) => a.event_type === "deal_memo_approved");
    expect(approval!.actor).toBe(PARK.id);
  });
});
