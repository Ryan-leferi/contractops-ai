/**
 * Auth boundary configuration (Milestone 3J).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NOT PRODUCTION AUTHENTICATION — pre-auth seam.               │
 *   │                                                              │
 *   │ Two modes are supported in 3J:                               │
 *   │                                                              │
 *   │   demo (default)   — keeps the cookie-based DemoSession      │
 *   │                       provider from 3I, hardcoded registry,  │
 *   │                       no password / no token verification.   │
 *   │   signed_cookie    — HMAC-signed session cookie backed by a  │
 *   │                       user store with PBKDF2 password hashes.│
 *   │                       Still no OAuth/SSO/RBAC — that's 3K+.  │
 *   │                                                              │
 *   │ Production deployment STILL requires a real identity         │
 *   │ provider (OAuth or enterprise SSO), per-project authorization│
 *   │ and an audit of auth events. See ADR-017 for the full        │
 *   │ migration path.                                              │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Environment variables read here:
 *
 *   AUTH_MODE                  — "demo" (default) | "signed_cookie"
 *   AUTH_SESSION_SECRET        — required when AUTH_MODE=signed_cookie.
 *                                 Must be ≥ 32 chars. NEVER commit a
 *                                 real value.
 *   AUTH_COOKIE_NAME           — default "contractops_session"
 *   AUTH_COOKIE_MAX_AGE_SECONDS — default 604800 (7 days)
 *   DEMO_AUTH_ENABLED          — default true in demo mode, false in
 *                                 signed_cookie mode. Controls whether
 *                                 POST /api/auth/demo/actor accepts
 *                                 calls. Explicit env value wins.
 *   NODE_ENV                   — "production" + AUTH_MODE=demo is
 *                                 refused at boot unless
 *                                 ALLOW_DEMO_AUTH_IN_PRODUCTION=true.
 *
 * Read once via `getAuthConfig()`; result is cached on `globalThis`
 * so Next dev HMR doesn't re-parse env on every route hit.
 */

export type AuthMode = "demo" | "signed_cookie";

export interface AuthConfig {
  /** Resolved auth mode. */
  readonly mode: AuthMode;
  /** Whether `POST /api/auth/demo/actor` is callable in the current mode. */
  readonly demoEnabled: boolean;
  /** HMAC secret for signed_cookie mode; `null` in demo mode. */
  readonly sessionSecret: string | null;
  /** Cookie name the signed_cookie provider sets / reads. */
  readonly cookieName: string;
  /** Max-age (seconds) for the signed cookie. */
  readonly cookieMaxAgeSeconds: number;
  /** `NODE_ENV === "production"` — gates secure-cookie + demo refusal. */
  readonly isProduction: boolean;
}

export class UnknownAuthModeError extends Error {
  readonly code = "UNKNOWN_AUTH_MODE";
  constructor(public readonly raw: string) {
    super(
      `Unknown AUTH_MODE "${raw}". Expected "demo" (default) or "signed_cookie".`,
    );
  }
}

export class AuthSessionSecretMissingError extends Error {
  readonly code = "AUTH_SESSION_SECRET_MISSING";
  constructor() {
    super(
      'AUTH_MODE="signed_cookie" requires AUTH_SESSION_SECRET to be set. ' +
        "Generate one with `openssl rand -base64 48` and set it via your " +
        "environment manager. NEVER commit the value.",
    );
  }
}

export class AuthSessionSecretWeakError extends Error {
  readonly code = "AUTH_SESSION_SECRET_WEAK";
  constructor(public readonly length: number) {
    super(
      `AUTH_SESSION_SECRET is too short (${length} chars). Use at least ` +
        "32 characters of entropy (e.g. `openssl rand -base64 48`).",
    );
  }
}

export class DemoAuthInProductionError extends Error {
  readonly code = "DEMO_AUTH_IN_PRODUCTION";
  constructor() {
    super(
      'AUTH_MODE="demo" is refused when NODE_ENV=production. ' +
        'Set AUTH_MODE="signed_cookie" + AUTH_SESSION_SECRET, or set ' +
        "ALLOW_DEMO_AUTH_IN_PRODUCTION=true for an explicit dev override.",
    );
  }
}

/** Parse the auth config from env without touching the cache. Exposed for tests. */
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const rawMode = (env.AUTH_MODE ?? "").trim().toLowerCase();
  let mode: AuthMode;
  if (rawMode === "" || rawMode === "demo") {
    mode = "demo";
  } else if (rawMode === "signed_cookie") {
    mode = "signed_cookie";
  } else {
    throw new UnknownAuthModeError(env.AUTH_MODE ?? "");
  }

  const isProduction = env.NODE_ENV === "production";

  if (
    mode === "demo" &&
    isProduction &&
    env.ALLOW_DEMO_AUTH_IN_PRODUCTION !== "true"
  ) {
    throw new DemoAuthInProductionError();
  }

  const sessionSecretRaw = (env.AUTH_SESSION_SECRET ?? "").trim();
  const sessionSecret = sessionSecretRaw.length === 0 ? null : sessionSecretRaw;
  if (mode === "signed_cookie") {
    if (!sessionSecret) throw new AuthSessionSecretMissingError();
    if (sessionSecret.length < 32) {
      throw new AuthSessionSecretWeakError(sessionSecret.length);
    }
  }

  // DEMO_AUTH_ENABLED — explicit value wins; otherwise default by mode.
  const rawDemo = (env.DEMO_AUTH_ENABLED ?? "").trim().toLowerCase();
  let demoEnabled: boolean;
  if (rawDemo === "") {
    demoEnabled = mode === "demo";
  } else {
    demoEnabled = rawDemo === "true" || rawDemo === "1" || rawDemo === "yes" || rawDemo === "on";
  }

  const cookieName = ((env.AUTH_COOKIE_NAME ?? "").trim() || "contractops_session");
  const cookieMaxAgeRaw = (env.AUTH_COOKIE_MAX_AGE_SECONDS ?? "").trim();
  let cookieMaxAgeSeconds = 60 * 60 * 24 * 7; // 7 days default
  if (cookieMaxAgeRaw !== "") {
    const parsed = Number.parseInt(cookieMaxAgeRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 60) cookieMaxAgeSeconds = parsed;
  }

  return {
    mode,
    demoEnabled,
    sessionSecret,
    cookieName,
    cookieMaxAgeSeconds,
    isProduction,
  };
}

const GLOBAL_KEY = "__contractops_auth_config_v1__";

/** Cached config; first call parses + validates env. */
export function getAuthConfig(): AuthConfig {
  const g = globalThis as Record<string, unknown>;
  const cached = g[GLOBAL_KEY] as AuthConfig | undefined;
  if (cached) return cached;
  const fresh = readAuthConfig();
  g[GLOBAL_KEY] = fresh;
  return fresh;
}

/** Drop the cached config; next `getAuthConfig()` re-parses env. */
export function __resetAuthConfigForTests(): void {
  const g = globalThis as Record<string, unknown>;
  delete g[GLOBAL_KEY];
}
