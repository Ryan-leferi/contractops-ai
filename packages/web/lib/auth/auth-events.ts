/**
 * Auth / security event log (Milestone 3K).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ APPEND-ONLY internal log of authentication-layer events.     │
 *   │ Separate from `AuditLog` (which records WORKFLOW actions) —  │
 *   │ these events describe the AUTH PROCESS itself: logins,       │
 *   │ logouts, session validation failures, demo-actor switches.   │
 *   │                                                              │
 *   │ NOT A PRODUCTION SIEM. The default store is in-process       │
 *   │ memory — restart wipes it. Provides traceability for the     │
 *   │ pre-auth seam shipped in 3I + 3J; full security monitoring   │
 *   │ (forwarding to a real SIEM, alerting, retention policy,      │
 *   │ tamper-evident storage) is out of scope.                     │
 *   │                                                              │
 *   │ MUST NEVER record: plaintext passwords, full signed session  │
 *   │ tokens, signing secrets, API keys, or confidential source    │
 *   │ documents. Tests enforce this — see                          │
 *   │ tests/auth-events-routes.test.ts.                            │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { randomUUID } from "node:crypto";

/**
 * Closed set of auth event types. Adding a new variant requires
 * (a) extending this union, (b) adding the corresponding emit() call
 * from a route, and (c) covering it in the route integration tests.
 */
export type AuthEventType =
  | "login_success"
  | "login_failed"
  | "logout"
  | "session_invalid"
  | "session_expired"
  | "session_tampered"
  | "demo_actor_switch"
  | "demo_auth_forbidden";

/**
 * Bounded summary of the HTTP request that produced the event.
 * Fields are best-effort — null when the upstream proxy didn't pass
 * the header. Values are TRUNCATED so a hostile client can't blow
 * the store up by sending a 10MB User-Agent.
 */
export interface AuthEventRequestContext {
  readonly user_agent: string | null;
  readonly ip: string | null;
  readonly path: string;
  readonly method: string;
}

export interface AuthEvent {
  readonly id: string;
  readonly event_type: AuthEventType;
  /**
   * The actor that the AUTH layer resolved (or attempted to resolve).
   * For `signed_cookie` mode this is the user id; for `demo` mode this
   * is the demo registry id. `null` for pre-auth events where no
   * actor was resolved (e.g. `login_failed` for an unknown email).
   */
  readonly actor_id: string | null;
  /**
   * Same as `actor_id` for signed_cookie events; null for demo events
   * (the demo registry isn't a "user table"). Kept separate so a
   * future Postgres-backed audit dashboard can join against `users`
   * cleanly.
   */
  readonly user_id: string | null;
  /**
   * Normalized (lowercased + trimmed) email when the event involves
   * an email — `login_*` only. NEVER the password. NEVER an email
   * from a project document.
   */
  readonly email: string | null;
  readonly occurred_at: string;
  readonly request_context: AuthEventRequestContext | null;
  readonly result: "success" | "failure";
  /**
   * Short machine-readable reason. Mirrors the `code` on the
   * corresponding route response when one exists (e.g.
   * "INVALID_CREDENTIALS"); free-form when not.
   */
  readonly reason_code: string;
  /**
   * Open-ended extras. MUST NEVER contain passwords, tokens, or
   * secrets. Helpers + route code keep this discipline; tests
   * grep for forbidden strings.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Input to `recordAuthEvent` — the recorder fills in `id` + `occurred_at`. */
export interface NewAuthEventInput {
  readonly event_type: AuthEventType;
  readonly actor_id: string | null;
  readonly user_id: string | null;
  readonly email: string | null;
  readonly request_context: AuthEventRequestContext | null;
  readonly result: "success" | "failure";
  readonly reason_code: string;
  readonly metadata?: Record<string, unknown>;
}

export class AuthEventAppendOnlyViolationError extends Error {
  readonly code = "AUTH_EVENT_APPEND_ONLY_VIOLATION";
  constructor(public readonly event_id: string) {
    super(`auth event id="${event_id}" already exists; auth events are append-only`);
  }
}

export interface AuthEventStore {
  readonly driver: "memory";
  /**
   * Append an event. Throws `AuthEventAppendOnlyViolationError` if
   * an event with the same `id` already exists.
   */
  append(event: AuthEvent): Promise<void>;
  /** Return every event, oldest first. */
  list(): Promise<AuthEvent[]>;
  /** Cheap count without copying the array. */
  count(): Promise<number>;
  /** DEV / TEST only — wipe every event. */
  clear(): Promise<void>;
}

export class MemoryAuthEventStore implements AuthEventStore {
  readonly driver = "memory" as const;
  // Map keyed by id for O(1) duplicate detection; insertion order
  // preserved by the Map iterator, so list() can return that
  // directly.
  private readonly events = new Map<string, AuthEvent>();

