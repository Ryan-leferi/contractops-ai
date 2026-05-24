import { describe, expect, it } from "vitest";
import "./preload-prompts";
import { aggRunDeterministicQA } from "@contractops/core";
import { humanLawyer } from "./helpers";
import { buildToReadyForReviews } from "./scenarios";

/**
 * Milestone 2E — `qa_runs` persistence.
 *
 * Verifies:
 *   - `ProjectState.qa_runs` starts empty.
 *   - Every `aggRunDeterministicQA` call appends one new entry.
 *   - Each entry round-trips through JSON cleanly (localStorage parity).
 *   - Each entry preserves the per-check breakdown so the UI can show
 *     passes and per-check finding counts.
 */

describe("ProjectState.qa_runs persistence", () => {
  it("starts empty for a freshly built scenario", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    expect(ready.s.qa_runs).toEqual([]);
  });

  it("aggRunDeterministicQA appends exactly one entry per call", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dirty = {
      ...ready.s,
      contract_versions: [
        { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목." },
      ],
    };
    const first = aggRunDeterministicQA(dirty, ready.env, humanLawyer);
    expect(first.state.qa_runs.length).toBe(1);

    const second = aggRunDeterministicQA(first.state, ready.env, humanLawyer);
    expect(second.state.qa_runs.length).toBe(2);
  });

  it("each qa_runs entry survives JSON round-trip without data loss", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dirty = {
      ...ready.s,
      contract_versions: [
        { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목과 제99조 참조." },
      ],
    };
    const res = aggRunDeterministicQA(dirty, ready.env, humanLawyer);
    const entry = res.state.qa_runs[0]!;

    const roundTripped = JSON.parse(JSON.stringify(entry));
    expect(roundTripped).toEqual(entry);

    // Per-check breakdown survives.
    expect(roundTripped.checks_run.length).toBeGreaterThan(0);
    for (const c of roundTripped.checks_run) {
      expect(typeof c.check_id).toBe("string");
      expect(typeof c.finding_count).toBe("number");
    }
  });

  it("checks_run records every check that ran (passes vs findings)", async () => {
    const ready = await buildToReadyForReviews("nda.json");
    const dirty = {
      ...ready.s,
      contract_versions: [
        { ...ready.s.contract_versions[0]!, content: "제1조 (목적)\n기타 항목." },
      ],
    };
    const res = aggRunDeterministicQA(dirty, ready.env, humanLawyer);
    const entry = res.state.qa_runs[0]!;
    const passes = entry.checks_run.filter((c) => c.finding_count === 0).length;
    const findings = entry.checks_run.filter((c) => c.finding_count > 0).length;
    expect(passes + findings).toBe(entry.checks_run.length);
    expect(findings).toBeGreaterThan(0); // 기타 → forbidden_expressions
  });
});
