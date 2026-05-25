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

## Exports (Milestones 3A + 3B)

Once a `ContractVersion` is final-approved, the **Exports** page offers all four MVP export downloads. Each one is generated server-side, streamed back as bytes, and never written to disk:

| Type | Audience | Format | File name pattern |
|---|---|---|---|
| `clean_docx` | external | `.docx` | `<project>_<version>_clean.docx` |
| `cover_email` | external | `.md` | `<project>_<version>_cover_email.md` |
| `commentary_docx` | internal | `.docx` | `<project>_<version>_commentary_INTERNAL.docx` |
| `negotiation_matrix` | internal | `.docx` | `<project>_<version>_negotiation_matrix_INTERNAL.docx` |

### How each one is built

- **Clean DOCX** — `packages/core/src/export-renderer/build-clean.ts`. Project name, contract version, body, source pack id, playbook id, simple signature block. Refuses to render if the contract body itself contains any internal-commentary marker (`법무주석`, `[COMMENTARY]`, `[INTERNAL]`, `[REDLINE_RATIONALE]`, `[NEGOTIATION_GUIDANCE]`, `internal legal commentary`). PLATFORM_BRIEF.md §5 rules 6/7.
- **Cover email (.md)** — `packages/core/src/export-renderer/build-cover-email.ts`. Polite Korean business email draft referencing the contract type, version, and source pack ids. Carries NO Issue Card content, NO commentary, NO negotiation guidance. Same forbidden-marker scrub as the clean DOCX. The body explicitly states **"시스템은 이메일을 자동 발송하지 않습니다 / The system does NOT auto-send"** — PLATFORM_BRIEF.md §5 rule 2 (no external sending).
- **Commentary DOCX** — `packages/core/src/export-renderer/build-commentary.ts`. INTERNAL ONLY banner + footer, contract body, full Issue Card decision trail (including rejected cards), deterministic-QA summary, AgentRun / provider summary.
- **Negotiation matrix DOCX** — `packages/core/src/export-renderer/build-negotiation-matrix.ts`. INTERNAL ONLY banner + decision summary (counts by `accepted/partially_accepted/rejected/deferred/pending`) + per-card matrix (id, severity, decision, location, problem, recommended revision, partial note, derived response position) + Playbook negotiation_positions and common_risks.

### How the bytes flow

1. The browser POSTs the current `ProjectState` and the chosen `export_type` to **`POST /api/exports/render`** (`packages/web/app/api/exports/render/route.ts`).
2. The route re-validates the final-approval guard server-side, dispatches to the matching render method on `createExportRenderer()`, and streams back the bytes with the renderer's `mime_type` and a `Content-Disposition: attachment; filename="…"` header.
3. The browser turns the response into a `Blob`, triggers a download via a temporary `<a>`, and records an `ExportFile` + `AuditLog` entry locally with metadata (file name, source pack id, playbook id). **Binary bytes are never stored in `ProjectState` or `localStorage`.**

### Hard rules enforced in code AND in tests

- The `docx` npm package is server-only. The webpack alias `docx: false` keeps it out of the client bundle; an SDK-isolation test (`packages/core/tests/no-sdk-imports.test.ts`) fails the build if any client component imports `docx` or the `@contractops/core/export-renderer` subpath.
- Clean DOCX **and** cover email MUST NOT contain any forbidden internal-commentary marker — asserted by `packages/core/tests/export-renderer.test.ts` and by `packages/web/e2e/exports.spec.ts` (which unzips DOCX files and decodes Markdown to grep the bytes).
- Commentary DOCX **and** negotiation matrix DOCX both carry the `INTERNAL ONLY — 내부 법무 검토 전용` banner and footer.
- Rejected Issue Cards never appear in the clean DOCX or cover email — neither emits Issue Card text at all. The negotiation matrix DOES include rejected cards (full decision trail is the point).
- Exports are generated **in memory only**. Nothing is written to disk on the server. Nothing is sent externally.

### To generate locally

```bash
npm install
npm run dev -w @contractops/web    # http://localhost:3000
# Walk the mock workflow up to final approval, then click each of the four
# buttons on /projects/<id>/exports. Your browser will download:
#   <project>_<version>_clean.docx
#   <project>_<version>_cover_email.md
#   <project>_<version>_commentary_INTERNAL.docx
#   <project>_<version>_negotiation_matrix_INTERNAL.docx
```

`*.docx` and `*_cover_email.md` are gitignored, and `npm run repo:hygiene` refuses to allow a tracked artifact of either shape. Generated exports from local runs land in your Downloads folder; never commit them. Ordinary documentation Markdown files (`README.md`, `CLAUDE.md`, `docs/*.md`) remain trackable — only the renderer-suffixed `*_cover_email.md` is treated as a generated artifact.

## Issue Tracker (Milestone 3C)

The `/projects/[id]/issues` page is the legal review and negotiation control surface. After "Run mock reviews" seeds Issue Cards from the Playbook + deterministic QA, the page exposes:

