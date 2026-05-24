import { NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

function resolvePromptsDir(): string {
  // Dev/build runs from packages/web; repo root prompts dir is two levels up.
  return join(process.cwd(), "..", "..", "prompts");
}

const KNOWN_IDS = [
  "deal_memo_drafter",
  "drafting_plan_drafter",
  "contract_drafter",
  "counterparty_reviewer",
  "source_consistency_reviewer",
  "legal_style_reviewer",
  "revision_agent",
  "final_qa_assistant",
] as const;

export async function GET() {
  try {
    const dir = resolvePromptsDir();
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    const prompts: Record<string, string> = {};
    for (const id of KNOWN_IDS) {
      const fname = `${id}.md`;
      if (files.includes(fname)) {
        prompts[id] = readFileSync(join(dir, fname), "utf-8");
      }
    }
    return NextResponse.json({ prompts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, prompts: {} }, { status: 500 });
  }
}
