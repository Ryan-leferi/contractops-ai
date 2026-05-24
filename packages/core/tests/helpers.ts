import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Actor, Playbook } from "@contractops/schemas";
import { playbookSchema } from "@contractops/schemas";
import {
  type Env,
  createCounterIdGenerator,
  createFixedClock,
} from "@contractops/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const playbooksDir = resolve(__dirname, "../../../playbooks");

export const humanLawyer: Actor = {
  id: "lawyer_kim",
  role: "human_lawyer",
  display_name: "Kim 변호사",
};

export const otherLawyer: Actor = {
  id: "lawyer_park",
  role: "human_lawyer",
  display_name: "Park 변호사",
};

export const user: Actor = {
  id: "user_choi",
  role: "user",
  display_name: "Choi 사원",
};

export const nonLawyer: Actor = {
  id: "intern_lee",
  role: "user",
  display_name: "Lee 인턴",
};

export function testEnv(): Env {
  return {
    newId: createCounterIdGenerator("t"),
    now: createFixedClock("2026-01-01T00:00:00.000Z"),
  };
}

export function loadPlaybook(file: string): Playbook {
  const json = JSON.parse(readFileSync(resolve(playbooksDir, file), "utf-8"));
  return playbookSchema.parse(json);
}

export function loadAllPlaybooks(): Playbook[] {
  const files = readdirSync(playbooksDir).filter((f) => f.endsWith(".json"));
  return files.map((f) => loadPlaybook(f));
}
