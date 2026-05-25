/**
 * GET /api/auth/events — DEV/ADMIN inspect of the auth/security event
 * log (Milestone 3K).
 *
 *   GET → 200 { events: AuthEvent[] }   (when gate is open)
 *   GET → 403 AUTH_EVENTS_INSPECT_DISABLED  (default)
 *
 * Gated by `AUTH_EVENTS_INSPECT=true`. CI never sets this. The route
 * exists so dev / E2E specs can verify the log was populated; it
 * does NOT pretend to be a production admin surface.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ NOT A PRODUCTION ADMIN API.                                  │
 *   │   - No auth check beyond the env gate.                       │
 *   │   - No pagination, no filtering, no rate limit.              │
 *   │   - Returns the whole in-memory event log on every call.     │
 *   │   - Production deployment forwards events to a real SIEM     │
 *   │     and exposes them through that SIEM's UI — not this       │
 *   │     route. See ADR-018 + the migration path in README.        │
 *   └──────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import { getAuthEventStore } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inspectEnabled(): boolean {
  return process.env.AUTH_EVENTS_INSPECT === "true";
}

export async function GET() {
  if (!inspectEnabled()) {
    return NextResponse.json(
      {
        error:
          "auth events inspect route is disabled. " +
          "Set AUTH_EVENTS_INSPECT=true to enable (dev/admin only).",
        code: "AUTH_EVENTS_INSPECT_DISABLED",
      },
      { status: 403 },
    );
  }
  const events = await getAuthEventStore().list();
  return NextResponse.json({ events });
}
