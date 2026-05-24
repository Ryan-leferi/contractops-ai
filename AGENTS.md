# AGENTS.md — Guardrails for All Coding Agents

This file applies to every coding agent (Claude Code, Cursor, Copilot, Codex, Aider, etc.) working in this repository.

For Claude Code-specific instructions, see [CLAUDE.md](CLAUDE.md).

## 1. Read before acting

Before writing or modifying code, read:

1. [PLATFORM_BRIEF.md](PLATFORM_BRIEF.md) — single source of truth
2. AGENTS.md (this file)
3. [TASKS.md](TASKS.md) — current milestone scope
4. [README.md](README.md)
5. `docs/00_PRODUCT_CONTEXT.md` through `docs/08_ARCHITECTURE_DECISIONS.md`
6. [playbooks/README.md](playbooks/README.md)
7. [fixtures/README.md](fixtures/README.md)

PLATFORM_BRIEF.md overrides anything else. If a derived document contradicts the brief, the brief wins.

## 2. What this product is

ContractOps AI is a generic contract automation platform for Korean in-house legal teams. It supports many contract types via Playbooks. AI drafts and reviews; a human lawyer decides.

## 3. What this product is NOT

- Not a single-contract generator.
- Not a BOF tool. BOF is a sanitized reference fixture only.
- Not a general chatbot.
- Not an autonomous legal decision-maker.

## 4. Hard rules (do not break)

1. AI must not make final legal decisions.
2. AI must not externally send a contract.
3. AI must not mark a contract as final without human approval.
4. Every substantive change must trace to an Issue Card with a human decision.
5. Rejected Issue Cards must never be applied.
6. External clean version and internal commentary must be separated.
7. Source Pack must be locked for a final ContractVersion.
8. v0 draft requires approved Deal Memo AND approved Drafting Plan.
9. No hardcoded API keys.
10. No confidential documents in tests or fixtures.
11. Mock mode must exist even after real API integration.
12. Deterministic QA must not be replaced by LLM review.
13. Do not hardcode BOF facts into platform logic.
14. Do not invent requirements that are not in PLATFORM_BRIEF.md.

## 5. Build order

1. Workflow core and tests first (no UI).
2. Mock workflow end-to-end before any real LLM call.
3. Real DOCX export only after Issue Card logic passes.
4. Acceptance tests in `docs/06_ACCEPTANCE_CRITERIA.md` must remain green.

## 6. Out of scope for MVP

Do not build: real GPT/Claude/Gemini API calls, real DOCX export, external sending, full Word-like editor, n8n, LangGraph, SharePoint, e-signature integration.

## 7. Generic platform discipline

- Playbooks are data, not code.
- Adding a new contract type means adding a Playbook file, not editing workflow code.
- Workflow logic must not reference any specific contract type by name.

## 8. Confidentiality

- Use synthetic or sanitized fixtures only.
- Internal commentary outputs are confidential and must never appear in external clean exports.
- See PLATFORM_BRIEF.md §12 and `docs/05_SECURITY_AND_CONFIDENTIALITY.md`.

## 9. When unsure

If a request appears to conflict with PLATFORM_BRIEF.md, stop and ask. Do not invent behavior.
