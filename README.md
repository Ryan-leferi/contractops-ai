# ContractOps AI

ContractOps AI is a browser-based web application for Korean in-house legal teams to create, review, revise, QA, annotate, and negotiate many types of contracts using multiple AI models in a controlled workflow.

It is a **generic contract automation platform**, not a single-contract generator.

AI drafts and reviews. The human lawyer decides and approves.

## Status

Pre-MVP. The repository currently holds context and guardrail documents only. See [TASKS.md](TASKS.md) for the active milestone.

## Single source of truth

[PLATFORM_BRIEF.md](PLATFORM_BRIEF.md) is the authoritative product specification. All other documents derive from it. If a derived document contradicts the brief, the brief wins.

## How to read this repository

1. [PLATFORM_BRIEF.md](PLATFORM_BRIEF.md) — product brief.
2. [AGENTS.md](AGENTS.md) — guardrails for any coding agent.
3. [CLAUDE.md](CLAUDE.md) — Claude Code-specific guidance.
4. [TASKS.md](TASKS.md) — milestones.
5. `docs/` — product context, workflow, playbook system, agent roles, data model, security, acceptance criteria, roadmap, architecture decisions.
6. `playbooks/` — Playbook files (data, not code).
7. `fixtures/` — synthetic or sanitized reference fixtures.

## Repository layout (planned)

- [docs/](docs/) — derived documentation.
- [playbooks/](playbooks/) — Contract Playbook definitions (one file per contract type). See [playbooks/README.md](playbooks/README.md).
- [fixtures/](fixtures/) — synthetic test fixtures. See [fixtures/README.md](fixtures/README.md).

Application directories (workflow core, tests, UI, etc.) will be added as the relevant milestone begins. No application code exists yet.

## Mock mode

Mock mode is mandatory and must remain operable even after real LLM APIs are integrated. See PLATFORM_BRIEF.md §12 and [docs/05_SECURITY_AND_CONFIDENTIALITY.md](docs/05_SECURITY_AND_CONFIDENTIALITY.md).

## Hard rules

- AI does not make final decisions.
- Every substantive change traces to an Issue Card with a human decision.
- Source Pack is locked for a final ContractVersion.
- Internal commentary is never included in the external clean export.

See PLATFORM_BRIEF.md §5 for the full list of non-negotiable rules.
