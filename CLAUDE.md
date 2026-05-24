# CLAUDE.md — Instructions for Claude Code

These instructions apply specifically to Claude Code working in this repository. For tool-neutral guardrails that apply to all coding agents (Cursor, Copilot, Codex, Aider, etc.), see [AGENTS.md](AGENTS.md).

## 1. Read these before writing any code

On every new task, read in this order:

1. [PLATFORM_BRIEF.md](PLATFORM_BRIEF.md) — the single source of truth.
2. [AGENTS.md](AGENTS.md) — tool-neutral guardrails.
3. [README.md](README.md) — repo overview.
4. [TASKS.md](TASKS.md) — current milestone scope.
5. Every file in `docs/`.
6. [playbooks/README.md](playbooks/README.md) and [fixtures/README.md](fixtures/README.md).

Do not start coding until you have read these. If files have changed since your last task, re-read them.

## 2. Plan before you edit

For any non-trivial change, write a short plan first that names:

- which milestone in TASKS.md the change belongs to;
- which acceptance criterion in `docs/06_ACCEPTANCE_CRITERIA.md` the change advances;
- which files you will touch;
- any contradiction with PLATFORM_BRIEF.md (stop if found).

If your plan would change behavior outside the current milestone, ask first.

## 3. Use the existing data model

Use the entities defined in `docs/04_DATA_MODEL.md`. Do not invent parallel data structures. If the data model is missing something, propose an update to `docs/04_DATA_MODEL.md` before adding new fields.

## 4. Enforce workflow rules with tests

Every workflow rule listed in `docs/06_ACCEPTANCE_CRITERIA.md` must be enforced by an automated test, not just by UI flow. When adding workflow code, add or update the corresponding test in the same change.

## 5. Mock first

Until TASKS.md authorizes real LLM calls (post-MVP), all agent calls are mocks that return canned, deterministic outputs. Mock mode must remain operable even after real APIs are wired (PLATFORM_BRIEF.md §5 rule 12).

## 6. Generic, not BOF-shaped

Workflow code must never branch on a specific contract name (NDA, Booth, Service, BOF, etc.). All contract-type-specific behavior lives in Playbook files under `playbooks/`. See ADR-003 and ADR-009 in `docs/08_ARCHITECTURE_DECISIONS.md`.

## 7. Output style

- Short responses.
- Reference files as clickable paths (e.g., `docs/06_ACCEPTANCE_CRITERIA.md:42`).
- Surface any contradiction with PLATFORM_BRIEF.md immediately.

## 8. Do not

- Do not hardcode API keys.
- Do not commit confidential documents.
- Do not add dependencies without explaining why in the PR description.
- Do not bypass Issue Card logic to apply a change.
- Do not build a full contract editor in MVP.
- Do not start a milestone that has unmet prerequisites in TASKS.md.

## 9. When the user is exploratory

If a request is exploratory ("what should we do about X?"), respond with a short recommendation and the main tradeoff. Do not implement until the user picks a direction.
