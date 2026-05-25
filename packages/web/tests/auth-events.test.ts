/**
 * Auth event store + recorder unit tests (Milestone 3K).
 *
 * Pure-function tests of the in-memory store + helper. Asserts:
 *   - append + list returns inserted event;
 *   - list returns insertion order;
 *   - duplicate id throws AuthEventAppendOnlyViolationError;
 *   - count() + clear() basics;
 *   - recordAuthEvent fills id + occurred_at;
 *   - recordAuthEvent REFUSES forbidden metadata keys (password,
 *     token, secret, etc) — defensive guard against route bugs.
 *   - extractRequestContext truncates user-agent + x-forwarded-for;
 *   - normalizeEmailForEvent lowercases + trims.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthEventAppendOnlyViolationError,
  MemoryAuthEventStore,
  __resetAuthEventStoreForTests,
  extractRequestContext,
  getAuthEventStore,
  normalizeEmailForEvent,
  recordAuthEvent,
  type AuthEvent,
} from "../lib/auth";

beforeEach(() => {
  __resetAuthEventStoreForTests();
});

afterEach(() => {
  __resetAuthEventStoreForTests();
});

// ─────────────────────────────────────────────────────────────────────
// MemoryAuthEventStore
// ─────────────────────────────────────────────────────────────────────

function makeEvent(id: string, partial?: Partial<AuthEvent>): AuthEvent {
  return {
    id,
    event_type: "login_success",
    actor_id: "lawyer_kim",
    user_id: "lawyer_kim",
    email: "lawyer.kim@example.test",
    occurred_at: "2026-01-01T00:00:00.000Z",
    request_context: null,
    result: "success",
    reason_code: "OK",
    metadata: {},
    ...partial,
  };
}

describe("MemoryAuthEventStore — append + list", () => {
  it("append + list returns the inserted event", async () => {
    const store = new MemoryAuthEventStore();
    await store.append(makeEvent("ae_1"));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("ae_1");
  });

  it("list returns events in insertion order", async () => {
    const store = new MemoryAuthEventStore();
    await store.append(makeEvent("ae_1"));
    await store.append(makeEvent("ae_2"));
    await store.append(makeEvent("ae_3"));
    expect((await store.list()).map((e) => e.id)).toEqual(["ae_1", "ae_2", "ae_3"]);
  });

  it("count() matches list length", async () => {
    const store = new MemoryAuthEventStore();
    expect(await store.count()).toBe(0);
    await store.append(makeEvent("ae_1"));
    await store.append(makeEvent("ae_2"));
    expect(await store.count()).toBe(2);
  });

  it("clear() drops every event", async () => {
    const store = new MemoryAuthEventStore();
    await store.append(makeEvent("ae_1"));
    await store.clear();
    expect(await store.count()).toBe(0);
    expect(await store.list()).toEqual([]);
  });

  it("duplicate id throws AuthEventAppendOnlyViolationError", async () => {
    const store = new MemoryAuthEventStore();
    await store.append(makeEvent("ae_1"));
    await expect(store.append(makeEvent("ae_1"))).rejects.toBeInstanceOf(
      AuthEventAppendOnlyViolationError,
    );
  });

  it("a failed duplicate append leaves the original event intact", async () => {
    const store = new MemoryAuthEventStore();
    await store.append(makeEvent("ae_1", { reason_code: "first" }));
    await expect(
      store.append(makeEvent("ae_1", { reason_code: "second" })),
    ).rejects.toBeInstanceOf(AuthEventAppendOnlyViolationError);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.reason_code).toBe("first");
  });
});

describe("getAuthEventStore — singleton", () => {
  it("returns the same instance across calls (globalThis cache)", () => {
    const a = getAuthEventStore();
    const b = getAuthEventStore();
    expect(a).toBe(b);
  });

  it("__reset drops the cached instance", () => {
    const a = getAuthEventStore();
    __resetAuthEventStoreForTests();
    const b = getAuthEventStore();
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// recordAuthEvent
// ─────────────────────────────────────────────────────────────────────

describe("recordAuthEvent", () => {
  it("fills id (ae_<uuid>) and occurred_at", async () => {
    await recordAuthEvent({
      event_type: "login_success",
      actor_id: "lawyer_kim",
      user_id: "lawyer_kim",
      email: "lawyer.kim@example.test",
      request_context: null,
      result: "success",
      reason_code: "OK",
    });
    const events = await getAuthEventStore().list();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toMatch(/^ae_[0-9a-f-]{36}$/);
    expect(events[0]!.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("metadata is shallow-cloned (caller mutations don't affect store)", async () => {
    const meta: Record<string, unknown> = { detail: "first" };
    await recordAuthEvent({
      event_type: "login_failed",
      actor_id: null,
      user_id: null,
      email: null,
      request_context: null,
      result: "failure",
      reason_code: "INVALID_CREDENTIALS",
      metadata: meta,
    });
    meta.detail = "mutated-after";
    const stored = (await getAuthEventStore().list())[0]!;
    expect(stored.metadata).toEqual({ detail: "first" });
  });

  it("REFUSES forbidden metadata keys (password, token, secret, …) — silently drops the event", async () => {
    // The recorder is best-effort — forbidden keys throw inside the
    // helper but the catch swallows. End result: NOTHING gets recorded
    // (the route's audit entry is missing, which is preferable to
    // recording a password). A future hardening milestone could
    // route this to a panic / monitoring channel.
    await recordAuthEvent({
      event_type: "login_failed",
      actor_id: null,
      user_id: null,
      email: "x@example.test",
      request_context: null,
      result: "failure",
      reason_code: "INVALID_CREDENTIALS",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: { password: "secret123" } as any,
    });
    expect(await getAuthEventStore().count()).toBe(0);
  });

  it("forbidden-key check is case-insensitive", async () => {
    await recordAuthEvent({
      event_type: "login_failed",
      actor_id: null,
      user_id: null,
      email: null,
      request_context: null,
      result: "failure",
      reason_code: "INVALID_CREDENTIALS",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: { PASSWORD: "secret123" } as any,
    });
    expect(await getAuthEventStore().count()).toBe(0);
  });

  it("each forbidden key is independently rejected", async () => {
    for (const key of [
      "token",
      "session_token",
      "signature",
      "cookie",
      "secret",
      "auth_session_secret",
      "api_key",
      "password_hash",
    ]) {
      __resetAuthEventStoreForTests();
      await recordAuthEvent({
        event_type: "login_failed",
        actor_id: null,
        user_id: null,
        email: null,
        request_context: null,
        result: "failure",
        reason_code: "INVALID_CREDENTIALS",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: { [key]: "blocked" } as any,
      });
      expect(await getAuthEventStore().count()).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// extractRequestContext + normalizeEmailForEvent
// ─────────────────────────────────────────────────────────────────────

describe("extractRequestContext", () => {
  it("returns null when given null", () => {
    expect(extractRequestContext(null)).toBeNull();
  });

  it("extracts user_agent + ip + path + method", () => {
    const req = new Request("http://example.test/api/auth/login", {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 (test)",
        "x-forwarded-for": "203.0.113.1, 10.0.0.1",
      },
    });
    const ctx = extractRequestContext(req)!;
    expect(ctx.user_agent).toBe("Mozilla/5.0 (test)");
    expect(ctx.ip).toBe("203.0.113.1"); // first hop only
    expect(ctx.path).toBe("/api/auth/login");
    expect(ctx.method).toBe("POST");
  });

  it("truncates user-agent at 256 chars", () => {
    const longUa = "A".repeat(500);
    const req = new Request("http://x/", { headers: { "user-agent": longUa } });
    expect(extractRequestContext(req)!.user_agent!.length).toBe(256);
  });

  it("returns null user_agent / ip when headers absent", () => {
    const req = new Request("http://example.test/api/auth/login", { method: "POST" });
    const ctx = extractRequestContext(req)!;
    expect(ctx.user_agent).toBeNull();
    expect(ctx.ip).toBeNull();
  });
});

describe("normalizeEmailForEvent", () => {
  it("lowercases + trims", () => {
    expect(normalizeEmailForEvent("  Lawyer.Kim@Example.Test  ")).toBe(
      "lawyer.kim@example.test",
    );
  });

  it("returns null for non-string / empty", () => {
    expect(normalizeEmailForEvent(undefined)).toBeNull();
    expect(normalizeEmailForEvent(null)).toBeNull();
    expect(normalizeEmailForEvent(123)).toBeNull();
    expect(normalizeEmailForEvent("   ")).toBeNull();
  });

  it("truncates at 320 chars (RFC 5321 max)", () => {
    const huge = `${"a".repeat(400)}@example.test`;
    expect(normalizeEmailForEvent(huge)!.length).toBe(320);
  });
});