- **Review dashboard** — eight count cards (total, pending, accepted, partial, rejected, deferred, critical/high, deterministic-QA findings) plus a "real-provider AgentRuns" line and a yellow "⚠ N pending — final approval is blocked" banner when applicable. Counts are computed by `dashboardCounts(cards, agent_runs, qa_runs)` in `packages/core/src/issue-tracker.ts` and unit-tested in `packages/core/tests/issue-tracker.test.ts`.
- **Filters** — severity (critical/high/medium/low), decision (pending/accepted/partially_accepted/rejected/deferred), source agent, issue type, plus a text search that scans `problem + recommended_revision + why_it_matters + business_impact`. Filter state is local UI state only — not persisted in this milestone.
- **Sort** — `pending first → severity high → low` (default), severity, newest/oldest decided first, or decision status. Undecided cards always fall to the bottom of newest/oldest orderings.
- **Per-card decision history toggle** — every Issue Card row has a `Decision history (N)` toggle. Opening it shows the append-only `previous → new`, actor + role, timestamp, partial note, and reason note for every change. Hidden by default; testid `history-toggle-<issue_id>`.
- **Optional reason note** — the pending decision form has an "Optional reason note" input; decided cards have a `Change decision` `<details>` block to re-decide with a fresh reason note. Reason note is **never required** (PLATFORM_BRIEF.md §5 has no such mandate). `partial_note` remains required for `partially_accepted`.

### Decision history is internal

Decision history entries live in `ProjectState.decision_history` and are **append-only** — `aggDecideIssue` appends a new `IssueDecisionHistoryEntry` on every change and never mutates or removes earlier entries. They are **internal legal workflow data**:

- the commentary DOCX and the negotiation matrix DOCX may render them (they are internal exports);
- the clean DOCX and the cover email Markdown **MUST NOT** — the renderers in `packages/core/src/export-renderer/build-clean.ts` and `build-cover-email.ts` self-scrub against forbidden markers, and the `packages/web/e2e/exports.spec.ts` spec unzips the binary to assert absence.

### Traceability rules still hold

- Every substantive change traces to an Issue Card with a human decision (PLATFORM_BRIEF.md §5 rule 4) — the audit log still captures `issue_card_decided` per change, plus the new `previous_decision` / `reason_note` payload fields.
- Rejected Issue Cards are **never applied** to a revision (§5 rule 5) — enforced by `buildRevisionInputFromIssueCards` and asserted by the four-group revision preview on `/projects/[id]/qa` (`summarizeRevisionInput`).
- Final approval refuses to run while any Issue Card is pending — `aggApproveFinal` throws on pending > 0, and the QA page disables the Approve button.

## Verification gate (Milestone 2F)

GitHub Actions runs `.github/workflows/ci.yml` on every push and pull request. CI is the **required green-bar gate** for merging into `main`. It runs in **mock mode only** — no real LLM API keys are configured in CI, and the workflow explicitly sets `USE_REAL_LLM=false` and `E2E_REAL_OPENAI=false` so no real-provider path can accidentally execute.

The CI gate runs, in order:

1. `npm ci`
2. `npm test` — Vitest suite (acceptance, provider, agent, deterministic-QA, SDK-isolation).
3. `npm exec tsc -- --noEmit` — TypeScript typecheck across the monorepo.
4. `npm run build -w @contractops/web` — Next.js production build (verifies the client bundle never imports `openai` or `@anthropic-ai/sdk`).
5. `npm run fixture` — CLI walkthrough against the synthetic Booth fixture.
6. `npm run e2e -w @contractops/web` — Playwright (Chromium, mock-mode). The gated `real-openai-deal-memo.spec.ts` auto-skips because `E2E_REAL_OPENAI` is unset.
7. `npm run repo:hygiene` — fails if any forbidden path (`.next`, `node_modules`, `test-results`, `playwright-report`, `.env`, `.env.local`, …) is tracked or staged, or if any tracked file contains a real-shaped API key (`sk-…`, `sk-ant-…`, `AIza…`) or PEM private key block. `.env.example` is allowlisted; strings that contain markers like `fake`, `test`, `example`, `placeholder` are treated as obvious test data.

Run the full gauntlet locally before pushing:

```bash
npm run verify
```

That is exactly the same chain CI runs (test → typecheck → build → fixture → e2e → repo:hygiene), all in mock mode. The whole run takes a few minutes on a developer laptop.

**Real-provider tests are manual and optional.** The real OpenAI Deal Memo Playwright spec runs only when `E2E_REAL_OPENAI=true` is explicitly set along with the matching server-side and `NEXT_PUBLIC_*` envs — see the "Real mode" section above. CI must never have these set. Do not paste real confidential source documents into any test, fixture, or local debug run; PLATFORM_BRIEF.md §10/§12 apply.

## Hard rules

- AI does not make final decisions.
- Every substantive change traces to an Issue Card with a human decision.
- Source Pack is locked for a final ContractVersion.
- Internal commentary is never included in the external clean export.

See PLATFORM_BRIEF.md §5 for the full list of non-negotiable rules.
