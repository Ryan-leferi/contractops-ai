/**
 * /api/projects/reset — DEV/DEMO ONLY (Milestone 3D).
 *
 * Drops every project and every audit log from the in-memory store. This
 * route is intentionally non-destructive in production:
 *
 *   - In production (`NODE_ENV === "production"`) the route returns 403
 *     UNLESS the explicit opt-in env var `ALLOW_SERVER_STORE_RESET=true`
 *     is set. Production deployments should leave that unset.
 *   - In dev / test the route always works so Playwright tests and local
 *     iteration can wipe state between runs.
 *
 * Even when enabled the route has no auth — DO NOT EXPOSE A PROD APP
 * THAT HAS THIS RESET ROUTE REACHABLE.
 */
import { NextResponse } from "next/server";
import { resetStore } from "@/lib/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resetAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return (process.env.ALLOW_SERVER_STORE_RESET ?? "").toLowerCase() === "true";
}

export async function POST() {
  if (!resetAllowed()) {
    return NextResponse.json(
      {
        error:
          "store reset is disabled in production. Set ALLOW_SERVER_STORE_RESET=true to override.",
        code: "RESET_DISABLED",
      },
      { status: 403 },
    );
  }
  resetStore();
  return NextResponse.json({ ok: true });
}
