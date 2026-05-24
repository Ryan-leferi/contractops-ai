# 06 — Acceptance Criteria

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §2, §3, §5, §8, §9.

Every test below MUST exist as an automated code-level test and MUST remain green at all times. UI-only validation is not sufficient. These tests are the executable specification of the workflow.

Tests reference the data model in `docs/04_DATA_MODEL.md` and the workflow in `docs/01_GENERIC_CONTRACT_WORKFLOW.md`.

---

## §1. Contract type confirmation required before Playbook selection

Given a Project where the human lawyer has not yet confirmed the contract type,
when the system attempts to select a Playbook,
then the selection MUST fail.

Once a human has confirmed the contract type, Playbook selection MUST succeed.

Source: workflow steps 5 → 6.

---

## §2. Custom Contract requires human-approved Drafting Plan

Given a Project in Custom Contract mode (`DraftingPlan.is_custom = true`),
when a v0 draft is requested,
then the request MUST fail unless a DraftingPlan exists AND `approved = true` AND the approver is a human lawyer.

Source: PLATFORM_BRIEF.md §3.

---

## §3. Required intake questions must be answered before Deal Memo approval

Given a Project with a selected Playbook,
when Deal Memo approval is attempted while any `required_intake_questions` has no corresponding IntakeAnswer,
then approval MUST fail.

When every required IntakeQuestion has an IntakeAnswer, approval MUST be allowed.

Source: workflow steps 7–10.

---

## §4. Deal Memo approval required before Drafting Plan approval

Given a Project without an approved DealMemo,
when DraftingPlan approval is attempted,
then approval MUST fail.

Source: workflow steps 10 → 12.

---

## §5. Drafting Plan approval required before v0 draft generation

Given a Project without an approved DraftingPlan,
when v0 draft generation is requested,
then generation MUST fail.

Both an approved DealMemo AND an approved DraftingPlan are required (PLATFORM_BRIEF.md §5 rule 9).

Source: workflow steps 12 → 13.

---

## §6. Rejected Issue Card not applied

Given an IssueCard with `human_decision = rejected`,
when the Revision Agent runs,
then the resulting ContractVersion MUST NOT contain any change derived from that IssueCard,
and the IssueCard's `applied_version` MUST remain unset.

Source: PLATFORM_BRIEF.md §5 rule 5, §8.

---

## §7. Accepted Issue Card applied

Given an IssueCard with `human_decision = accepted`,
when the Revision Agent runs,
then the resulting ContractVersion MUST contain the change described by `recommended_revision`,
and the IssueCard's `applied_version` MUST be set to that new ContractVersion's id.

---

## §8. Partially accepted Issue Card included with partial note

Given an IssueCard with `human_decision = partially_accepted` and a non-empty `partial_note`,
when the Revision Agent runs,
then the resulting ContractVersion MUST contain a change reflecting `partial_note` (not the full `recommended_revision`),
and the IssueCard's `applied_version` MUST be set to that ContractVersion's id,
and the `partial_note` MUST be retrievable for audit.

---

## §9. Source Pack lock prevents source changes

Given a SourcePack with `locked = true`,
when any operation attempts to add, remove, or modify a SourceDocument within that pack,
then the operation MUST fail.

Adding new source material after lock requires a NEW SourcePack.

Source: PLATFORM_BRIEF.md §5 rule 8, §9.

---

## §10. ContractVersion is tied to source_pack_id and playbook_id

Given an attempt to create a ContractVersion,
when `source_pack_id` is missing OR `playbook_id` is missing,
then creation MUST fail.

A ContractVersion record MUST always carry both fields.

Source: PLATFORM_BRIEF.md §9; `docs/04_DATA_MODEL.md`.

---

## §11. Final approval required before final export

Given a ContractVersion with `final = false`,
when an export of kind `clean_docx`, `commentary_docx`, `negotiation_matrix`, or `cover_email` is requested as a final export,
then the export MUST fail.

Final export is allowed only when `final = true`, `final_approved_by` is a human lawyer, and `final_approved_at` is set.

Source: PLATFORM_BRIEF.md §5 rule 3.

---

## §12. Clean / commentary export separation

Given a final-approved ContractVersion,
when both a `clean_docx` and a `commentary_docx` are produced,
then they MUST be produced as distinct ExportArtifact records via separate render paths.

A single artifact MUST NOT contain both audiences.

Source: PLATFORM_BRIEF.md §5 rule 6.

---

## §13. Internal commentary not included in clean export

Given any content tagged as internal commentary (legal commentary, internal note, redline rationale, negotiation guidance, or any field defined as internal-only),
when the `clean_docx` is generated,
then the rendered output MUST NOT contain that content.

This MUST be enforced in code, with an automated test asserting absence in the clean artifact for a fixture that contains commentary.

Source: PLATFORM_BRIEF.md §5 rule 7.

---

## §14. AuditLog created for human decisions

For each of the following human actions, an AuditLog entry MUST be created with `actor`, `timestamp`, `ref_id`, and decision payload:

- project creation;
- source upload;
- Source Pack lock;
- Playbook confirmation;
- Deal Memo approval;
- Drafting Plan approval;
- Issue Card decision (`accepted | partially_accepted | rejected | deferred`);
- revision generation;
- final approval;
- export.

A test MUST assert one AuditLog entry per action, with no duplicates and no omissions.

Source: PLATFORM_BRIEF.md §12 rule 4.
