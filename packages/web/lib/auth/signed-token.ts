/**
 * HMAC-signed session token (Milestone 3J).
 *
 * Token format:
 *
 *   <payload-base64url>.<signature-base64url>
 *
 * where payload is a JSON object `{ user_id, issued_at, expires_at }`
 * (unix seconds) and signature is `HMAC-SHA256(secret, payload-b64url)`.
 *
 * This is a small, audit-friendly subset of JWT:
 *   - one fixed algorithm (HMAC-SHA256), no `alg: "none"` confusion;
 *   - no header (keeps the on-wire size small);
 *   - no claims we don't actually use (no `iss`/`aud`/`nbf`/`jti`).
 *
 * If a future milestone needs interoperability with another service,
 * switch to a real JWT library. Until then this avoids a dependency
 * and stays under 80 lines.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ ROTATING the secret invalidates EVERY outstanding token.     │
 *   │ For zero-downtime rotation a future milestone needs key-id   │
 *   │ + acceptance set. Out of scope for 3J.                       │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionTokenPayload {
  /** User id matching `AuthUser.id` (e.g. "lawyer_kim"). */
  readonly user_id: string;
  /** Unix seconds when the token was issued. */
  readonly issued_at: number;
  /** Unix seconds when the token expires. Token is rejected at this exact second. */
  readonly expires_at: number;
}

export type TokenErrorCode =
  | "INVALID_TOKEN_SHAPE"
  | "INVALID_SIGNATURE"
  | "INVALID_PAYLOAD"
  | "EXPIRED";

export class TokenError extends Error {
  readonly code: TokenErrorCode;
  constructor(code: TokenErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(secret: string, payloadB64: string): string {
  return b64url(createHmac("sha256", secret).update(payloadB64).digest());
}

/** Serialize + sign a payload. */
export function createSessionToken(
  payload: SessionTokenPayload,
  secret: string,
): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("createSessionToken: secret must be a non-empty string");
  }
  const json = JSON.stringify(payload);
  const payloadB64 = b64url(Buffer.from(json, "utf8"));
  const sig = sign(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify signature + shape + expiry. Throws `TokenError` on any
 * failure; returns the parsed payload on success.
 *
 * `now` defaults to the current wall clock; tests inject a fixed time
 * to exercise expiry deterministically.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): SessionTokenPayload {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("verifySessionToken: secret must be a non-empty string");
  }
  if (typeof token !== "string" || !token.includes(".")) {
    throw new TokenError("INVALID_TOKEN_SHAPE", "session token is malformed");
  }
  const dot = token.indexOf(".");
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (payloadB64.length === 0 || sig.length === 0) {
    throw new TokenError("INVALID_TOKEN_SHAPE", "session token is malformed");
  }
  const expectedSig = sign(secret, payloadB64);
  const expBuf = fromB64url(expectedSig);
  const sigBuf = fromB64url(sig);
  if (expBuf.length !== sigBuf.length || !timingSafeEqual(expBuf, sigBuf)) {
    throw new TokenError("INVALID_SIGNATURE", "session token signature did not match");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString("utf8"));
  } catch {
    throw new TokenError("INVALID_PAYLOAD", "session token payload is not valid JSON");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { user_id?: unknown }).user_id !== "string" ||
    typeof (payload as { issued_at?: unknown }).issued_at !== "number" ||
    typeof (payload as { expires_at?: unknown }).expires_at !== "number"
  ) {
    throw new TokenError(
      "INVALID_PAYLOAD",
      "session token payload missing required fields",
    );
  }
  const p = payload as SessionTokenPayload;
  if (p.expires_at <= now) {
    throw new TokenError("EXPIRED", "session token expired");
  }
  return p;
}
