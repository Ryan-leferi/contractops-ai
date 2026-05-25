/**
 * Password hashing helpers (Milestone 3J).
 *
 * Built on Node's stdlib `crypto.pbkdf2` — NO new npm dependency.
 *
 * Why PBKDF2 (vs. bcrypt/argon2 deps):
 *   - bcrypt's npm packages either pull in native bindings (build pain on
 *     Windows / CI) or are pure-JS forks with weaker performance.
 *   - argon2 has the same native-binding problem.
 *   - PBKDF2-HMAC-SHA256 is in Node's stdlib, OWASP-recommended (≥
 *     310k iters as of 2023; we use 120k as a demo-grade balance), and
 *     auditable in 60 lines.
 *
 * If a future milestone moves to a hardened deployment, replace this
 * file with a bcrypt / argon2id wrapper. The on-disk hash format
 * carries a version prefix (`pbkdf2-sha256-v1`) so the migration can
 * recognize legacy hashes and re-hash on next login.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NEVER store plaintext passwords. Tests assert that the hash  │
 *   │ string is not equal to the plaintext (see                    │
 *   │ tests/auth-password.test.ts).                                │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

const VERSION = "pbkdf2-sha256-v1";
const ITERATIONS = 120_000;
const KEY_LENGTH = 32; // bytes
const SALT_LENGTH = 16; // bytes
const DIGEST = "sha256";

/**
 * Hash a plaintext password into a self-describing string of the form
 *
 *   pbkdf2-sha256-v1$<iterations>$<salt-b64url>$<derived-b64url>
 *
 * The version + iterations + salt are stored alongside the derived key
 * so `verifyPassword` can recompute the same derivation. Future
 * milestones changing the version can keep validating legacy hashes by
 * branching on the prefix.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  const salt = randomBytes(SALT_LENGTH);
  const derived = await pbkdf2Async(plaintext, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return [
    VERSION,
    ITERATIONS.toString(),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verification. Returns `true` iff `plaintext` derives to
 * the same key as the one encoded in `hash`. Any malformed hash, wrong
 * version, or mismatched key returns `false` — callers MUST NOT
 * distinguish failures (the login route returns a single generic error
 * to avoid email-enumeration attacks).
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (typeof plaintext !== "string" || typeof hash !== "string") return false;
  const parts = hash.split("$");
  if (parts.length !== 4) return false;
  const [version, iterStr, saltB64, expectedDerivedB64] = parts;
  if (version !== VERSION) return false;
  const iter = Number.parseInt(iterStr ?? "", 10);
  if (!Number.isFinite(iter) || iter < 1000) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64 ?? "", "base64url");
    expected = Buffer.from(expectedDerivedB64 ?? "", "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await pbkdf2Async(plaintext, salt, iter, expected.length, DIGEST);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
