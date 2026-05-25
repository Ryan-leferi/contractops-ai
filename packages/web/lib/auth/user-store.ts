/**
 * Minimal user store (Milestone 3J).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ DEMO-GRADE STORAGE. The default `MemoryUserStore` keeps      │
 *   │ users in process memory; restart wipes them. Production      │
 *   │ deployment needs a real DB-backed implementation. The seam   │
 *   │ exists so a future milestone can replace this with a         │
 *   │ Postgres-backed store without touching the auth provider     │
 *   │ or any route handler.                                        │
 *   │                                                              │
 *   │ For 3J the user store is intentionally separate from the     │
 *   │ project `PersistenceAdapter`: users belong to the auth       │
 *   │ layer, projects belong to the workflow layer. Keeping them   │
 *   │ separate lets a deployment evolve them independently         │
 *   │ (e.g. real auth + still-in-memory projects in early staging).│
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Schema (minimum required fields per the 3J spec):
 *
 *   id            — matches `Actor.id` (e.g. "lawyer_kim"). Stable
 *                    so existing AuditLog / IssueDecisionHistory
 *                    entries seeded by 3F tests stay meaningful.
 *   email         — lowercased + trimmed on write; unique.
 *   display_name  — human-readable, used by the header / actor row.
 *   role          — same `Actor.role` enum the core role guard uses.
 *   password_hash — pbkdf2-sha256 string (see ./password.ts). NEVER
 *                    plaintext.
 *   created_at    — ISO 8601.
 *   disabled_at   — ISO 8601 or null. A non-null value means logins
 *                    + active sessions are rejected (see
 *                    ./signed-cookie.ts).
 */
import type { Actor } from "@contractops/schemas";
import { hashPassword, verifyPassword } from "./password";

/** Subset of role strings the user store accepts. Matches `Actor.role`. */
export type AuthUserRole = "human_lawyer" | "user";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: AuthUserRole;
  readonly password_hash: string;
  readonly created_at: string;
  readonly disabled_at: string | null;
}

export interface CreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: AuthUserRole;
  /** Pre-hashed via `hashPassword`. NEVER pass plaintext here. */
  readonly password_hash: string;
  /** Optional override for tests / migrations. */
  readonly created_at?: string;
}

export interface UserStore {
  /** Identifier surfaced in logs and error messages. */
  readonly driver: "memory";

  getUserById(id: string): Promise<AuthUser | null>;
  /** Email lookup is case-insensitive (stored lowercased). */
  getUserByEmail(email: string): Promise<AuthUser | null>;
  createUser(input: CreateUserInput): Promise<AuthUser>;
  listUsers(): Promise<AuthUser[]>;
  /** Pass `null` to re-enable a previously disabled user. */
  setDisabled(id: string, disabled_at: string | null): Promise<void>;
  /** DEV / DEMO only. Drops every user. */
  clear(): Promise<void>;
}

export class UserAlreadyExistsError extends Error {
  readonly code = "USER_ALREADY_EXISTS";
  constructor(
    public readonly conflict: "id" | "email",
    public readonly value: string,
  ) {
    super(`user with ${conflict}="${value}" already exists`);
  }
}

export class MemoryUserStore implements UserStore {
  readonly driver = "memory" as const;
  private readonly byId = new Map<string, AuthUser>();
  private readonly byEmail = new Map<string, string>(); // email→id

  async getUserById(id: string): Promise<AuthUser | null> {
    return this.byId.get(id) ?? null;
  }

