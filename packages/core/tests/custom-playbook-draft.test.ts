import { describe, expect, it } from "vitest";
import { createCustomPlaybookDraft } from "@contractops/core";
import { playbookSchema } from "@contractops/schemas";
import { testEnv } from "./helpers";

describe("createCustomPlaybookDraft (Milestone 1C direct unit test)", () => {
  it("produces a Playbook marked as custom with the given label", () => {
    const env = testEnv();
    const playbook = createCustomPlaybookDraft({
      contract_type_label: "Marketing collaboration",
      env,
    });
    expect(playbook.is_custom_marker).toBe(true);
    expect(playbook.contract_type).toBe("Marketing collaboration");
    expect(playbook.contract_family).toBe("custom");
    expect(playbook.required_intake_questions).toEqual([]);
    expect(playbook.mandatory_clauses).toEqual([]);
  });

  it("validates against the Playbook schema", () => {
    const env = testEnv();
    const playbook = createCustomPlaybookDraft({
      contract_type_label: "Joint research",
      env,
    });
    expect(() => playbookSchema.parse(playbook)).not.toThrow();
  });

  it("generates a fresh id per call", () => {
    const env = testEnv();
    const a = createCustomPlaybookDraft({ contract_type_label: "X", env });
    const b = createCustomPlaybookDraft({ contract_type_label: "Y", env });
    expect(a.id).not.toBe(b.id);
  });
});
