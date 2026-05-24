# 07 — Development Roadmap

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §11 (MVP scope) and §13 (Development principles). For the active task list, see [TASKS.md](../TASKS.md).

## Principles (PLATFORM_BRIEF.md §13)

1. Build a generic platform, not a single-contract generator.
2. Build mock MVP first.
3. Implement Workflow Core and tests BEFORE UI.
4. Do not connect real LLM APIs until the mock workflow passes.
5. Do not implement real DOCX export until workflow and Issue Card logic pass.
6. Use tests to enforce legal workflow rules.
7. Build small milestones.
8. Avoid overengineering.
9. Avoid building a full contract editor in MVP.
10. Do not add dependencies without explaining why.

## Phase map

| Phase | Goal | Reference |
|-------|------|-----------|
| Phase 0 | Repository scaffolding | TASKS.md Milestone 0 |
| Phase 1 | Workflow core and tests, no UI | TASKS.md Milestone 1 |
| Phase 2 | Mock end-to-end workflow | TASKS.md Milestone 2 |
| Phase 3 | Issue Tracker and human decisions | TASKS.md Milestone 3 |
| Phase 4 | Revision Agent and final approval | TASKS.md Milestone 4 |
| Phase 5 | Export (clean / commentary separation) | TASKS.md Milestone 5 |

## Post-MVP candidates (NOT in scope until MVP closes)

Per PLATFORM_BRIEF.md §11:

- Real GPT / Claude / Gemini API calls.
- Real DOCX export beyond MVP placeholders.
- External sending.
- Full Word-like editor.
- n8n integration.
- LangGraph integration.
- SharePoint integration.
- Electronic signature integration.

## What "done" means at MVP

A reference fixture (synthetic or sanitized) can be driven from project creation through mock final draft and into export artifacts (placeholder format acceptable) without changes to workflow code, with all acceptance criteria in `docs/06_ACCEPTANCE_CRITERIA.md` green.
