import { NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { playbookSchema, type Playbook } from "@contractops/schemas";

export const dynamic = "force-dynamic";

function resolvePlaybooksDir(): string {
  // Dev/build runs from packages/web; repo root playbooks dir is two levels up.
  return join(process.cwd(), "..", "..", "playbooks");
}

export async function GET() {
  try {
    const dir = resolvePlaybooksDir();
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const playbooks: Playbook[] = files.map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      return playbookSchema.parse(raw);
    });
    return NextResponse.json({ playbooks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, playbooks: [] }, { status: 500 });
  }
}
