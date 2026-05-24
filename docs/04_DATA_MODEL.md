# 04 — Data Model

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §2, §3, §8, §9, §12.

Entities below are the canonical entities. Code MUST use these and not parallel structures. Fields marked **(derived)** are not literal in PLATFORM_BRIEF.md but are required to satisfy a brief-mandated behavior, and are noted as such.

## Project

- `id`
- `name`
- `created_at`
- `created_by`
- `state` — workflow step pointer **(derived; needed to enforce ordering in §2)**

## SourceDocument

Fields from PLATFORM_BRIEF.md §9:

- `id`
- `project_id`
- `file_name`
- `upload_date`
- `source_type` — one of: `proposal | email | term_sheet | quote | existing_contract | operation_guide | policy | internal_memo | counterparty_request | redline_draft`
- `version`
- `incorporated` (bool) — whether this document is incorporated into the contract
- `source_priority`

## SourcePack

- `id`
- `project_id`
- `locked` (bool)
- `locked_at`
- `document_ids` — ordered list of SourceDocument ids

Once `locked = true`, the pack is immutable. Subsequent additions create a NEW SourcePack.

## Playbook

Fields from PLATFORM_BRIEF.md §3:

- `id`
- `contract_type`
- `contract_family`
- `legal_characterization`
- `required_intake_questions`
- `optional_intake_questions`
- `default_table_of_contents`
- `mandatory_clauses`
- `optional_clauses`
- `common_risks`
- `red_flags`
- `source_document_expectations`
- `drafting_style_notes`
- `negotiation_positions`
- `fallback_clauses`
- `final_qa_checklist`

## IntakeQuestion

- `id`
- `playbook_id`
- `text`
- `required` (bool)

## IntakeAnswer

- `id`
- `project_id`
- `question_id`
- `value`
- `answered_by`
- `answered_at`

## DealMemo

- `id`
- `project_id`
- `content`
- `approved` (bool)
- `approved_by`
- `approved_at`

## DraftingPlan

- `id`
- `project_id`
- `content`
- `approved` (bool)
- `approved_by`
- `approved_at`
- `is_custom` (bool) **(derived; true if Custom Contract mode — required to enforce PLATFORM_BRIEF.md §3)**

## ContractVersion

- `id`
- `project_id`
- `source_pack_id` — required
- `playbook_id` — required
- `version_number` — `v0`, `v1`, ...
- `content`
- `created_by_agent`
- `created_at`
- `final` (bool)
- `final_approved_by`
- `final_approved_at`

A ContractVersion is invalid without both `source_pack_id` and `playbook_id`. See `docs/06_ACCEPTANCE_CRITERIA.md` test §10.

## IssueCard

Fields from PLATFORM_BRIEF.md §8:

- `issue_id`
- `project_id`
- `source_agent`
- `severity` — `critical | high | medium | low`
- `location` — article, paragraph, item
- `issue_type`
- `problem`
- `why_it_matters`
- `recommended_revision`
- `business_impact`
- `recommended_action` — `accept | revise | reject | defer`
- `human_decision` — `pending | accepted | partially_accepted | rejected | deferred`
- `partial_note` **(derived; needed for the "partially accepted" path required by `docs/06_ACCEPTANCE_CRITERIA.md` test §8)**
- `applied_version`

No substantive revision may be applied unless `human_decision` is `accepted` or `partially_accepted`. Rejected Issue Cards must never be applied.

## AuditLog

Append-only. One entry per auditable event. Derived from PLATFORM_BRIEF.md §12 rule 4.

- `id`
- `project_id`
- `actor` — user id or `system`
- `event_type` — one of:
  - `project_created`
  - `source_uploaded`
  - `source_pack_locked`
  - `playbook_confirmed`
  - `deal_memo_approved`
  - `drafting_plan_approved`
  - `issue_card_decided`
  - `revision_generated`
  - `final_approved`
  - `exported`
- `ref_id` — target entity id
- `timestamp`
- `payload` — decision details

## ExportArtifact

- `id`
- `project_id`
- `contract_version_id` — MUST reference a final-approved ContractVersion
- `kind` — `clean_docx | commentary_docx | negotiation_matrix | cover_email`
- `created_at`
- `created_by`
- `file_ref`

Clean and commentary artifacts MUST be produced from separate render paths. See `docs/06_ACCEPTANCE_CRITERIA.md` tests §12 and §13.
