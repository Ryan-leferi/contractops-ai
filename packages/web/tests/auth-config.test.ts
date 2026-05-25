/**
 * Auth config tests (Milestone 3J).
 *
 * Pure-function tests of `readAuthConfig` — no Next, no HTTP, no
 * cookies. Constructs synthetic `NodeJS.ProcessEnv` objects so the
 * test never mutates real `process.env`.
 */
import { describe, expect, it } from "vitest";

import {
  AuthSessionSecretMissingError,
  AuthSessionSecretWeakError,
  DemoAuthInProductionError,
  UnknownAuthModeError,
  readAuthConfig,
} from "../lib/auth";

// 32-char demo secret (clearly fake). Tests never use real entropy.
const SECRET = "this-is-a-32-char-test-secret-aaa";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  // Defensive empty base so unrelated env vars (NODE_ENV from the host
  // vitest process, AUTH_* from a developer's shell, …) cannot leak in.
  return overrides as NodeJS.ProcessEnv;
}

describe("readAuthConfig — defaults to demo mode", () => {
  it("AUTH_MODE missing → mode=demo, demoEnabled=true, no secret", () => {
    const c = readAuthConfig(env({}));
    expect(c.mode).toBe("demo");
    expect(c.demoEnabled).toBe(true);
    expect(c.sessionSecret).toBeNull();
    expect(c.cookieName).toBe("contractops_session");
    expect(c.cookieMaxAgeSeconds).toBe(60 * 60 * 24 * 7);
    expect(c.isProduction).toBe(false);
  });

  it("AUTH_MODE='' (empty) → mode=demo", () => {
    expect(readAuthConfig(env({ AUTH_MODE: "" })).mode).toBe("demo");
  });

  it("AUTH_MODE='demo' (explicit) → mode=demo", () => {
    expect(readAuthConfig(env({ AUTH_MODE: "demo" })).mode).toBe("demo");
  });

  it("AUTH_MODE='DEMO' (uppercase) → mode=demo", () => {
    expect(readAuthConfig(env({ AUTH_MODE: "DEMO" })).mode).toBe("demo");
  });
});

describe("readAuthConfig — signed_cookie mode", () => {
  it("AUTH_MODE=signed_cookie without secret → AuthSessionSecretMissingError", () => {
    expect(() => readAuthConfig(env({ AUTH_MODE: "signed_cookie" }))).toThrow(
      AuthSessionSecretMissingError,
    );
  });

  it("AUTH_MODE=signed_cookie + short secret → AuthSessionSecretWeakError", () => {
    expect(() =>
      readAuthConfig(
        env({ AUTH_MODE: "signed_cookie", AUTH_SESSION_SECRET: "short" }),
      ),
    ).toThrow(AuthSessionSecretWeakError);
  });

  it("AUTH_MODE=signed_cookie + 32-char secret → ok; demoEnabled defaults false", () => {
    const c = readAuthConfig(
      env({ AUTH_MODE: "signed_cookie", AUTH_SESSION_SECRET: SECRET }),
    );
    expect(c.mode).toBe("signed_cookie");
    expect(c.sessionSecret).toBe(SECRET);
    expect(c.demoEnabled).toBe(false);
  });

  it("DEMO_AUTH_ENABLED=true overrides the signed_cookie default", () => {
    const c = readAuthConfig(
      env({
        AUTH_MODE: "signed_cookie",
        AUTH_SESSION_SECRET: SECRET,
        DEMO_AUTH_ENABLED: "true",
      }),
    );
    expect(c.demoEnabled).toBe(true);
  });

  it("DEMO_AUTH_ENABLED=false overrides the demo-mode default", () => {
    const c = readAuthConfig(
      env({ AUTH_MODE: "demo", DEMO_AUTH_ENABLED: "false" }),
    );
    expect(c.demoEnabled).toBe(false);
  });
});

describe("readAuthConfig — unknown mode", () => {
  it("AUTH_MODE='oauth_jwt' throws UnknownAuthModeError", () => {
    expect(() => readAuthConfig(env({ AUTH_MODE: "oauth_jwt" }))).toThrow(
      UnknownAuthModeError,
    );
  });

  it("AUTH_MODE='nope' throws UnknownAuthModeError with the raw value", () => {
    try {
      readAuthConfig(env({ AUTH_MODE: "nope" }));
      throw new Error("readAuthConfig should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAuthModeError);
      expect((err as UnknownAuthModeError).raw).toBe("nope");
    }
  });
});

describe("readAuthConfig — production guard", () => {
  it("NODE_ENV=production + AUTH_MODE=demo → DemoAuthInProductionError", () => {
    expect(() =>
      readAuthConfig(env({ NODE_ENV: "production" })),
    ).toThrow(DemoAuthInProductionError);
  });

  it("NODE_ENV=production + AUTH_MODE=demo + ALLOW_DEMO_AUTH_IN_PRODUCTION=true → ok", () => {
    const c = readAuthConfig(
      env({
        NODE_ENV: "production",
        ALLOW_DEMO_AUTH_IN_PRODUCTION: "true",
      }),
    );
    expect(c.mode).toBe("demo");
    expect(c.isProduction).toBe(true);
  });

  it("NODE_ENV=production + AUTH_MODE=signed_cookie + secret → ok; isProduction true", () => {
    const c = readAuthConfig(
      env({
        NODE_ENV: "production",
        AUTH_MODE: "signed_cookie",
        AUTH_SESSION_SECRET: SECRET,
      }),
    );
    expect(c.mode).toBe("signed_cookie");
    expect(c.isProduction).toBe(true);
  });
});

describe("readAuthConfig — cookie options", () => {
  it("AUTH_COOKIE_NAME custom value is preserved", () => {
    expect(
      readAuthConfig(env({ AUTH_COOKIE_NAME: "my_session" })).cookieName,
    ).toBe("my_session");
  });

  it("AUTH_COOKIE_MAX_AGE_SECONDS overrides the default", () => {
    expect(
      readAuthConfig(env({ AUTH_COOKIE_MAX_AGE_SECONDS: "3600" }))
        .cookieMaxAgeSeconds,
    ).toBe(3600);
  });

  it("Garbage AUTH_COOKIE_MAX_AGE_SECONDS falls back to the default", () => {
    expect(
      readAuthConfig(env({ AUTH_COOKIE_MAX_AGE_SECONDS: "not-a-number" }))
        .cookieMaxAgeSeconds,
    ).toBe(60 * 60 * 24 * 7);
  });

  it("Sub-60s AUTH_COOKIE_MAX_AGE_SECONDS is clamped up (minimum guard)", () => {
    expect(
      readAuthConfig(env({ AUTH_COOKIE_MAX_AGE_SECONDS: "5" }))
        .cookieMaxAgeSeconds,
    ).toBe(60 * 60 * 24 * 7);
  });
});
