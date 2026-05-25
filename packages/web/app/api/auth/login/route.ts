/**
 * POST /api/auth/login — signed_cookie auth mode (Milestone 3J).
 *
 *   POST { email, password } → 200 { actor, source: "signed_cookie" }
 *                              + Set-Cookie <AUTH_COOKIE_NAME>=<signed-token>
 *
 * Refused in `demo` auth mode (the demo provider doesn't use
 * passwords); returns 400 `AUTH_MODE_MISMATCH` so misconfigured
 * clients get a clear error instead of silently issuing a useless
 * cookie.
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
 *   │ of login events, MFA. See ADR-017 for the migration path.   │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import {
  actorFromUser,
  createSessionToken,
  getAuthConfig,
  getUserStore,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_CREDS_ERROR = "invalid email or password";

export async function POST(request: Request) {
  const config = getAuthConfig();
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
  const email = body.email;
  const password = body.password;
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length === 0 ||
    password.length === 0
  ) {
    return NextResponse.json(
      {
        error: "email and password are required",
        code: "BAD_CREDENTIALS",
      },
      { status: 400 },
    );
  }

  const store = getUserStore();
  const user = await store.getUserByEmail(email);
  // Three branches, ONE error code. Email enumeration prevention.
  if (!user || user.disabled_at) {
    return NextResponse.json(
      { error: GENERIC_CREDS_ERROR, code: "INVALID_CREDENTIALS" },
      { status: 401 },
    );
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
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
