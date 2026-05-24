# 08 — Architecture Decisions

Lightweight ADRs. Each decision derives from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) and is binding until amended.

---

## ADR-001 — Build workflow core and tests before UI

**Source:** PLATFORM_BRIEF.md §13 rule 3.

**Decision:** All workflow rules are implemented as a state machine with tests under TASKS.md Milestone 1 BEFORE any UI page is built.

**Consequence:** UI work is blocked until the workflow tests pass.

---

## ADR-002 — Mock mode is permanent

**Source:** PLATFORM_BRIEF.md §5 rule 12 and §12 rule 8.

**Decision:** Mock mode is a first-class mode of the system. It is not removed when real APIs are integrated.

**Consequence:** Every agent call site must support both real and mock backends behind a single interface.

---

## ADR-003 — Playbooks are data, not code

**Source:** PLATFORM_BRIEF.md §3, §4.

**Decision:** Each Playbook is a file in `playbooks/` loaded at runtime. Workflow code does not reference contract names directly.

**Consequence:** Adding a contract type does not require workflow code changes. Tests assert that workflow modules do not branch on contract-type string literals.

---

## ADR-004 — Issue Cards are the sole channel for substantive revision

**Source:** PLATFORM_BRIEF.md §2 (traceability), §5 rules 4–5, §8.

**Decision:** The Revision Agent reads only IssueCards with `human_decision in {accepted, partially_accepted}`. No other code path may modify a ContractVersion.

**Consequence:** Any new review or QA source must emit Issue Cards. There are no "side-channel" patches.

---

## ADR-005 — Source Pack is immutable once locked

**Source:** PLATFORM_BRIEF.md §5 rule 8, §9.

**Decision:** A locked SourcePack rejects all mutations. New source material requires a new SourcePack.

**Consequence:** Every ContractVersion references a stable SourcePack snapshot.

---

## ADR-006 — ContractVersion is tied to (source_pack_id, playbook_id)

**Source:** PLATFORM_BRIEF.md §9; derived data model in `docs/04_DATA_MODEL.md`.

**Decision:** A ContractVersion record is invalid without both ids. Tests assert this at the persistence layer.

**Consequence:** Reviewing a past contract version always reveals which sources and which Playbook produced it.

---

## ADR-007 — Clean / commentary separation is enforced at the export layer

**Source:** PLATFORM_BRIEF.md §5 rules 6–7.

**Decision:** Two separate render paths produce two separate ExportArtifact records. A test asserts that the clean artifact contains no content tagged as commentary.

**Consequence:** It is not possible to produce a single document that mixes clean and commentary content.

---

## ADR-008 — Deterministic QA is not replaced by LLM review

**Source:** PLATFORM_BRIEF.md §5 rule 13, §7.

**Decision:** Date, amount, cross-reference, numbering, version, and forbidden-expression checks run as Python code, not as LLM prompts.

**Consequence:** Even when LLMs are offline or mocked, deterministic QA still runs.

---

## ADR-009 — BOF is fixture-only

**Source:** PLATFORM_BRIEF.md §10.

**Decision:** A BOF-style fixture may live under `fixtures/` for testing. BOF-specific facts must never appear in platform code.

**Consequence:** A grep for BOF in source code outside `fixtures/` must return nothing of substance.

---

## ADR-010 — Korean drafting conventions are encoded in Playbooks and deterministic QA, not in the workflow

**Source:** PLATFORM_BRIEF.md §5 rule 14, §6.

**Decision:** Korean drafting style (numbering, preferred verbs, forbidden expressions) is encoded in Playbook fields (`drafting_style_notes`, `final_qa_checklist`) and in deterministic QA rules (forbidden expression detection, numbering checks). The workflow itself is language-agnostic.

**Consequence:** Future support for additional jurisdictions adds Playbooks and QA rules; it does not fork the workflow.
