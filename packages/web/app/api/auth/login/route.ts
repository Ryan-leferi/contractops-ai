/**
 * POST /api/auth/login — signed_cookie auth mode (Milestones 3J + 3K).
 *
 *   POST { email, password } → 200 { actor, source: "signed_cookie" }
 *                              + Set-Cookie <AUTH_COOKIE_NAME>=<signed-token>
 *
 * Refused in `demo` auth mode (the demo provider doesn't use
 * passwords); returns 400 `AUTH_MODE_MISMATCH` so misconfigured
 * clients get a clear error instead of silently issuing a useless
 * cookie.
 *
 * Auth event emission (Milestone 3K):
 *   - login_success: 200 path — `email`, `user_id`, `actor_id` set.
 *   - login_failed:  every 401 path. `email` is the normalized value;
 *                     `user_id` is set when the email matched an
 *                     existing user (so a brute-force log can spot
 *                     "lots of failures against this account").
 *                     `metadata.detail` holds the server-side reason
 *                     (`UNKNOWN_EMAIL` / `WRONG_PASSWORD` / `DISABLED_USER`)
 *                     — purely internal; the client still gets the
 *                     single generic `INVALID_CREDENTIALS` error.
 *   - PASSWORD IS NEVER RECORDED. The route never passes it to the
 *     recorder; `recordAuthEvent` refuses forbidden metadata keys
 *     defensively.
 *
 * Security notes:
 *   - email lookup is case-insensitive.
 *   - missing user, disabled user, and wrong password ALL return the
 *     same generic `INVALID_CREDENTIALS` 401. No email-enumeration leak.
 *   - cookie is httpOnly + sameSite=lax. `secure: true` only in
 *     production so local dev over plain http still works.
 *   - bcrypt-style timing-safe verification lives in `lib/auth/password.ts`.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NOT FULL PRODUCTION AUTH. Still missing: rate limiting,      │
 *   │ account lockout, email verification, password reset, audit   │
 *   │ of login events forwarded to a real SIEM, MFA. See ADR-017   │
 *   │ + ADR-018 for the migration path.                            │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import {
  actorFromUser,
  createSessionToken,
  extractRequestContext,
  getAuthConfig,
  getUserStore,
  normalizeEmailForEvent,
  recordAuthEvent,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_CREDS_ERROR = "invalid email or password";

export async function POST(request: Request) {
  const config = getAuthConfig();
  const requestContext = extractRequestContext(request);

  if (config.mode !== "signed_cookie") {
    return NextResponse.json(
      {
        error:
          'login is only available when AUTH_MODE="signed_cookie". ' +
          'In "demo" mode, switch actors via POST /api/auth/demo/actor.',
        code: "AUTH_MODE_MISMATCH",
      },
      { status: 400 },
    );
  }
  if (!config.sessionSecret) {
    // Defensive — readAuthConfig refuses this combination.
    return NextResponse.json(
      { error: "server misconfigured", code: "AUTH_SESSION_SECRET_MISSING" },
      { status: 500 },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }
  const emailRaw = body.email;
  const passwordRaw = body.password;
  if (
    typeof emailRaw !== "string" ||
    typeof passwordRaw !== "string" ||
    emailRaw.length === 0 ||
    passwordRaw.length === 0
  ) {
    // BAD_CREDENTIALS is malformed-request, NOT a login attempt —
    // intentionally NOT recorded as login_failed (would be noise).
    return NextResponse.json(
      {
        error: "email and password are required",
        code: "BAD_CREDENTIALS",
      },
      { status: 400 },
    );
  }

  const normalizedEmail = normalizeEmailForEvent(emailRaw);
  const store = getUserStore();
  const user = await store.getUserByEmail(emailRaw);

  // Three failure branches, ONE client-visible error code. Each
  // emits a distinct `metadata.detail` for the internal audit log,
  // never leaked back to the client.
  if (!user) {
    await recordAuthEvent({
      event_type: "login_failed",
      actor_id: null,
      user_id: null,
      email: normalizedEmail,
      request_context: requestContext,
      result: "failure",
      reason_code: "INVALID_CREDENTIALS",
      metadata: { detail: "UNKNOWN_EMAIL" },
    });
    return NextResponse.json(
      { error: GENERIC_CREDS_ERROR, code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }
  if (user.disabled_at) {
    await recordAuthEvent({
      event_type: "login_failed",
      actor_id: user.id,
      user_id: user.id,
      email: normalizedEmail,
      request_context: requestContext,
      result: "failure",
      reason_code: "INVALID_CREDENTIALS",
      metadata: { detail: "DISABLED_USER" },
    });
    return NextResponse.json(
      { error: GENERIC_CREDS_ERROR, code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }
  const ok = await verifyPassword(passwordRaw, user.password_hash);
  if (!ok) {
    await recordAuthEvent({
      event_type: "login_failed",
      actor_id: user.id,
      user_id: user.id,
      email: normalizedEmail,
      request_context: requestContext,
      result: "failure",
      reason_code: "INVALID_CREDENTIALS",
      metadata: { detail: "WRONG_PASSWORD" },
    });
    return NextResponse.json(
      { error: GENERIC_CREDS_ERROR, code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }

  // Issue signed session token.
  const now = Math.floor(Date.now() / 1000);
  const token = createSessionToken(
    {
      user_id: user.id,
      issued_at: now,
      expires_at: now + config.cookieMaxAgeSeconds,
    },
    config.sessionSecret,
  );

  await recordAuthEvent({
    event_type: "login_success",
    actor_id: user.id,
    user_id: user.id,
    email: normalizedEmail,
    request_context: requestContext,
    result: "success",
    reason_code: "OK",
    metadata: { cookie_max_age_seconds: config.cookieMaxAgeSeconds },
  });

  const res = NextResponse.json({
    actor: actorFromUser(user),
    source: "signed_cookie",
  });
  res.cookies.set(config.cookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    maxAge: config.cookieMaxAgeSeconds,
  });
  return res;
}