  async append(event: AuthEvent): Promise<void> {
    if (this.events.has(event.id)) {
      throw new AuthEventAppendOnlyViolationError(event.id);
    }
    this.events.set(event.id, event);
  }

  async list(): Promise<AuthEvent[]> {
    return Array.from(this.events.values());
  }

  async count(): Promise<number> {
    return this.events.size;
  }

  async clear(): Promise<void> {
    this.events.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Singleton cached on globalThis — survives Next dev HMR.
// ─────────────────────────────────────────────────────────────────────

const GLOBAL_KEY = "__contractops_auth_event_store_v1__";

export function getAuthEventStore(): AuthEventStore {
  const g = globalThis as Record<string, unknown>;
  const cached = g[GLOBAL_KEY] as AuthEventStore | undefined;
  if (cached) return cached;
  const fresh = new MemoryAuthEventStore();
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

export function __resetAuthEventStoreForTests(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[GLOBAL_KEY];
}

// ─────────────────────────────────────────────────────────────────────
// Recorder + helpers
// ─────────────────────────────────────────────────────────────────────

/** Reserved word list — recorder rejects metadata keys that look like secrets. */
const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "plaintext_password",
  "password_hash", // never even the hash — leave that on the user store
  "token",
  "session_token",
  "signature",
  "cookie",
  "secret",
  "session_secret",
  "auth_session_secret",
  "api_key",
]);

function assertSafeMetadata(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  for (const k of Object.keys(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(k.toLowerCase())) {
      throw new Error(
        `recordAuthEvent: metadata key "${k}" is forbidden (looks like a secret)`,
      );
    }
  }
}

/**
 * Build a full `AuthEvent` from a NewAuthEventInput and persist it.
 * Best-effort: any append failure is logged to stderr but never
 * thrown back to the caller — the auth route response is the
 * priority, the audit trail is secondary.
 *
 * The metadata bag is shallow-cloned and frozen so the caller can't
 * mutate it after handoff. Keys matching the FORBIDDEN_METADATA_KEYS
 * set are rejected outright (defensive — the helper is the only
 * thing routes touch, so a key like "password" never reaches the
 * store).
 */
export async function recordAuthEvent(input: NewAuthEventInput): Promise<void> {
  try {
    assertSafeMetadata(input.metadata);
    const event: AuthEvent = {
      id: `ae_${randomUUID()}`,
      event_type: input.event_type,
      actor_id: input.actor_id,
      user_id: input.user_id,
      email: input.email,
      occurred_at: new Date().toISOString(),
      request_context: input.request_context,
      result: input.result,
      reason_code: input.reason_code,
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    };
    await getAuthEventStore().append(event);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("recordAuthEvent failed (best-effort):", err);
  }
}

/**
 * Best-effort extraction of a bounded request summary. Returns
 * `null` when `request` itself is null (some callers may want to
 * record a system-emitted event without a request).
 */
export function extractRequestContext(
  request: Request | null,
): AuthEventRequestContext | null {
  if (!request) return null;
  const userAgent = request.headers.get("user-agent");
  const xff = request.headers.get("x-forwarded-for");
  let ip: string | null = null;
  if (xff) {
    const firstHop = xff.split(",")[0]?.trim() ?? "";
    ip = firstHop.length > 0 ? firstHop.slice(0, 64) : null;
  }
  let path = "";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "";
  }
  return {
    user_agent: userAgent ? userAgent.slice(0, 256) : null,
    ip,
    path,
    method: request.method ?? "GET",
  };
}

/**
 * Lowercase + trim an email for use as an event field. Returns
 * `null` for non-string / empty input so the recorder always
 * receives a normalized value.
 */
export function normalizeEmailForEvent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed.slice(0, 320); // RFC 5321 max
}
