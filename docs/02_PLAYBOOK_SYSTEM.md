# 02 — Playbook System

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §3, §4. Playbooks are the mechanism that makes this platform generic: adding a new contract type is a data change, not a code change.

## What a Playbook is

A Contract Playbook is a reusable drafting and review guide for a contract type.

## Required fields

Each Playbook MUST define (PLATFORM_BRIEF.md §3):

1. `contract_type`
2. `contract_family`
3. `legal_characterization`
4. `required_intake_questions`
5. `optional_intake_questions`
6. `default_table_of_contents`
7. `mandatory_clauses`
8. `optional_clauses`
9. `common_risks`
10. `red_flags`
11. `source_document_expectations`
12. `drafting_style_notes`
13. `negotiation_positions`
14. `fallback_clauses`
15. `final_qa_checklist`

## Why this makes the platform generic

Workflow code does not branch on contract names. It branches on Playbook fields. Concretely:

- **Step 6 (Playbook selection)** loads a file from `playbooks/`. The workflow does not know the contract type at compile time.
- **Step 7 (intake questions)** reads `required_intake_questions` and `optional_intake_questions` from the loaded Playbook. The intake form is rendered from the Playbook, not from hard-coded forms.
- **Step 11 (Drafting Plan)** consumes `default_table_of_contents`, `mandatory_clauses`, `optional_clauses`, `drafting_style_notes`, `negotiation_positions`, and `fallback_clauses`.
- **Steps 14–17 (reviews and QA)** consult `common_risks`, `red_flags`, `source_document_expectations`, and `final_qa_checklist`.

Adding a new contract type therefore means writing a new Playbook file and (optionally) supplying fixtures. No change to workflow code. No new state machine. No new entity.

This generic discipline is asserted by ADR-003 in `docs/08_ARCHITECTURE_DECISIONS.md`.

## Custom Contract mode

If no suitable Playbook exists, the system uses Custom Contract mode.

In Custom Contract mode the system MAY propose a temporary Drafting Plan, but a human lawyer MUST approve it before drafting. See `docs/06_ACCEPTANCE_CRITERIA.md` test §2.

## MVP Playbooks (PLATFORM_BRIEF.md §4)

1. NDA
2. Service Agreement (업무위탁계약)
3. Event Booth Entry (행사 부스 입점계약)
4. Custom Contract

The system must support adding more Playbooks later without code changes.

## Where Playbooks live

`playbooks/`. See [playbooks/README.md](../playbooks/README.md).
