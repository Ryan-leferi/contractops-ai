# Playbooks

Contract Playbooks are stored here, one per file. Playbooks are **data, not code**: adding a new contract type means adding a file here, not modifying workflow code. See [docs/02_PLAYBOOK_SYSTEM.md](../docs/02_PLAYBOOK_SYSTEM.md).

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

## MVP set (PLATFORM_BRIEF.md §4)

1. NDA
2. Service Agreement (업무위탁계약)
3. Event Booth Entry (행사 부스 입점계약)
4. Custom Contract

Files are not yet written; they will be added in [TASKS.md](../TASKS.md) Milestone 2.

## Custom Contract mode

If a project's contract type does not match any Playbook, the workflow falls back to Custom Contract mode. In that mode the system MAY propose a temporary Drafting Plan, but a human lawyer MUST approve it before drafting. See `docs/06_ACCEPTANCE_CRITERIA.md` test §2.

## Rules

- Workflow code MUST NOT branch on a specific `contract_type` value.
- Korean drafting conventions belong in `drafting_style_notes` and in deterministic QA rules, not in workflow code (see ADR-010 in `docs/08_ARCHITECTURE_DECISIONS.md`).
- A Playbook MUST NOT embed confidential source content.
