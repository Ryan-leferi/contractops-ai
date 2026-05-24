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

## Mock mode (default)

Mock mode is the default and is mandatory — it must remain operable even after real LLM APIs are integrated. See PLATFORM_BRIEF.md §12 and [docs/05_SECURITY_AND_CONFIDENTIALITY.md](docs/05_SECURITY_AND_CONFIDENTIALITY.md).

```bash
npm install
npm test                           # core acceptance tests
npm run fixture                    # end-to-end CLI walk against the synthetic fixture
npm run dev -w @contractops/web    # http://localhost:3000
npm run e2e -w @contractops/web    # Playwright (mock-mode)
```

The "LLM mode: MOCK" badge in the app header confirms the default build.

## Real mode (Milestone 2E — OpenAI Deal Memo + Claude Counterparty Reviewer)

> **Warning.** Do not paste real confidential source documents into the UI or fixture during real-mode testing. Use sanitized or synthetic text only. The brief's §10 and §12 rules apply.

Two real-provider seams are live:

| Role | Provider | Server route | Status |
|---|---|---|---|
| `deal_memo_drafter` | OpenAI | `/api/agent/deal-memo` | Milestone 2C |
| `counterparty_reviewer` | Anthropic (Claude) | `/api/agent/counterparty-reviewer` | Milestone 2E |

All other six roles stay on the in-browser mock. API keys live ONLY on the server — the browser uses fetch-only proxy providers.

Copy `.env.example` to `.env.local` and configure (enable one or both):

```
USE_REAL_LLM=true

# OpenAI for Deal Memo drafter
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Anthropic for counterparty reviewer
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Allow both providers (comma-separated). Real mode refuses to start without this.
LLM_PROVIDER_ALLOWLIST=openai,anthropic

# Client mirrors (no secrets here)
NEXT_PUBLIC_USE_REAL_LLM=true
NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST=openai,anthropic
NEXT_PUBLIC_LLM_MODE=REAL
NEXT_PUBLIC_LLM_PROVIDER_ID=mixed
NEXT_PUBLIC_OPENAI_MODEL=gpt-4o-mini
NEXT_PUBLIC_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

- `USE_REAL_LLM=false` + any API key present → mock provider is still returned. No silent escalation.
- `USE_REAL_LLM=true` without `LLM_PROVIDER_ALLOWLIST` → clean error.
- `USE_REAL_LLM=true` with a provider allowlisted but its API key missing → clean error.
- Each role only escalates when (a) its provider is allowlisted AND (b) the matching `NEXT_PUBLIC_*` mirror agrees. The server independently verifies again inside its API route — `USE_REAL_LLM=false` on the server returns HTTP 503 even if the client tries to call.

Gated end-to-end run against the real Deal Memo drafter:

```bash
E2E_REAL_OPENAI=true USE_REAL_LLM=true OPENAI_API_KEY=sk-... \
  LLM_PROVIDER_ALLOWLIST=openai \
  NEXT_PUBLIC_USE_REAL_LLM=true NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST=openai \
  npm run e2e -w @contractops/web
```

`E2E_REAL_OPENAI=true` is the only way the optional real-OpenAI Playwright spec runs. CI keeps the variable unset.

## Deterministic QA

The deterministic QA engine (`packages/core/src/qa/`) is **code-based** — no LLM, no provider, no network. It runs on the final-QA step before the LLM `final_qa_assistant`, produces Issue Cards with `source_agent = "deterministic_qa"`, and emits a `deterministic_qa_run` audit entry. See [docs/03_AGENT_ROLES.md](docs/03_AGENT_ROLES.md#python-qa-deterministic-not-llm) for the check list.

Three non-replacement rules:

- Deterministic QA does **not** replace a human lawyer (lawyer decides every finding).
- Deterministic QA does **not** replace LLM review (LLM `final_qa_assistant` still runs).
- LLM review does **not** replace deterministic QA (PLATFORM_BRIEF.md §5 rule 13).

## Hard rules

- AI does not make final decisions.
- Every substantive change traces to an Issue Card with a human decision.
- Source Pack is locked for a final ContractVersion.
- Internal commentary is never included in the external clean export.

See PLATFORM_BRIEF.md §5 for the full list of non-negotiable rules.
