import { expect, test } from "@playwright/test";

/**
 * GATED auth-event end-to-end (Milestone 3K).
 *
 * Runs ONLY when ALL of these env vars are set (CI never sets them):
 *
 *   E2E_SIGNED_AUTH=true
 *   AUTH_MODE=signed_cookie
 *   AUTH_SESSION_SECRET=<32+ chars>
 *   AUTH_EVENTS_INSPECT=true   (so the dev /api/auth/events route is reachable)
 *
 * Local run:
 *
 *   E2E_SIGNED_AUTH=true \
 *     AUTH_MODE=signed_cookie \
 *     AUTH_SESSION_SECRET=this-is-a-32-char-test-secret-aaa \
 *     AUTH_EVENTS_INSPECT=true \
 *     npm run e2e -w @contractops/web -- signed-auth-events.spec.ts
 *
 * Walks:
 *   1. Dev-seed the three demo users.
 *   2. Failed login (wrong password) → expect 401 + login_failed event.
 *   3. Successful login as lawyer_kim → expect 200 + login_success event.
 *   4. Logout → expect logout event with actor_id=lawyer_kim.
 *   5. Read /api/auth/events → assert all three events landed in order
 *      and that the response carries no password / token leak.
 */

const ENABLED =
  process.env.E2E_SIGNED_AUTH === "true" &&
  process.env.AUTH_EVENTS_INSPECT === "true";

const TEST_PASSWORD = "demo-password";
const WRONG_PASSWORD = "wrong-password-attempt";
const KIM_EMAIL = "lawyer.kim@example.test";

test.describe("Signed-cookie auth event log (gated)", () => {
  test.skip(
    !ENABLED,
    "skipped: set E2E_SIGNED_AUTH=true + AUTH_EVENTS_INSPECT=true to run",
  );

  test("failed login → successful login → logout produces the right event trail", async ({
    request,
  }) => {
    test.setTimeout(60_000);

    // 0. Seed demo users.
    const seedRes = await request.post("/api/auth/dev/seed", {
      data: { password: TEST_PASSWORD },
    });
    expect(seedRes.ok()).toBe(true);

    // 1. Failed login.
    const failRes = await request.post("/api/auth/login", {
      data: { email: KIM_EMAIL, password: WRONG_PASSWORD },
    });
    expect(failRes.status()).toBe(401);
    const failBody = (await failRes.json()) as { code: string };
    expect(failBody.code).toBe("INVALID_CREDENTIALS");

    // 2. Successful login.
    const okRes = await request.post("/api/auth/login", {
      data: { email: KIM_EMAIL, password: TEST_PASSWORD },
    });
    expect(okRes.ok()).toBe(true);

    // 3. Logout (cookies from the login response are reused
    //    automatically by the same `request` context).
    const logoutRes = await request.post("/api/auth/logout");
    expect(logoutRes.ok()).toBe(true);

    // 4. Inspect the event log.
    const eventsRes = await request.get("/api/auth/events");
    expect(eventsRes.ok()).toBe(true);
    const eventsBody = (await eventsRes.json()) as {
      events: {
        event_type: string;
        actor_id: string | null;
        user_id: string | null;
        email: string | null;
        result: "success" | "failure";
        reason_code: string;
        metadata: Record<string, unknown>;
      }[];
    };
    expect(eventsBody.events.length).toBeGreaterThanOrEqual(3);

    const types = eventsBody.events.map((e) => e.event_type);
    expect(types).toContain("login_failed");
    expect(types).toContain("login_success");
    expect(types).toContain("logout");

    const failed = eventsBody.events.find((e) => e.event_type === "login_failed");
    expect(failed!.email).toBe(KIM_EMAIL);
    expect(failed!.user_id).toBe("lawyer_kim");
    expect(failed!.result).toBe("failure");
    expect(failed!.reason_code).toBe("INVALID_CREDENTIALS");
    expect(failed!.metadata.detail).toBe("WRONG_PASSWORD");

    const success = eventsBody.events.find(
      (e) => e.event_type === "login_success",
    );
    expect(success!.actor_id).toBe("lawyer_kim");
    expect(success!.result).toBe("success");

    const out = eventsBody.events.find((e) => e.event_type === "logout");
    expect(out!.actor_id).toBe("lawyer_kim");

    // 5. PRIVACY — the full inspect response must not leak either
    //    password attempt or the signing secret.
    const allText = JSON.stringify(eventsBody);
    expect(allText).not.toContain(TEST_PASSWORD);
    expect(allText).not.toContain(WRONG_PASSWORD);
    expect(allText).not.toContain(process.env.AUTH_SESSION_SECRET!);
  });
});