  async getUserByEmail(email: string): Promise<AuthUser | null> {
    const key = email.toLowerCase().trim();
    const id = this.byEmail.get(key);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async createUser(input: CreateUserInput): Promise<AuthUser> {
    if (this.byId.has(input.id)) {
      throw new UserAlreadyExistsError("id", input.id);
    }
    const emailKey = input.email.toLowerCase().trim();
    if (emailKey.length === 0) {
      throw new Error("createUser: email is required");
    }
    if (this.byEmail.has(emailKey)) {
      throw new UserAlreadyExistsError("email", input.email);
    }
    const user: AuthUser = {
      id: input.id,
      email: emailKey,
      display_name: input.display_name,
      role: input.role,
      password_hash: input.password_hash,
      created_at: input.created_at ?? new Date().toISOString(),
      disabled_at: null,
    };
    this.byId.set(user.id, user);
    this.byEmail.set(user.email, user.id);
    return user;
  }

  async listUsers(): Promise<AuthUser[]> {
    return Array.from(this.byId.values()).sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }

  async setDisabled(id: string, disabled_at: string | null): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, disabled_at });
  }

  async clear(): Promise<void> {
    this.byId.clear();
    this.byEmail.clear();
  }
}

const GLOBAL_KEY = "__contractops_user_store_v1__";

/** Cached singleton — survives Next dev HMR. */
export function getUserStore(): UserStore {
  const g = globalThis as Record<string, unknown>;
  const cached = g[GLOBAL_KEY] as UserStore | undefined;
  if (cached) return cached;
  const fresh = new MemoryUserStore();
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

/** Drop the cached store; next `getUserStore()` builds a fresh one. */
export function __resetUserStoreForTests(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[GLOBAL_KEY];
}

/**
 * Sanitized seeded users for tests + the gated signed-auth E2E.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ THESE ARE NOT REAL USERS. Emails point at the IANA-reserved  │
 *   │ `example.test` TLD (RFC 6761 §6.4) so they can NEVER reach   │
 *   │ a real mailbox. Use a memorable but obviously-fake password  │
 *   │ in tests; production deployment seeds via its own secure     │
 *   │ provisioning flow.                                           │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Ids match the demo actor registry so 3F / 3I tests that assert on
 * `actor.id === "lawyer_kim"` keep working after the swap to signed
 * auth.
 */
export const SEED_USERS: ReadonlyArray<Omit<CreateUserInput, "password_hash">> = [
  {
    id: "lawyer_kim",
    email: "lawyer.kim@example.test",
    display_name: "Kim 변호사 (Lawyer)",
    role: "human_lawyer",
  },
  {
    id: "lawyer_park",
    email: "lawyer.park@example.test",
    display_name: "Park 변호사 (Lawyer)",
    role: "human_lawyer",
  },
  {
    id: "business_choi",
    email: "biz.choi@example.test",
    display_name: "Choi 사업담당 (Business)",
    role: "user",
  },
];

/**
 * Idempotent seed for the three demo users using the SAME password.
 *
 * `password` MUST be an obviously-fake, sanitized string — never use a
 * real production password. Default callers (tests, gated E2E) pass
 * `"demo-password"` literally.
 *
 * If a user already exists, this is a no-op for that user — does NOT
 * overwrite existing hashes. Safe to call on app boot.
 */
export async function seedDemoUsers(
  store: UserStore,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  for (const u of SEED_USERS) {
    if (await store.getUserById(u.id)) continue;
    await store.createUser({ ...u, password_hash: hash });
  }
}

/**
 * Look up a user by id + verify the supplied password. Returns the
 * user on success, `null` on any failure (missing / disabled / wrong
 * password). Callers MUST treat the three failures identically — the
 * login route returns a single generic error to prevent email
 * enumeration.
 */
export async function verifyUserPasswordById(
  store: UserStore,
  id: string,
  password: string,
): Promise<AuthUser | null> {
  const u = await store.getUserById(id);
  if (!u) return null;
  if (u.disabled_at) return null;
  const ok = await verifyPassword(password, u.password_hash);
  return ok ? u : null;
}

/** Project an `AuthUser` into the `Actor` shape `core` already consumes. */
export function actorFromUser(u: AuthUser): Actor {
  return { id: u.id, role: u.role, display_name: u.display_name };
}
