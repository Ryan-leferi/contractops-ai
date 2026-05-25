/**
 * POST /api/auth/dev/seed — DEV/E2E-ONLY user-store seeder
 * (Milestone 3J).
 *
 *   POST { password } → 200 { seeded: number }
 *                       403 in any environment where the gate flag
 *                       is not set.
 *
 * Gated by `E2E_SIGNED_AUTH=true` so production deployments never
 * expose a route that hands out three pre-seeded accounts on demand.
 * The gated signed-auth Playwright spec calls this once before the
 * first login to ensure the three demo users exist in the in-memory
 * user store.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ Refuses to run unless E2E_SIGNED_AUTH=true. Sets HTTP 403    │
 *   │ otherwise — the client expects the gate to either be open    │
 *   │ (E2E mode) or closed (everywhere else).                      │
 *   │                                                              │
 *   │ The PASSWORD must be supplied by the caller; we never        │
 *   │ default. This guarantees the spec is the only thing that     │
 *   │ knows the password, and that password is an obvious test     │
 *   │ string ("demo-password") — production deployment uses its    │
 *   │ own secure provisioning flow.                                │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import { getUserStore, seedDemoUsers } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function devSeedEnabled(): boolean {
  return process.env.E2E_SIGNED_AUTH === "true";
}

export async function POST(request: Request) {
  if (!devSeedEnabled()) {
    return NextResponse.json(
      {
        error:
          "dev seed route is disabled. Set E2E_SIGNED_AUTH=true to enable (dev only).",
        code: "DEV_SEED_DISABLED",
      },
      { status: 403 },
    );
  }
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }
  const password = body.password;
  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json(
      {
        error: "password is required and must be a non-empty string",
        code: "BAD_PASSWORD",
      },
      { status: 400 },
    );
  }
  const store = getUserStore();
  await seedDemoUsers(store, password);
  const users = await store.listUsers();
  return NextResponse.json({ seeded: users.length });
}
