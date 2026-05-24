# TASKS.md

This file lists the active milestones. PLATFORM_BRIEF.md is the source of truth; this file decomposes it into shippable units.

Milestones are sequential. Do not start a milestone whose prerequisites are not complete and tested.

---

## Milestone 0 — Repository scaffolding

Goal: a checked-in skeleton that holds future work without committing to framework decisions the brief did not require.

Includes:

- Directory layout for: workflow core, playbooks, fixtures, docs, tests, mock data.
- Lint / format / test runners chosen and configured.
- Mock-mode flag wired into a config loader (no secrets are read yet).
- CI placeholder: tests run on every PR.
- Initial empty Playbook and Fixture indexes.

Exit criteria:

- All files listed in the project context exist.
- CI runs and shows green on an empty test suite.
- No application logic, no UI.

---

## Milestone 1 — Workflow core (no UI)

Goal: implement and test the universal workflow data model and state machine. Reference: `docs/01_GENERIC_CONTRACT_WORKFLOW.md`, `docs/04_DATA_MODEL.md`.

### 1A — Data model and persistence

- Implement entities: Project, SourceDocument, SourcePack, Playbook, IntakeQuestion, IntakeAnswer, DealMemo, DraftingPlan, ContractVersion, IssueCard, AuditLog, ExportArtifact.
- In-memory or local persistence behind a repository interface.
- Invariants enforced at the data layer:
  - locked SourcePack rejects mutations;
  - ContractVersion requires both `source_pack_id` and `playbook_id`;
  - AuditLog is append-only.

### 1B — State machine and guards

- Enforce ordering from PLATFORM_BRIEF.md §2 (the 22 steps).
- Implement every acceptance test in `docs/06_ACCEPTANCE_CRITERIA.md`.

Exit criteria:

- All acceptance tests in `docs/06_ACCEPTANCE_CRITERIA.md` pass.
- No UI, no LLM call, no DOCX writing.

---

## Milestone 2 — Mock workflow end-to-end

Goal: full mock walkthrough of the 22-step workflow.

- Mock classifier suggests contract type.
- Playbook loader reads files from `playbooks/` as data.
- Intake question generation from Playbook fields.
- Mock Deal Memo, mock Drafting Plan, mock v0 draft.
- Mock multi-model reviews produce canned Issue Cards.
- Mock deterministic QA produces canned Issue Cards.
- Minimal scriptable harness (CLI or test driver) to run the workflow.
- Author the four MVP Playbooks (NDA, Service Agreement, Event Booth Entry, Custom Contract).
- Author the synthetic BOF reference fixture.

Exit criteria:

- A reference fixture (sanitized) can run from creation to mock final draft without code change.
- The Custom Contract path also runs end-to-end (with a human-approved Drafting Plan).

---

## Milestone 3 — Issue Tracker and human decisions

Goal: Issue Card lifecycle and human decision logging.

- Decision states: `pending` → `accepted` | `partially_accepted` | `rejected` | `deferred`.
- Partial acceptance carries a `partial_note` that is preserved through revision.
- AuditLog entries created for every human decision (PLATFORM_BRIEF.md §12 rule 4).
- Reporting view: count of issues by severity and decision.

Exit criteria:

- Acceptance tests §6, §7, §8 pass (Issue Card application behavior).
- Acceptance test §14 passes (AuditLog created for human decisions).

---

## Milestone 4 — Revision Agent and final approval

Goal: apply only accepted or partially accepted Issue Cards.

- Revision Agent reads approved Issue Cards and produces a new ContractVersion.
- Rejected and deferred Issue Cards never modify the draft.
- Partially accepted Issue Cards carry their `partial_note` into the revision.
- Final approval action by a human lawyer is required and logged.

Exit criteria:

- All Issue Card application acceptance tests (§6, §7, §8) pass end-to-end.
- Acceptance test §11 passes (final approval required before final export).

---

## Milestone 5 — Export (clean / commentary separated)

Goal: produce the four MVP export artifacts.

- External clean DOCX (placeholder format acceptable in MVP).
- Internal legal commentary DOCX.
- Negotiation matrix.
- Cover email draft.

Hard rule: internal commentary must never appear in the clean export (PLATFORM_BRIEF.md §5 rule 7). Enforce in code AND in test.

Exit criteria:

- Acceptance tests §12 and §13 pass (clean / commentary separation; internal commentary absent from clean export).
- Acceptance test §11 passes (final approval before export).

---

## Out of scope (do not start)

Real GPT/Claude/Gemini APIs, real DOCX rendering beyond MVP placeholders, external sending, full editor, n8n, LangGraph, SharePoint, e-signature.
