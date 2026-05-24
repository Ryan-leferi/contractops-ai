# 01 — Generic Contract Workflow

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §2. This workflow is universal: every contract type passes through it. Type-specific differences live in the Playbook (see `docs/02_PLAYBOOK_SYSTEM.md`).

## The 22 steps

1. User creates a contract project.
2. User uploads source documents.
3. System creates and locks a Source Pack.
4. System classifies or suggests contract type.
5. Human lawyer confirms contract type.
6. System selects a Contract Playbook.
7. System generates required intake questions from the Playbook.
8. User answers intake questions.
9. AI creates Deal Memo.
10. Human lawyer approves Deal Memo.
11. AI creates Drafting Plan.
12. Human lawyer approves Drafting Plan.
13. GPT drafts v0 contract.
14. Claude reviews from counterparty counsel perspective.
15. Gemini checks source consistency against source documents.
16. GPT checks Korean legal style, structure, definitions, and cross-references.
17. Python deterministic QA checks dates, amounts, cross-references, numbering, version, and forbidden expressions.
18. Findings become Issue Cards.
19. Human lawyer approves, partially approves, rejects, or defers each Issue Card.
20. Revision Agent applies only approved or partially approved Issue Cards.
21. Human lawyer approves final draft.
22. System exports: external clean DOCX, internal legal commentary DOCX, negotiation matrix, cover email draft.

## Traceability

Every substantive contract change must trace to:

1. an Issue Card; and
2. a human lawyer decision.

## Ordering guards enforced in code

These guards are tested by the criteria in `docs/06_ACCEPTANCE_CRITERIA.md`:

- Playbook selection requires confirmed contract type (step 5 before step 6).
- Deal Memo approval requires that all `required_intake_questions` are answered (step 8 before step 10).
- Drafting Plan approval requires an approved Deal Memo (step 10 before step 12).
- v0 draft requires an approved Deal Memo AND an approved Drafting Plan (steps 10 and 12 before step 13).
- Custom Contract mode requires a human-approved Drafting Plan before drafting (PLATFORM_BRIEF.md §3).
- Source Pack lock prevents subsequent source mutation.
- Revision Agent applies only Issue Cards with `human_decision in {accepted, partially_accepted}`.
- Final export requires final human approval (step 21 before step 22).
