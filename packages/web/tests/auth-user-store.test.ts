/**
 * User store + signed-cookie auth tests (Milestone 3J).
 *
 * Asserts:
 *   - MemoryUserStore CRUD + uniqueness + disabled flag;
 *   - seedDemoUsers is idempotent and uses real hashed passwords;
 *   - actorFromUser projects an AuthUser into a valid Actor;
 *   - SignedCookieAuthProvider accepts a freshly minted cookie;
 *   - SignedCookieAuthProvider rejects:
 *       missing cookie       → InvalidSessionError (resolveActor)
 *       tampered cookie      → InvalidSessionError
 *       expired cookie       → InvalidSessionError
 *       unknown user_id      → InvalidSessionError
 *       disabled user        → InvalidSessionError
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InvalidSessionError,
  MemoryUserStore,
  SEED_USERS,
  SignedCookieAuthProvider,
  UserAlreadyExistsError,
  __resetAuthConfigForTests,
  __resetAuthSessionResolverForTests,
  __resetUserStoreForTests,
  actorFromUser,
  createSessionToken,
  getUserStore,
  hashPassword,
  seedDemoUsers,
  verifyUserPasswordById,
} from "../lib/auth";

const SECRET = "this-is-a-32-char-test-secret-aaa";
const NOW_SEC = () => Math.floor(Date.now() / 1000);

function requestWith(cookie: string | null): Request {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers["cookie"] = cookie;
  return new Request("http://localhost/test", { headers });
}

function cookieFor(token: string): string {
  return `contractops_session=${token}`;
}

beforeEach(() => {
  process.env.AUTH_MODE = "signed_cookie";
  process.env.AUTH_SESSION_SECRET = SECRET;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
});

afterEach(() => {
  delete process.env.AUTH_MODE;
  delete process.env.AUTH_SESSION_SECRET;
  __resetAuthConfigForTests();
  __resetAuthSessionResolverForTests();
  __resetUserStoreForTests();
});

// ─────────────────────────────────────────────────────────────────────
// MemoryUserStore
// ─────────────────────────────────────────────────────────────────────

describe("MemoryUserStore", () => {
  it("createUser + getUserById + getUserByEmail (case-insensitive email)", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("demo-password");
    const u = await store.createUser({
      id: "lawyer_kim",
      email: "Lawyer.Kim@Example.Test",
      display_name: "Kim",
      role: "human_lawyer",
      password_hash: hash,
    });
    expect(u.email).toBe("lawyer.kim@example.test"); // lowercased
    expect(await store.getUserById("lawyer_kim")).toEqual(u);
    expect(await store.getUserByEmail("LAWYER.KIM@example.test")).toEqual(u);
    expect(await store.getUserByEmail("missing@example.test")).toBeNull();
  });

  it("createUser rejects duplicate id", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("demo-password");
    const base = {
      id: "lawyer_kim",
      display_name: "Kim",
      role: "human_lawyer" as const,
      password_hash: hash,
    };
    await store.createUser({ ...base, email: "a@example.test" });
    await expect(
      store.createUser({ ...base, email: "b@example.test" }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
  });

  it("createUser rejects duplicate email (case-insensitive)", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("demo-password");
    await store.createUser({
      id: "lawyer_kim",
      email: "shared@example.test",
      display_name: "Kim",
      role: "human_lawyer",
      password_hash: hash,
    });
    await expect(
      store.createUser({
        id: "lawyer_park",
        email: "Shared@Example.Test",
        display_name: "Park",
        role: "human_lawyer",
        password_hash: hash,
      }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
  });

  it("setDisabled flips the disabled_at flag both ways", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("demo-password");
    await store.createUser({
      id: "u1",
      email: "u1@example.test",
      display_name: "u1",
      role: "user",
      password_hash: hash,
    });
    await store.setDisabled("u1", "2026-01-01T00:00:00.000Z");
    expect((await store.getUserById("u1"))!.disabled_at).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    await store.setDisabled("u1", null);
    expect((await store.getUserById("u1"))!.disabled_at).toBeNull();
  });

  it("listUsers returns in created_at order", async () => {
    const store = new MemoryUserStore();
    const hash = await hashPassword("demo-password");
    await store.createUser({
      id: "first",
      email: "1@example.test",
      display_name: "1",
      role: "user",
      password_hash: hash,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await store.createUser({
      id: "second",
      email: "2@example.test",
      display_name: "2",
      role: "user",
      password_hash: hash,
      created_at: "2026-01-02T00:00:00.000Z",
    });
    expect((await store.listUsers()).map((u) => u.id)).toEqual([
      "first",
      "second",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// seedDemoUsers + verifyUserPasswordById
// ─────────────────────────────────────────────────────────────────────

describe("seedDemoUsers", () => {
  it("seeds all three sanitized users with the same hash", async () => {
    const store = new MemoryUserStore();
    await seedDemoUsers(store, "demo-password");
    const users = await store.listUsers();
    expect(users.map((u) => u.id).sort()).toEqual(
      [...SEED_USERS.map((u) => u.id)].sort(),
    );
    for (const u of users) {
      expect(u.password_hash).not.toBe("demo-password");
      expect(u.password_hash.startsWith("pbkdf2-sha256-v1$")).toBe(true);
    }
  });

  it("is idempotent — re-running does not overwrite or duplicate", async () => {
    const store = new MemoryUserStore();
    await seedDemoUsers(store, "demo-password");
    const beforeHashes = (await store.listUsers()).map((u) => u.password_hash);
    await seedDemoUsers(store, "different-password");
    const afterHashes = (await store.listUsers()).map((u) => u.password_hash);
    expect(afterHashes).toEqual(beforeHashes);
    // Original password still verifies; the new one does NOT.
    const verified = await verifyUserPasswordById(store, "lawyer_kim", "demo-password");
    expect(verified).not.toBeNull();
    const wrong = await verifyUserPasswordById(store, "lawyer_kim", "different-password");
    expect(wrong).toBeNull();
  });

  it("verifyUserPasswordById returns null for missing / disabled / wrong-password", async () => {
    const store = new MemoryUserStore();
    await seedDemoUsers(store, "demo-password");
    // missing
    expect(await verifyUserPasswordById(store, "nobody", "demo-password")).toBeNull();
    // wrong password
    expect(await verifyUserPasswordById(store, "lawyer_kim", "wrong")).toBeNull();
    // disabled
    await store.setDisabled("lawyer_kim", "2026-01-01T00:00:00.000Z");
    expect(await verifyUserPasswordById(store, "lawyer_kim", "demo-password")).toBeNull();
  });
});

describe("actorFromUser", () => {
  it("projects an AuthUser into the Actor shape", async () => {
    const store = new MemoryUserStore();
    await seedDemoUsers(store, "demo-password");
    const u = (await store.getUserById("lawyer_park"))!;
    const a = actorFromUser(u);
    expect(a.id).toBe("lawyer_park");
    expect(a.role).toBe("human_lawyer");
    expect(a.display_name).toContain("Park");
  });
});

// ─────────────────────────────────────────────────────────────────────
// SignedCookieAuthProvider
// ─────────────────────────────────────────────────────────────────────

describe("SignedCookieAuthProvider", () => {
  it("resolveSession returns null when no cookie present", async () => {
    await seedDemoUsers(getUserStore(), "demo-password");
    const p = new SignedCookieAuthProvider();
    expect(await p.resolveSession(requestWith(null))).toBeNull();
  });

  it("resolveActor throws InvalidSessionError when no cookie present (no default)", async () => {
    await seedDemoUsers(getUserStore(), "demo-password");
    const p = new SignedCookieAuthProvider();
    await expect(p.resolveActor(requestWith(null))).rejects.toBeInstanceOf(
      InvalidSessionError,
    );
  });

  it("returns the actor for a valid signed cookie (source=signed_cookie)", async () => {
    await seedDemoUsers(getUserStore(), "demo-password");
    const now = NOW_SEC();
    const token = createSessionToken(
      { user_id: "lawyer_park", issued_at: now, expires_at: now + 60 },
      SECRET,
    );
    const sess = await new SignedCookieAuthProvider().resolveSession(
      requestWith(cookieFor(token)),
    );
    expect(sess!.actor.id).toBe("lawyer_park");
    expect(sess!.actor.role).toBe("human_lawyer");
    expect(sess!.source).toBe("signed_cookie");
  });

  it("rejects a tampered cookie", async () => {
    await seedDemoUsers(getUserStore(), "demo-password");
    const now = NOW_SEC();
    const token = createSessionToken(
      { user_id: "lawyer_kim", issued_at: now, expires_at: now + 60 },
      SECRET,
    );
    // Flip the FIRST char of the signature half. (Flipping the last
    // char of a base64url signature can leave the decoded bytes
    // unchanged because the trailing 2–4 bits of an unpadded chunk
    // are insignificant.)
    const dot = token.indexOf(".");
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const sigFirst = sig.charAt(0);
    const flipped = sigFirst === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${sig.slice(1)}`;
    await expect(
      new SignedCookieAuthProvider().resolveSession(requestWith(cookieFor(tampered))),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it("rejects an expired cookie", async () => {
    await seedDemoUsers(getUserStore(), "demo-password");
    const now = NOW_SEC();
    const token = createSessionToken(
      { user_id: "lawyer_kim", issued_at: now - 120, expires_at: now - 60 },
      SECRET,
    );
    await expect(
      new SignedCookieAuthProvider().resolveSession(requestWith(cookieFor(token))),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it("rejects a cookie referencing a missing user_id", async () => {
    await seedDemoUsers(getUserStore(), "demo-password");
    const now = NOW_SEC();
    const token = createSessionToken(
      { user_id: "ghost_user", issued_at: now, expires_at: now + 60 },
      SECRET,
    );
    await expect(
      new SignedCookieAuthProvider().resolveSession(requestWith(cookieFor(token))),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });

  it("rejects a cookie for a disabled user", async () => {
    const store = getUserStore();
    await seedDemoUsers(store, "demo-password");
    await store.setDisabled("lawyer_kim", "2026-01-01T00:00:00.000Z");
    const now = NOW_SEC();
    const token = createSessionToken(
      { user_id: "lawyer_kim", issued_at: now, expires_at: now + 60 },
      SECRET,
    );
    await expect(
      new SignedCookieAuthProvider().resolveSession(requestWith(cookieFor(token))),
    ).rejects.toBeInstanceOf(InvalidSessionError);
  });
});
