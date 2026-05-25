/**
 * Password hashing tests (Milestone 3J).
 *
 * Asserts:
 *   - hashes never equal plaintext;
 *   - verify is round-trip correct;
 *   - wrong password rejected;
 *   - malformed / wrong-version hashes rejected (don't throw);
 *   - two hashes of the same plaintext differ (per-call salt).
 */
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../lib/auth";

const FAKE_PASSWORD = "demo-password-not-real";

describe("hashPassword + verifyPassword", () => {
  it("the hash string is NOT equal to the plaintext", async () => {
    const h = await hashPassword(FAKE_PASSWORD);
    expect(h).not.toBe(FAKE_PASSWORD);
    expect(h).not.toContain(FAKE_PASSWORD);
    expect(h.startsWith("pbkdf2-sha256-v1$")).toBe(true);
  });

  it("verifyPassword(plaintext, hash) returns true for the matching pair", async () => {
    const h = await hashPassword(FAKE_PASSWORD);
    await expect(verifyPassword(FAKE_PASSWORD, h)).resolves.toBe(true);
  });

  it("verifyPassword returns false for the wrong password", async () => {
    const h = await hashPassword(FAKE_PASSWORD);
    await expect(verifyPassword("not-the-password", h)).resolves.toBe(false);
  });

  it("two hashes of the same plaintext differ (random salt)", async () => {
    const a = await hashPassword(FAKE_PASSWORD);
    const b = await hashPassword(FAKE_PASSWORD);
    expect(a).not.toBe(b);
    // …but both still verify.
    await expect(verifyPassword(FAKE_PASSWORD, a)).resolves.toBe(true);
    await expect(verifyPassword(FAKE_PASSWORD, b)).resolves.toBe(true);
  });

  it("hashPassword rejects empty / non-string input", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(
      hashPassword(undefined as unknown as string),
    ).rejects.toThrow();
  });

  it("verifyPassword returns false (no throw) on malformed hash strings", async () => {
    for (const garbage of [
      "",
      "not-a-hash",
      "pbkdf2-sha256-v1$only-three$parts",
      "wrong-version$120000$abc$def",
      "pbkdf2-sha256-v1$0$abc$def", // iteration too small
    ]) {
      await expect(verifyPassword(FAKE_PASSWORD, garbage)).resolves.toBe(false);
    }
  });
});
