import { describe, expect, it } from "vitest";
import { loadAllPlaybooks, loadPlaybook } from "./helpers";

describe("Playbook files", () => {
  it("loads and validates all four MVP playbooks", () => {
    const all = loadAllPlaybooks();
    const types = all.map((p) => p.contract_type).sort();
    expect(types).toEqual(["Custom Contract", "Event Booth Entry", "NDA", "Service Agreement"]);
  });

  it("has exactly one Custom Contract sentinel", () => {
    const all = loadAllPlaybooks();
    const customs = all.filter((p) => p.is_custom_marker);
    expect(customs.length).toBe(1);
    expect(customs[0]!.contract_type).toBe("Custom Contract");
  });

  it("each non-custom playbook has at least one required intake question", () => {
    const all = loadAllPlaybooks();
    for (const p of all.filter((p) => !p.is_custom_marker)) {
      expect(p.required_intake_questions.length).toBeGreaterThan(0);
    }
  });

  it("NDA playbook lists term and obligation as mandatory clauses", () => {
    const nda = loadPlaybook("nda.json");
    const keys = nda.mandatory_clauses.map((c) => c.key);
    expect(keys).toContain("obligation");
    expect(keys).toContain("term");
  });
});
