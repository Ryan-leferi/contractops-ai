/**
 * Signed session token tests (Milestone 3J).
 *
 * Asserts:
 *   - round-trip create / verify works;
 *   - tampered payload is rejected (INVALID_SIGNATURE);
 *   - tampered signature is rejected (INVALID_SIGNATURE);
 *   - wrong secret is rejected (INVALID_SIGNATURE);
 *   - expired token is rejected (EXPIRED);
 *   - malformed input is rejected (INVALID_TOKEN_SHAPE / INVALID_PAYLOAD).
 *
 * Uses a fixed `now` so expiry tests are deterministic.
 */
import { describe, expect, it } from "vitest";

import {
  TokenError,
  createSessionToken,
  verifySessionToken,
} from "../lib/auth";

const SECRET = "this-is-a-32-char-test-secret-aaa";
const OTHER_SECRET = "different-32-char-test-secret-bbb";
const NOW = 1_800_000_000; // fixed unix seconds — far enough in the future to be obviously fake

function makeToken(opts?: {
  user_id?: string;
  issued_at?: number;
  expires_at?: number;
  secret?: string;
}) {
  return createSessionToken(
    {
      user_id: opts?.user_id ?? "lawyer_kim",
      issued_at: opts?.issued_at ?? NOW,
      expires_at: opts?.expires_at ?? NOW + 60,
    },
    opts?.secret ?? SECRET,
  );
}

describe("createSessionToken / verifySessionToken — round trip", () => {
  it("a freshly created token validates", () => {
    const tok = makeToken();
    const payload = verifySessionToken(tok, SECRET, NOW);
    expect(payload.user_id).toBe("lawyer_kim");
    expect(payload.expires_at).toBe(NOW + 60);
  });
});

describe("verifySessionToken — tamper rejection", () => {
  it("a token signed with one secret fails verification with another", () => {
    const tok = makeToken({ secret: OTHER_SECRET });
    expect(() => verifySessionToken(tok, SECRET, NOW)).toThrow(TokenError);
  });

  it("flipping a bit in the payload section is rejected (INVALID_SIGNATURE)", () => {
    const tok = makeToken();
    const [payload, sig] = tok.split(".");
    // Replace the first char of the payload with something else.
    const flipped = payload!.charAt(0) === "a" ? "b" : "a";
    const tampered = flipped + payload!.slice(1) + "." + sig!;
    try {
      verifySessionToken(tampered, SECRET, NOW);
      throw new Error("verifySessionToken should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenError);
      expect((err as TokenError).code).toBe("INVALID_SIGNATURE");
    }
  });

  it("flipping a bit in the signature section is rejected (INVALID_SIGNATURE)", () => {
    const tok = makeToken();
    const [payload, sig] = tok.split(".");
    const flipped = sig!.charAt(0) === "a" ? "b" : "a";
    const tampered = payload + "." + flipped + sig!.slice(1);
    try {
      verifySessionToken(tampered, SECRET, NOW);
      throw new Error("verifySessionToken should have thrown");
    } catch (err) {
      expect((err as TokenError).code).toBe("INVALID_SIGNATURE");
    }
  });
});

describe("verifySessionToken — expiry", () => {
  it("a token whose expires_at is in the past is rejected (EXPIRED)", () => {
    const tok = makeToken({ expires_at: NOW - 1 });
    try {
      verifySessionToken(tok, SECRET, NOW);
      throw new Error("verifySessionToken should have thrown");
    } catch (err) {
      expect((err as TokenError).code).toBe("EXPIRED");
    }
  });

  it("a token expiring exactly at NOW is rejected (boundary)", () => {
    const tok = makeToken({ expires_at: NOW });
    expect(() => verifySessionToken(tok, SECRET, NOW)).toThrow();
  });

  it("a token expiring one second in the future is still valid", () => {
    const tok = makeToken({ expires_at: NOW + 1 });
    expect(() => verifySessionToken(tok, SECRET, NOW)).not.toThrow();
  });
});

describe("verifySessionToken — malformed input", () => {
  it("rejects empty / dotless / single-section tokens", () => {
    for (const bad of ["", "no-dot", "."]) {
      try {
        verifySessionToken(bad, SECRET, NOW);
        throw new Error(`should have thrown for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(TokenError);
        expect((err as TokenError).code).toBe("INVALID_TOKEN_SHAPE");
      }
    }
  });
});
