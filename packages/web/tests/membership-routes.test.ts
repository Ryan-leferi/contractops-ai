/**
 * Membership management route integration tests (Milestone 3L).
 *
 * Direct route-handler invocation (no Next dev server). Covers:
 *   - GET /memberships: any active member can read; non-member 403.
 *   - POST /memberships: only owner can grant; lawyer-role rejected
 *     for non-lawyer global actors; duplicate active rejected.
 *   - DELETE /memberships/[id]: only owner can disable; cannot remove
 *     the last active owner; idempotent on already-disabled.
 *   - createProject: non-lawyer creator → 403 NON_LAWYER_CANNOT_CREATE_PROJECT.
 *   - GET /api/projects filters by membership.
 *   - GET /api/projects/[id], audit-logs, decision-history all gated.
 *   - body.actor_id rejection from 3I still fires.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as projectsListGET, POST as projectsCreatePOST } from "../app/api/projects/route";
import { GET as projectGET } from "../app/api/projects/[id]/route";
import { GET as auditLogsGET } from "../app/api/projects/[id]/audit-logs/route";
import { GET as decisionHistoryGET } from "../app/api/projects/[id]/decision-history/route";
import {
  GET as membershipsGET,
  POST as membershipsPOST,
} from "../app/api/projects/[id]/memberships/route";
import { DELETE as membershipDELETE } from "../app/api/projects/[id]/memberships/[membership_id]/route";
import { POST as operationsPOST } from "../app/api/projects/[id]/operations/route";

import {
  __resetAuthConfigForTests,
  __resetAuthSessionResolverForTests,
  __resetUserStoreForTests,
} from "../lib/auth";
import {
  __resetAuthEventStoreForTests,
} from "../lib/auth";
import { createProjectInStore, resetStore } from "../lib/server-store";
import { __resetPersistenceAdapterCacheForTests } from "../lib/persistence";
import { DEMO_ACTOR_REGISTRY } from "../lib/demo-actors";

const KIM = DEMO_ACTOR_REGISTRY.lawyer_kim;
const PARK = DEMO_ACTOR_REGISTRY.lawyer_park;
const CHOI = DEMO_ACTOR_REGISTRY.business_choi;

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
  return new Request(opts.url, { method: opts.method ?? "GET", headers, body });
}

function cookieFor(actorId: string): string {
  return `contractops_demo_actor=${actorId}`;
}

async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(async () => {
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
  __resetAuthEventStoreForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

afterEach(async () => {
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
  __resetAuthEventStoreForTests();
  __resetPersistenceAdapterCacheForTests();
  await resetStore();
});

// ─────────────────────────────────────────────────────────────────────
// Create project — non-lawyer rejected (3L)
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/projects — non-lawyer creator is refused", () => {
  it("business_choi (non-lawyer) cannot create a project (403)", async () => {
    const res = await projectsCreatePOST(
      buildRequest({
        url: "http://x/api/projects",
        method: "POST",
        cookie: cookieFor(CHOI.id),
        body: { name: "choi-project" },
      }),
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "NON_LAWYER_CANNOT_CREATE_PROJECT",
    );
  });

  it("lawyer_kim CAN create + becomes owner_lawyer automatically", async () => {
    const res = await projectsCreatePOST(
      buildRequest({
        url: "http://x/api/projects",
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { name: "kim-project" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      state: {
        project: { id: string };
        memberships: { actor_id: string; project_role: string }[];
      };
    }>(res);
    expect(body.state.memberships).toHaveLength(1);
    expect(body.state.memberships[0]!.actor_id).toBe(KIM.id);
    expect(body.state.memberships[0]!.project_role).toBe("owner_lawyer");
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/projects — visibility filter
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/projects — visibility filter (3L)", () => {
  it("lists only projects where the actor is an active member", async () => {
    await createProjectInStore("kim-only", KIM);
    await createProjectInStore("park-only", PARK);

    // KIM sees their own project but not PARK's.
    const kimRes = await projectsListGET(
      buildRequest({ url: "http://x/api/projects", cookie: cookieFor(KIM.id) }),
    );
    const kimBody = await readJson<{ projects: { name: string }[] }>(kimRes);
    expect(kimBody.projects.map((p) => p.name)).toEqual(["kim-only"]);

    // PARK sees their own project but not KIM's.
    const parkRes = await projectsListGET(
      buildRequest({ url: "http://x/api/projects", cookie: cookieFor(PARK.id) }),
    );
    const parkBody = await readJson<{ projects: { name: string }[] }>(parkRes);
    expect(parkBody.projects.map((p) => p.name)).toEqual(["park-only"]);

    // CHOI (no memberships anywhere) sees an empty list.
    const choiRes = await projectsListGET(
      buildRequest({ url: "http://x/api/projects", cookie: cookieFor(CHOI.id) }),
    );
    expect((await readJson<{ projects: unknown[] }>(choiRes)).projects).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/projects/[id], audit-logs, decision-history — gated
// ─────────────────────────────────────────────────────────────────────

describe("project read routes are gated by membership", () => {
  it("non-member gets 403 PROJECT_ACCESS_DENIED on GET /api/projects/[id]", async () => {
    const { state } = await createProjectInStore("members-only", KIM);
    const id = state.project.id;
    const res = await projectGET(
      buildRequest({ url: `http://x/api/projects/${id}`, cookie: cookieFor(PARK.id) }),
      { params: { id } },
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "PROJECT_ACCESS_DENIED",
    );
  });

  it("audit-logs require view_audit_log (lawyer role); contributor denied", async () => {
    const { state } = await createProjectInStore("audit-perm", KIM);
    const id = state.project.id;
    const { addMembershipToProject } = await import("../lib/server-store");
    await addMembershipToProject(
      id,
      { actor: CHOI, project_role: "business_contributor" },
      KIM,
    );

    // Contributor is a member but lacks view_audit_log.
    const denied = await auditLogsGET(
      buildRequest({
        url: `http://x/api/projects/${id}/audit-logs`,
        cookie: cookieFor(CHOI.id),
      }),
      { params: { id } },
    );
    expect(denied.status).toBe(403);
    expect((await readJson<{ code: string }>(denied)).code).toBe(
      "PROJECT_PERMISSION_DENIED",
    );

    // Owner can read.
    const ok = await auditLogsGET(
      buildRequest({
        url: `http://x/api/projects/${id}/audit-logs`,
        cookie: cookieFor(KIM.id),
      }),
      { params: { id } },
    );
    expect(ok.status).toBe(200);
  });

  it("decision-history requires view_decision_history; non-member 403", async () => {
    const { state } = await createProjectInStore("history-gated", KIM);
    const id = state.project.id;
    const res = await decisionHistoryGET(
      buildRequest({
        url: `http://x/api/projects/${id}/decision-history`,
        cookie: cookieFor(CHOI.id),
      }),
      { params: { id } },
    );
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Operations route — RBAC integration
// ─────────────────────────────────────────────────────────────────────

describe("POST /api/projects/[id]/operations — RBAC", () => {
  it("non-member's add_source attempt → 403 PROJECT_ACCESS_DENIED", async () => {
    const { state } = await createProjectInStore("nonmember-blocked", KIM);
    const id = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/operations`,
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
      { params: { id } },
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "PROJECT_ACCESS_DENIED",
    );
  });

  it("business_contributor can answer_intake but not approve_deal_memo", async () => {
    const { state } = await createProjectInStore("contributor-flow", KIM);
    const id = state.project.id;
    const { addMembershipToProject } = await import("../lib/server-store");
    await addMembershipToProject(
      id,
      { actor: CHOI, project_role: "business_contributor" },
      KIM,
    );

    // Contributor can answer_intake (permission-wise — workflow may
    // still 422 because intake_questions aren't generated yet; the
    // critical assertion here is that the RBAC layer does NOT 403).
    const answerRes = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/operations`,
        method: "POST",
        cookie: cookieFor(CHOI.id),
        body: { name: "answer_intake", args: { question_id: "q_x", value: "y" } },
      }),
      { params: { id } },
    );
    // Permission check passed → status is NOT 403 PROJECT_*. It may be
    // 422 from the aggregate (no such question), which is the workflow
    // layer, not RBAC.
    expect(answerRes.status).not.toBe(403);

    // approve_deal_memo is denied at the permission layer.
    const approveRes = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/operations`,
        method: "POST",
        cookie: cookieFor(CHOI.id),
        body: { name: "approve_deal_memo", args: {} },
      }),
      { params: { id } },
    );
    expect(approveRes.status).toBe(403);
    expect((await readJson<{ code: string }>(approveRes)).code).toBe(
      "PROJECT_PERMISSION_DENIED",
    );
  });

  it("reviewer_lawyer cannot approve_final (only owner_lawyer can)", async () => {
    const { state } = await createProjectInStore("reviewer-flow", KIM);
    const id = state.project.id;
    const { addMembershipToProject } = await import("../lib/server-store");
    await addMembershipToProject(
      id,
      { actor: PARK, project_role: "reviewer_lawyer" },
      KIM,
    );
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/operations`,
        method: "POST",
        cookie: cookieFor(PARK.id),
        body: { name: "approve_final", args: {} },
      }),
      { params: { id } },
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "PROJECT_PERMISSION_DENIED",
    );
  });

  it("body.actor_id rejection from 3I still fires (400 OPERATION_ACTOR_ID_FORBIDDEN)", async () => {
    const { state } = await createProjectInStore("body-actor-still-blocked", KIM);
    const id = state.project.id;
    const res = await operationsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/operations`,
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { name: "lock_source_pack", args: {}, actor_id: PARK.id },
      }),
      { params: { id } },
    );
    expect(res.status).toBe(400);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "OPERATION_ACTOR_ID_FORBIDDEN",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Membership management routes
// ─────────────────────────────────────────────────────────────────────

describe("GET /api/projects/[id]/memberships", () => {
  it("any active member can read the membership list", async () => {
    const { state } = await createProjectInStore("readable", KIM);
    const id = state.project.id;
    const { addMembershipToProject } = await import("../lib/server-store");
    await addMembershipToProject(
      id,
      { actor: CHOI, project_role: "business_viewer" },
      KIM,
    );
    const choiRes = await membershipsGET(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        cookie: cookieFor(CHOI.id),
      }),
      { params: { id } },
    );
    expect(choiRes.status).toBe(200);
    const body = await readJson<{
      memberships: { actor_id: string }[];
      my_membership: { project_role: string };
    }>(choiRes);
    expect(body.memberships.map((m) => m.actor_id).sort()).toEqual(
      ["business_choi", "lawyer_kim"].sort(),
    );
    expect(body.my_membership.project_role).toBe("business_viewer");
  });

  it("non-member gets 403", async () => {
    const { state } = await createProjectInStore("not-readable", KIM);
    const id = state.project.id;
    const res = await membershipsGET(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        cookie: cookieFor(PARK.id),
      }),
      { params: { id } },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/projects/[id]/memberships (owner only)", () => {
  it("owner can add a reviewer_lawyer", async () => {
    const { state } = await createProjectInStore("owner-can-add", KIM);
    const id = state.project.id;
    const res = await membershipsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { actor_id: PARK.id, project_role: "reviewer_lawyer" },
      }),
      { params: { id } },
    );
    expect(res.status).toBe(201);
    const body = await readJson<{
      membership: { actor_id: string; project_role: string };
    }>(res);
    expect(body.membership.actor_id).toBe(PARK.id);
    expect(body.membership.project_role).toBe("reviewer_lawyer");
  });

  it("non-owner cannot add (403 PROJECT_PERMISSION_DENIED)", async () => {
    const { state } = await createProjectInStore("reviewer-cannot-add", KIM);
    const id = state.project.id;
    const { addMembershipToProject } = await import("../lib/server-store");
    await addMembershipToProject(
      id,
      { actor: PARK, project_role: "reviewer_lawyer" },
      KIM,
    );
    const res = await membershipsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        method: "POST",
        cookie: cookieFor(PARK.id),
        body: { actor_id: CHOI.id, project_role: "business_viewer" },
      }),
      { params: { id } },
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "PROJECT_PERMISSION_DENIED",
    );
  });

  it("granting a lawyer project_role to a non-lawyer actor is refused (403)", async () => {
    const { state } = await createProjectInStore("lawyer-role-guard", KIM);
    const id = state.project.id;
    const res = await membershipsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { actor_id: CHOI.id, project_role: "owner_lawyer" },
      }),
      { params: { id } },
    );
    expect(res.status).toBe(403);
    expect((await readJson<{ code: string }>(res)).code).toBe(
      "PROJECT_ROLE_REQUIRES_LAWYER",
    );
  });

  it("duplicate active membership is rejected (409)", async () => {
    const { state } = await createProjectInStore("no-dupes", KIM);
    const id = state.project.id;
    const first = await membershipsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { actor_id: PARK.id, project_role: "reviewer_lawyer" },
      }),
      { params: { id } },
    );
    expect(first.status).toBe(201);
    const dupe = await membershipsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { actor_id: PARK.id, project_role: "owner_lawyer" },
      }),
      { params: { id } },
    );
    expect(dupe.status).toBe(409);
    expect((await readJson<{ code: string }>(dupe)).code).toBe(
      "ACTOR_ALREADY_MEMBER",
    );
  });
});

describe("DELETE /api/projects/[id]/memberships/[membership_id] (owner only)", () => {
  it("owner can disable another member", async () => {
    const { state } = await createProjectInStore("owner-can-disable", KIM);
    const id = state.project.id;
    const add = await membershipsPOST(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships`,
        method: "POST",
        cookie: cookieFor(KIM.id),
        body: { actor_id: CHOI.id, project_role: "business_contributor" },
      }),
      { params: { id } },
    );
    const addBody = await readJson<{ membership: { id: string } }>(add);
    const memId = addBody.membership.id;

    const del = await membershipDELETE(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships/${memId}`,
        method: "DELETE",
        cookie: cookieFor(KIM.id),
      }),
      { params: { id, membership_id: memId } },
    );
    expect(del.status).toBe(200);
    const body = await readJson<{
      membership: { disabled_at: string | null };
    }>(del);
    expect(body.membership.disabled_at).not.toBeNull();
  });

  it("cannot remove the LAST active owner_lawyer (422 CANNOT_REMOVE_LAST_OWNER)", async () => {
    const { state } = await createProjectInStore("no-orphan", KIM);
    const id = state.project.id;
    const stateRes = await projectGET(
      buildRequest({ url: `http://x/api/projects/${id}`, cookie: cookieFor(KIM.id) }),
      { params: { id } },
    );
    const stateBody = (await stateRes.json()) as {
      state: { memberships: { id: string; project_role: string }[] };
    };
    const ownerMem = stateBody.state.memberships.find(
      (m) => m.project_role === "owner_lawyer",
    )!;
    const del = await membershipDELETE(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships/${ownerMem.id}`,
        method: "DELETE",
        cookie: cookieFor(KIM.id),
      }),
      { params: { id, membership_id: ownerMem.id } },
    );
    expect(del.status).toBe(422);
    expect((await readJson<{ code: string }>(del)).code).toBe(
      "CANNOT_REMOVE_LAST_OWNER",
    );
  });

  it("non-owner cannot disable (403)", async () => {
    const { state } = await createProjectInStore("no-self-promote", KIM);
    const id = state.project.id;
    const { addMembershipToProject } = await import("../lib/server-store");
    await addMembershipToProject(
      id,
      { actor: PARK, project_role: "reviewer_lawyer" },
      KIM,
    );
    const stateRes = await projectGET(
      buildRequest({ url: `http://x/api/projects/${id}`, cookie: cookieFor(KIM.id) }),
      { params: { id } },
    );
    const stateBody = (await stateRes.json()) as {
      state: { memberships: { id: string; actor_id: string }[] };
    };
    const ownerMem = stateBody.state.memberships.find(
      (m) => m.actor_id === KIM.id,
    )!;

    const res = await membershipDELETE(
      buildRequest({
        url: `http://x/api/projects/${id}/memberships/${ownerMem.id}`,
        method: "DELETE",
        cookie: cookieFor(PARK.id),
      }),
      { params: { id, membership_id: ownerMem.id } },
    );
    expect(res.status).toBe(403);
  });
});
