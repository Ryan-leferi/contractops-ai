/**
 * /api/projects/[id]/operations — apply a single workflow operation
 * (Milestone 3D).
 *
 *   POST { name: OperationName, args: Operation["args"] }
 *     → 200 { state, audits }
 *     → 400 if body / operation name is malformed
 *     → 404 if project not found
 *     → 422 if the aggregate refused (invalid transition, missing
 *           prerequisite, pending issues blocking final approval, etc.)
 *
 * The route is a thin pass-through to `applyOperationToStore`. All
 * workflow invariants stay enforced in @contractops/core.
 */
import { NextResponse } from "next/server";
import {
  ProjectNotFoundError,
  UnknownOperationError,
  applyOperationToStore,
  parseOperationOrThrow,
} from "@/lib/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }

  let op;
  try {
    op = parseOperationOrThrow(body);
  } catch (err) {
    if (err instanceof UnknownOperationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        code: "BAD_OPERATION",
      },
      { status: 400 },
    );
  }

  try {
    const result = await applyOperationToStore(ctx.params.id, op);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 404 },
      );
    }
    // Aggregate-layer errors (invalid transition, missing prerequisite,
    // pending issues blocking final, etc.) surface as 422 so the
    // browser can distinguish "your input was malformed" (400) from
    // "your input was well-formed but the workflow refused" (422).
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, code: "OPERATION_REJECTED", op: op.name },
      { status: 422 },
    );
  }
}
