# ContractOps AI

ContractOps AI is a browser-based web application for Korean in-house legal teams to create, review, revise, QA, annotate, and negotiate many types of contracts using multiple AI models in a controlled workflow.

It is a **generic contract automation platform**, not a single-contract generator.

AI drafts and reviews. The human lawyer decides and approves.

## Status

**Alpha v0.1 — FROZEN as of Milestone 4C (2026-05-25).** No new product features are added after this point. See [docs/09_ALPHA_READINESS_CHECKLIST.md](docs/09_ALPHA_READINESS_CHECKLIST.md) for the line-by-line readiness review and [docs/10_ALPHA_EVALUATION_REPORT.md](docs/10_ALPHA_EVALUATION_REPORT.md) for the most recent end-to-end evaluation across the three sanitized scenarios (NDA / Service Agreement / Event Booth Entry).

Only the following changes are accepted against the frozen alpha:

- bug fixes
- failing-test fixes
- security fixes
- broken-invariant fixes
- documentation updates
- post-alpha backlog items, clearly marked as backlog (tracked in [docs/11_POST_ALPHA_BACKLOG.md](docs/11_POST_ALPHA_BACKLOG.md))

OAuth/SSO, external sending (email/e-signature), PDF conversion, real document ingestion security controls, multi-tenant org RBAC, and new real-LLM providers are **explicitly out of scope** for Alpha v0.1. See ADR-016 / ADR-017 / ADR-021 for the boundary, and the [Security and production limitations](#security-and-production-limitations-alpha-v01) section below.

[TASKS.md](TASKS.md) records the original mock-MVP milestone plan (Milestones 0–5). The Alpha v0.1 real-LLM extension (2A–4C) is tracked in commit history + ADRs.

**Post-alpha Pilot P1 — Solo Drafting Loop** (delivered 2026-05-26) tightens the existing multi-agent surface into a single in-house lawyer's iterative drafting workflow. New page `/projects/[id]/draft-loop` + one new role (`review_synthesizer`) + one new state record (`DraftIteration`). No new providers, no new exports, no enterprise scope. See the “Solo Drafting Loop” section below and [ADR-022](docs/08_ARCHITECTURE_DECISIONS.md#adr-022).

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

## Real mode (Milestones 2E + 4A + 4B — OpenAI/Claude for selected roles)

> **Warning.** Do not paste real confidential source documents into the UI or fixture during real-mode testing. Use sanitized or synthetic text only. The brief's §10 and §12 rules apply. Production use awaits real auth + RBAC + retention/redaction controls.

Six real-provider seams are live across drafting, revision, and review:

| Role | Provider | Gating | Status |
|---|---|---|---|
| `deal_memo_drafter` | OpenAI | `LLM_PROVIDER_ALLOWLIST` only (2C backward compat) | Milestone 2C |
| `contract_drafter` | OpenAI | `LLM_PROVIDER_ALLOWLIST` **AND** `REAL_LLM_ROLE_ALLOWLIST` | Milestone 4A |
| `revision_agent` | OpenAI | `LLM_PROVIDER_ALLOWLIST` **AND** `REAL_LLM_ROLE_ALLOWLIST` | Milestone 4A |
| `counterparty_reviewer` | Anthropic (Claude) | `LLM_PROVIDER_ALLOWLIST` **AND** `REAL_LLM_ROLE_ALLOWLIST` (BREAKING vs 2E; see ADR-021) | Milestone 4B |
| `source_consistency_reviewer` | OpenAI | `LLM_PROVIDER_ALLOWLIST` **AND** `REAL_LLM_ROLE_ALLOWLIST` | Milestone 4B |
| `legal_style_reviewer` | OpenAI | `LLM_PROVIDER_ALLOWLIST` **AND** `REAL_LLM_ROLE_ALLOWLIST` | Milestone 4B |

The remaining roles (`drafting_plan_drafter`, `final_qa_assistant`) stay on the in-browser / in-process mock. The deterministic-QA pass (`deterministic_qa`) is non-LLM and runs unchanged. API keys live ONLY on the server.

> **Gemini (Google) is NOT implemented in Alpha v0.1.** The original 4B brief listed Gemini as the candidate backend for the source-consistency reviewer; we kept that role on OpenAI to avoid introducing a third SDK + auth pathway for the alpha freeze. `GOOGLE_API_KEY` in `.env.example` is reserved for a post-alpha milestone and is not consumed by any provider today.

### Why a per-role allowlist?

Before 4A, flipping `USE_REAL_LLM=true` enabled real mode for every role on the provider allowlist — including the contract drafter, which produces the most expensive + highest-stakes output. 4A added `REAL_LLM_ROLE_ALLOWLIST` so adding a new role to real mode is always an explicit ops decision. 4B extends the same gate to all three review roles (see ADR-021 for the `counterparty_reviewer` breaking change vs 2E):

- `REAL_LLM_ROLE_ALLOWLIST=` (empty / unset) → every 4A + 4B role is mock, even with `USE_REAL_LLM=true` and providers allowlisted. Only `deal_memo_drafter` (2C backward compat) escalates with just the provider allowlist.
- `REAL_LLM_ROLE_ALLOWLIST=contract_drafter` → only the contract drafter escalates; revision + reviews stay mock.
- `REAL_LLM_ROLE_ALLOWLIST=contract_drafter,revision_agent` → drafter + revision real, reviews still mock.
- `REAL_LLM_ROLE_ALLOWLIST=counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer` → reviews real (Anthropic + OpenAI + OpenAI), drafter + revision stay mock.
- `REAL_LLM_ROLE_ALLOWLIST=contract_drafter,revision_agent,counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer` → full Alpha v0.1 real surface.

Only `deal_memo_drafter` (2C) remains on its original gating (provider allowlist only) so existing 2C deployments don't break.

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

### Gated real contract draft + revision E2E (Milestone 4A)

`packages/web/e2e/real-contract-draft.spec.ts` is gated by `E2E_REAL_CONTRACT_DRAFT=true`. CI keeps it skipped. To run locally against the real OpenAI account:

```bash
E2E_REAL_CONTRACT_DRAFT=true \
USE_REAL_LLM=true \
LLM_PROVIDER_ALLOWLIST=openai \
REAL_LLM_ROLE_ALLOWLIST=contract_drafter,revision_agent \
OPENAI_API_KEY=sk-... \
NEXT_PUBLIC_USE_REAL_LLM=true NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST=openai \
  npm run e2e -w @contractops/web -- real-contract-draft.spec.ts
```

It creates a project with **synthetic source text only** (`example.test` org names, obviously invented amounts), walks the workflow, generates v0 via real `contract_drafter`, decides a mix of accept/reject Issue Cards, generates revision via real `revision_agent`, and asserts:

- v0 + revision `AgentRun` records `mode=real`, `provider_id=openai`, `role=contract_drafter` / `revision_agent`.
- v0 content is non-empty and looks like a contract (matches `제\d+조` or `Article \d+`).
- The rejected Issue Card's `recommended_revision` text does NOT appear in the revision output.
- Workflow + persistence + RBAC invariants from earlier milestones (Source Pack lock, lawyer-only approvals, append-only audits) remain intact.

> **NEVER use real confidential client data in this spec or any real-mode session** until production security controls (auth, RBAC, retention, redaction, audit forwarding to a SIEM) are approved. The Alpha v0.1 spec is a development seam, not a production system.

### Gated real review E2E (Milestone 4B)

`packages/web/e2e/real-review.spec.ts` is gated by `E2E_REAL_REVIEW=true`. CI keeps it skipped. To run locally against real OpenAI + Anthropic accounts:

```bash
E2E_REAL_REVIEW=true \
USE_REAL_LLM=true \
LLM_PROVIDER_ALLOWLIST=openai,anthropic \
REAL_LLM_ROLE_ALLOWLIST=counterparty_reviewer,source_consistency_reviewer,legal_style_reviewer \
OPENAI_API_KEY=sk-... \
ANTHROPIC_API_KEY=sk-ant-... \
NEXT_PUBLIC_USE_REAL_LLM=true NEXT_PUBLIC_LLM_PROVIDER_ALLOWLIST=openai,anthropic \
  npm run e2e -w @contractops/web -- real-review.spec.ts
```

It walks the workflow on **synthetic source text only** (`example.test` org names, obviously invented amounts) up to a mock v0, then calls `run_mock_reviews` so the three real reviewers run in parallel, and asserts:

- Exactly one completed `AgentRun` per review role.
- `counterparty_reviewer.mode = real`, `provider_id = anthropic`.
- `source_consistency_reviewer.mode = real`, `provider_id = openai`.
- `legal_style_reviewer.mode = real`, `provider_id = openai`.
- Every Issue Card's `source_agent` belongs to the allowed reviewer set (no unexpected agents leaked in).
- Workflow + persistence + RBAC invariants from earlier milestones (Source Pack lock, lawyer-only approvals, append-only audits, mock-mode preservation for non-allowlisted roles) remain intact.

**Mock mode remains the default.** When any of `E2E_REAL_REVIEW`, `USE_REAL_LLM`, `LLM_PROVIDER_ALLOWLIST`, `REAL_LLM_ROLE_ALLOWLIST`, or the matching API keys are missing, every review role falls back to the in-process mock provider — no silent escalation, no network calls.

After 4B only the **4C Alpha Freeze & Evaluation** milestone remains in the Alpha v0.1 roadmap.

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

## Lawyer-only UI guards (Milestone 3G)

When the selected demo actor in the header is **not** a `human_lawyer` (i.e. `business_choi`), every lawyer-only button across the workflow renders **disabled** with a tooltip and inline warning:

> ⚠ 변호사 권한이 필요한 작업입니다 (Requires human_lawyer)

Guarded actions:

- **Contract type** — `Confirm contract type`
- **Deal memo** — `Approve Deal Memo`
- **Drafting plan** — `Approve Drafting Plan`
- **Issues** — `Accept` / `Reject` / `Defer` / `Partially accept` / `Re-accept` / `Re-reject` / `Re-defer` / `Re-partial`
- **QA** — `Approve final`
- **Exports** — every `Download …` button (clean DOCX, commentary DOCX, negotiation matrix, cover email)

### UI is convenience. Server is authority.

The UI guard is a UX nicety so non-lawyer users see disabled controls instead of clicking and getting HTTP 422 back. **It is not a security boundary.** Every operation still goes through `POST /api/projects/[id]/operations` and the server re-resolves `actor_id` against the demo registry. Lawyer-only ops attempted by `business_choi` are rejected with `422 OPERATION_REJECTED` even if the browser is bypassed (`packages/web/e2e/lawyer-ui-guards.spec.ts` and `multi-actor.spec.ts` both assert this).

The helper:

```ts
import { canActAsLawyer, REQUIRES_LAWYER_MESSAGE } from "@/lib/demo-actors";
import { useCurrentActor } from "@/components/store-provider";

const isLawyer = canActAsLawyer(useCurrentActor());
// disabled={!isLawyer}
// title={!isLawyer ? REQUIRES_LAWYER_MESSAGE : undefined}
```

Production deployment **still requires real authentication and authorization** — see ADR-013 / ADR-014 and the "Future path to real auth" subsection below.

## Demo actor context (Milestones 3F + 3I + 3J)

The header now carries an **"Acting as"** dropdown with three predefined demo actors:

| Actor id | Role | What they can do |
|---|---|---|
| `lawyer_kim` | `human_lawyer` | everything (registry default) |
| `lawyer_park` | `human_lawyer` | everything; useful for hand-off / override scenarios |
| `business_choi` | `user` | sources, intake, exports — but NOT approvals or Issue Card decisions (core throws `notHumanLawyer()`) |

> **⚠ NOT AUTHENTICATION.** This is a demo name-picker, not an identity provider. There is no password, no signed token, no OAuth, no SSO, no real RBAC. The server reads the picked id from the `contractops_demo_actor` cookie and resolves it against the hardcoded `lib/demo-actors.ts` registry — that is the entirety of "authorization". A future milestone replaces this with a real identity provider (see ADR-016). **Until then, do not deploy this app to a public URL.**

### Auth modes (Milestones 3I + 3J)

`AUTH_MODE` selects between two `AuthSessionResolver` implementations behind the boundary the routes already use:

| `AUTH_MODE` | Provider | Default? | Used for |
|---|---|---|---|
| `demo` (or unset) | `DemoSessionAuthProvider` — cookie-based, hardcoded `DEMO_ACTOR_REGISTRY`, no password / no token | ✅ default | CI, mock-mode `npm run dev`, every Playwright spec that doesn't opt in to signed-cookie mode |
| `signed_cookie` | `SignedCookieAuthProvider` — HMAC-SHA256 signed session cookie, user store with PBKDF2 password hashes | opt-in | Local dev / staging that wants real login + logout. **Still NOT production-grade** — no OAuth, no per-project RBAC, no rate limiting. See ADR-017. |

`AUTH_MODE=demo` in `NODE_ENV=production` is refused at boot unless `ALLOW_DEMO_AUTH_IN_PRODUCTION=true` is explicitly set. `AUTH_MODE=signed_cookie` requires `AUTH_SESSION_SECRET` (≥ 32 chars; generate with `openssl rand -base64 48`); missing or weak secrets throw at boot.

### Auth boundary (Milestone 3I)

Server routes never read `actor_id` from the browser anymore. Every route resolves the actor through a single seam, `resolveActorFromRequest(request)` in `packages/web/lib/auth/`:

```
browser  ──►  POST /api/projects/[id]/operations  { name, args }    ← NO actor_id in body
                          │
                          ▼
              AuthSessionResolver.resolveActor(request)
                          │   reads `contractops_demo_actor` cookie,
                          │   validates against DEMO_ACTOR_REGISTRY
                          ▼
                   AuthSession { actor, source: "demo_cookie" | "demo_default" }
                          │
                          ▼
              applyOperationToStore(id, op, actor) → core.agg*(state, …, actor)
```

The boundary is `AuthSessionResolver` in `lib/auth/types.ts`. 3I shipped `DemoSessionAuthProvider`; 3J adds `SignedCookieAuthProvider` (HMAC-signed session cookie + user store). The factory in `session-resolver.ts` picks the implementation from `AUTH_MODE`; routes call `resolveActorFromRequest` unchanged. A future OAuth / SSO milestone drops in a third provider the same way — no route or `core.agg*` touch.

### Where it flows

1. **Cookie set.** The "Acting as" dropdown calls `POST /api/auth/demo/actor { actor_id }`, which validates against the registry and sets the `contractops_demo_actor` cookie (`httpOnly`, `SameSite=Lax`, `path=/`, 30-day max age). The browser **never** writes this cookie directly.
2. **Cookie read.** Every mutating route (`POST /api/projects`, `POST /api/projects/[id]/operations`) calls `resolveActorFromRequest(request)`:
   - cookie missing → demo default `lawyer_kim`, `source: "demo_default"`.
   - cookie present + valid → that actor, `source: "demo_cookie"`.
   - cookie present + unknown id → **HTTP 401** `INVALID_SESSION` + `Set-Cookie` that clears the bad value. Never falls back silently.
3. **`body.actor_id` is rejected.** Routes return **HTTP 400** `OPERATION_ACTOR_ID_FORBIDDEN` if the request body carries an `actor_id` field. The session boundary is the single source of "who"; accepting a body-provided id would let any caller impersonate anyone in the registry by editing one JSON field. Preferred over silent-ignore so a future client regression surfaces immediately.
4. **Role guard.** The resolved `Actor` flows into `applyOperationToStore` → `core.agg*`. Lawyer-only ops keep their existing `actor.role === "human_lawyer"` check — a `business_choi` session attempting `approve_*` / `decide_issue` / `classify_and_confirm` gets HTTP 422 `OPERATION_REJECTED`.
5. **Audit + history.** `AuditLog.actor` and `IssueDecisionHistoryEntry.actor_id` + `.actor_role` always come from the resolved session, never from the body. Decision changes by different lawyers (cookie-switched mid-flow) append a multi-actor trail — proved by `packages/web/e2e/multi-actor.spec.ts`.

### Auth API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/session` | `GET` | Return `{ auth_mode, demo_enabled, authenticated, actor, source }`. Bad cookie → 401 + Set-Cookie clear. |
| `/api/auth/demo/actor` | `POST` | Demo mode (or `DEMO_AUTH_ENABLED=true` override) — set the picker cookie. Returns 403 `DEMO_AUTH_DISABLED` in signed_cookie mode otherwise. |
| `/api/auth/demo/actor` | `DELETE` | Demo mode — clear the picker cookie. 403 otherwise. |
| `/api/auth/login` | `POST` | **Signed-cookie mode only.** Body `{ email, password }` → 200 + Set-Cookie signed session, or 401 `INVALID_CREDENTIALS` (generic — no email-enumeration leak). Refused in demo mode with 400 `AUTH_MODE_MISMATCH`. |
| `/api/auth/logout` | `POST` | Clears both the signed cookie AND the demo cookie defensively. |
| `/api/auth/dev/seed` | `POST` | **Dev-only.** Gated by `E2E_SIGNED_AUTH=true`. Seeds the three sanitized demo users (`example.test` emails) for the gated Playwright spec. 403 in normal operation. |
| `/api/auth/events` | `GET` | **Dev-only.** Gated by `AUTH_EVENTS_INSPECT=true`. Returns the in-process auth/security event log (Milestone 3K). 403 by default. Production deployment must forward events to a real SIEM and keep this route disabled — see ADR-018. |

### Multi-actor demo

```bash
npm run dev -w @contractops/web   # then open the project URL in three browser windows
# Window A: pick "Kim 변호사" → reject an Issue Card with a reason note
# Window B: pick "Park 변호사" → change the same card back to accepted
# The card's "Decision history" toggle shows both actors and both reason notes.
# Window C: pick "Choi 사업담당" → lawyer-only buttons are disabled; the
# server rejects any forced approval call with HTTP 422.
```

Different windows hold independent cookie jars, so the three demo sessions don't collide. The `multi-actor.spec.ts` Playwright spec exercises exactly this flow and asserts that forcing `body.actor_id="lawyer_kim"` from the business_choi context gets HTTP 400.

### Signed-cookie mode (Milestone 3J)

```bash
AUTH_MODE=signed_cookie \
AUTH_SESSION_SECRET=$(openssl rand -base64 48) \
  npm run dev -w @contractops/web
```

What changes vs. demo mode:

- The demo actor dropdown route returns 403 `DEMO_AUTH_DISABLED` (unless `DEMO_AUTH_ENABLED=true` is also set).
- `POST /api/auth/login { email, password }` validates against the user store and issues an HMAC-signed session cookie.
- `GET /api/auth/session` returns `authenticated: false, actor: null` when no cookie is present; the page-level UI renders an anonymous landing.
- `POST /api/auth/logout` clears the signed cookie.
- Project / operation routes refuse requests with no signed cookie (401 `INVALID_SESSION`); the demo default fallback is gone.
- `body.actor_id` rejection from 3I stays in force — impersonation is impossible in BOTH modes.

The user store ships as in-process `MemoryUserStore` — restart wipes it. Seed via `POST /api/auth/dev/seed { password }` (gated by `E2E_SIGNED_AUTH=true`). Passwords are PBKDF2-SHA256 (120k iterations, 16-byte salt, 32-byte key), encoded as `pbkdf2-sha256-v1$<iter>$<salt-b64url>$<key-b64url>`. NEVER store plaintext passwords; tests assert this and use the obvious literal `"demo-password"` for the seeded users (`lawyer.kim@example.test`, `lawyer.park@example.test`, `biz.choi@example.test` — the `example.test` TLD is IANA-reserved by RFC 6761 and can never reach a real mailbox).

### Gated signed-auth E2E

`packages/web/e2e/signed-auth.spec.ts` is gated by `E2E_SIGNED_AUTH=true`. CI keeps it skipped. To run locally:

```bash
E2E_SIGNED_AUTH=true \
AUTH_MODE=signed_cookie \
AUTH_SESSION_SECRET=this-is-a-32-char-test-secret-aaa \
  npm run e2e -w @contractops/web -- signed-auth.spec.ts
```

The spec logs in as `lawyer_kim`, walks the workflow to Issue Cards, logs out, logs in as `lawyer_park` (separate context), changes the same card, logs in as `business_choi` (third context), and verifies:
- the audit + decision history reflects each signed-in user;
- `business_choi` cannot approve via API (422 `OPERATION_REJECTED`);
- `body.actor_id="lawyer_kim"` from the Choi context is rejected with 400 `OPERATION_ACTOR_ID_FORBIDDEN`;
- the demo actor route returns 403 `DEMO_AUTH_DISABLED`;
- DOCX export separation (clean / commentary) holds.

### Auth / security event log (Milestone 3K)

Every authentication-layer transition is now recorded into an append-only `AuthEvent` log that lives separately from `AuditLog` (which records WORKFLOW actions). The two never share storage — workflow audits are stamped with the resolved session actor, auth events describe how the session itself got resolved.

Event types:

| Event | Emitted when |
|---|---|
| `login_success` | `POST /api/auth/login` succeeds. Records `email` + `user_id`. |
| `login_failed` | `POST /api/auth/login` returns 401. Records `email`; `user_id` only when the email matched. `metadata.detail` distinguishes `UNKNOWN_EMAIL` / `WRONG_PASSWORD` / `DISABLED_USER` (internal — the client always gets the same generic error). |
| `logout` | `POST /api/auth/logout`. Records `actor_id` of the resolved session, or `null` if the caller had no session. |
| `session_invalid` | `GET /api/auth/session` saw a malformed signed token, an unknown signed user, a disabled signed user, or a junk demo cookie. |
| `session_expired` | `GET /api/auth/session` saw a signed token past its `expires_at`. |
| `session_tampered` | `GET /api/auth/session` saw a signed token whose HMAC didn't verify. |
| `demo_actor_switch` | `POST /api/auth/demo/actor` succeeded. `metadata.previous_actor_id` shows the cookie value before the switch. |
| `demo_auth_forbidden` | `POST` or `DELETE /api/auth/demo/actor` returned 403 because `DEMO_AUTH_ENABLED=false` in signed-cookie mode. `metadata.attempted_actor_id` records the would-be id. |

Privacy guarantees (enforced by tests):

- Plaintext passwords are **never** recorded — the route never passes them to the recorder, and `recordAuthEvent` defensively rejects any metadata key matching `password` / `token` / `signature` / `secret` / `cookie` / `api_key` / etc.
- Signed session tokens are **never** recorded — only the failure `cause_code` (`EXPIRED` / `INVALID_SIGNATURE` / `INVALID_TOKEN_SHAPE` / …).
- `tests/auth-events-routes.test.ts` runs a privacy sweep: after a full failed-login → successful-login → logout cycle, the entire event JSON is grepped for the test password, the wrong-password attempt, the signed token, and the signing secret — all four must be absent.
- The dev inspect route `GET /api/auth/events` (gated by `AUTH_EVENTS_INSPECT=true`) carries the same guarantees because the underlying store does.

Storage: `MemoryAuthEventStore` keeps events in process memory, restart wipes them. Append-only — duplicate id throws `AuthEventAppendOnlyViolationError`.

> **⚠ NOT A PRODUCTION SIEM.** No alerting, no retention policy, no tamper-evident storage, no forwarding to a real security backend. The 3K event log is the SEAM (the route handlers + recorder + store interface) that a future milestone replaces with a real SIEM integration. Do NOT rely on this for compliance or incident response.

### Gated signed-auth-events E2E (Milestone 3K)

`packages/web/e2e/signed-auth-events.spec.ts` is gated by `E2E_SIGNED_AUTH=true` AND `AUTH_EVENTS_INSPECT=true`. CI keeps it skipped. To run locally:

```bash
E2E_SIGNED_AUTH=true \
AUTH_EVENTS_INSPECT=true \
AUTH_MODE=signed_cookie \
AUTH_SESSION_SECRET=this-is-a-32-char-test-secret-aaa \
  npm run e2e -w @contractops/web -- signed-auth-events.spec.ts
```

Walks failed-login → successful-login → logout and verifies the dev inspect route returns the three events in order, with the right `metadata.detail` values, and zero password / token / secret leakage.

## Project membership + minimal RBAC (Milestone 3L)

Every project now carries a small list of `ProjectMembership` rows inside its `ProjectState`. The route layer checks (actor, project, permission) on every read and every mutation — server-side authoritative, UI guards are only a convenience layer.

| `project_role` | Highlights of what the matrix grants |
|---|---|
| `owner_lawyer` | Every permission. Auto-granted to the project creator (the creator must be `human_lawyer`; non-lawyer creators get HTTP 403 `NON_LAWYER_CANNOT_CREATE_PROJECT`). Only role that can `manage_memberships` or `approve_final`. |
| `reviewer_lawyer` | Everything EXCEPT the four approvals (`approve_deal_memo` / `approve_drafting_plan` / `approve_final`) and `manage_memberships`. Per the 3L spec: can decide Issue Cards, run reviews, run QA. |
| `business_contributor` | `view_project`, `add_source` (pre-lock), `answer_intake`, `export_clean`. Cannot approve, decide, lock, or export internal. |
| `business_viewer` | `view_project` + `export_clean`. Read-only. |

The full permission map (`PROJECT_ROLE_MATRIX`) lives in `packages/web/lib/auth/permissions.ts`. Each Operation in `lib/operations.ts` maps to exactly one Permission via `mapOperationToPermission` — operations not in the map fail closed.

### How authorization fires

```
browser ──► POST /api/projects/[id]/operations { name, args }   ← no actor_id
                  │
                  ▼  resolveActorFromRequest(request)   (3I / 3J session)
                  │
                  ▼  getProjectState(projectId)
                  │
                  ▼  requireProjectPermission(state, actor.id, mapOperationToPermission(op))
                  │           │
                  │           ├── no membership   → 403 PROJECT_ACCESS_DENIED
                  │           ├── role lacks perm → 403 PROJECT_PERMISSION_DENIED
                  │           └── allowed          → continue
                  ▼
            applyOperationToStore(id, op, actor) → core.agg*(state, …, actor)
                  │
                  └── core role guard ("actor.role === 'human_lawyer'") is STILL
                       in place as defense in depth; produces 422 OPERATION_REJECTED
                       only if the matrix accidentally allowed a non-lawyer through.
```

The same `requireProjectPermission` call gates every other project-scoped route — `GET /api/projects/[id]`, `GET /api/projects/[id]/audit-logs`, `GET /api/projects/[id]/decision-history`, `POST /api/exports/render`. The project list (`GET /api/projects`) filters via `isProjectVisibleTo` so non-member projects don't leak.

### Membership management API

| Route | Method | Who | Purpose |
|---|---|---|---|
| `/api/projects/[id]/memberships` | `GET` | any active member | List memberships + return caller's `my_membership` |
| `/api/projects/[id]/memberships` | `POST { actor_id, project_role }` | `owner_lawyer` only | Add a membership. Lawyer roles refused for non-lawyer actors (`PROJECT_ROLE_REQUIRES_LAWYER`); duplicate active membership rejected with 409. |
| `/api/projects/[id]/memberships/[membership_id]` | `DELETE` | `owner_lawyer` only | Soft-delete: sets `disabled_at`. Refuses to remove the last active `owner_lawyer` (422 `CANNOT_REMOVE_LAST_OWNER`). Idempotent on already-disabled. |

Both add + disable also append `membership_created` / `membership_disabled` rows to the existing append-only `AuditLog`.

### Project Members UI

A new sidebar entry `Members` (page: `/projects/[id]/members`) shows the caller's current `project_role`, lists every membership (active + disabled), and renders an "Add a member" form for `owner_lawyer`. The page hides controls the caller can't use, but EVERY action goes through `/api/projects/[id]/memberships` which re-checks the requester's `manage_memberships` permission — opening devtools to unhide the button does nothing.

### Storage

Memberships live INSIDE `ProjectState.memberships` so memory / file / Postgres adapters all work without new methods. Project list filtering reads each project's state to check the actor's membership — N+1 reads, acceptable for MVP. A future milestone moves memberships to a normalized index table; the migration is contained because every route already goes through `loadActiveMembership` / `requireProjectPermission` (ADR-019).

### NOT production RBAC

- No organization-level multi-tenancy, no group sync, no per-resource ACLs beyond (actor, project, role).
- Lawyer-typed roles (`owner_lawyer`, `reviewer_lawyer`) only check `Actor.role === "human_lawyer"`. There is no jurisdiction check, no bar verification, no per-jurisdiction matrix.
- Production deployment must layer real OAuth/SSO + group-derived membership on top (post-Alpha). See ADR-019.

### Future path to real auth

The auth boundary is intentionally the single chokepoint. 3J added the second `AuthSessionResolver` implementation; 3K added the auth-event seam; 3L added per-project RBAC. Future milestones will:

1. **3L — OAuth / SSO provider integration.** Add a third `AuthSessionResolver` that exchanges authorization codes for sessions and creates / merges users on first login. Keep `signed_cookie` for password-backed accounts. Emit `oauth_login_success` / `oauth_login_failed` into the same 3K event log.
2. **3M — Per-project assignment + production RBAC.** Add a project-membership table; gate operations on `(actor.id, project.id) ∈ membership` in addition to `actor.role === "human_lawyer"`. Emit `project_membership_changed` events.
3. **3N — Real SIEM integration + retention.** Forward 3K events to a real backend (Datadog / Splunk / S3 + Athena / Elastic); add retention policy, tamper-evident storage, alerting on `login_failed` spikes and `session_tampered` spikes.
4. **3O — Hardening.** Rate limiting on `/api/auth/login`, account lockout policy, MFA, password reset, email verification, CSRF tokens on logout, secret rotation with key-id support.

Until then: production deployment **still requires real OAuth/SSO + RBAC + SIEM + rate limiting + MFA**; 3J + 3K are the seams, not the destinations. See ADR-016 (boundary), ADR-017 (signed-cookie + user store), and ADR-018 (auth event log) for the full rationale.

## Persistence (Milestones 3D + 3E + 3H)

State for the web app — `ProjectState`, `AuditLog`, `IssueDecisionHistoryEntry` — flows through a single `PersistenceAdapter` interface (`packages/web/lib/persistence/`). Three adapters ship:

| `PERSISTENCE_DRIVER` | Adapter | Default? | Used for |
|---|---|---|---|
| `memory` (or unset) | `MemoryPersistenceAdapter` — `globalThis`-pinned `Map` | ✅ default | CI, the mock-mode `npm run dev` flow, every Vitest / Playwright test that doesn't explicitly enable a durable adapter |
| `file` | `FilePersistenceAdapter` — JSON snapshot + JSONL journals under `PERSISTENCE_FILE_PATH` (default `./.contractops-data/`) | opt-in | Local dev/demo runs where you want state to survive a server restart |
| `postgres` | `PostgresPersistenceAdapter` — JSONB tables in a real PostgreSQL instance | opt-in | Durable, multi-process dev/staging. Production deployment still needs real authentication + project-level authorization on top (see ADR-015). |

Any other value (including `sqlite`, reserved for a future adapter) throws `UnknownPersistenceDriverError` at boot. `postgres` without `DATABASE_URL` throws `PostgresConfigError`. **There is no silent fallback** — switching storage is always deliberate.

### Memory mode (default)

```bash
npm run dev -w @contractops/web   # PERSISTENCE_DRIVER=memory implied
```

State lives in the Next.js server process memory. Lost on every restart. CI runs in memory mode unconditionally.

### Durable local mode (file adapter)

```bash
PERSISTENCE_DRIVER=file \
PERSISTENCE_FILE_PATH=.contractops-data \
  npm run dev -w @contractops/web
```

Layout under `PERSISTENCE_FILE_PATH/projects/`:

```
<project_id>.project.json   # full ProjectState snapshot (overwritten per save)
<project_id>.audits.jsonl   # one AuditLog per line, append-only
<project_id>.history.jsonl  # one IssueDecisionHistoryEntry per line, append-only
```

**Local dev only — NOT production:**

- No auth, no row-level permissions, no encryption, no multi-process locking. A single Next.js process per `PERSISTENCE_FILE_PATH` is the only supported deployment.
- Real confidential source documents MUST NOT be saved into either adapter — only synthetic / sanitized text belongs here (PLATFORM_BRIEF.md §10, §12 rule 6).
- Generated `.docx` and `_cover_email.md` binaries are **never** written into persistence; `ExportFile.content` is a text summary. The on-disk file layout is gitignored (`.contractops-data/`, `*.db`, `*.sqlite*`) and `npm run repo:hygiene` refuses to allow them tracked.
- Append-only is enforced at the adapter level: a duplicate audit or decision-history id throws `AppendOnlyViolationError` before any disk write.

### PostgreSQL mode (Milestone 3H)

```bash
PERSISTENCE_DRIVER=postgres \
DATABASE_URL=postgres://user:pass@host:5432/dbname \
POSTGRES_SSL=false \
  npm run dev -w @contractops/web
```

On first read or write the adapter bootstraps four tables (idempotent `CREATE TABLE IF NOT EXISTS`):

```
contractops_projects                 — id PK, name, status, created_at
contractops_project_states           — project_id PK FK, state JSONB (latest snapshot)
contractops_audit_logs               — id PK, project_id FK, entry JSONB (append-only)
contractops_issue_decision_history   — id PK, project_id FK, entry JSONB (append-only)
```

No migration framework, no ORM — just `pg` and a handful of parameterized statements. `createProject` and `saveProjectState` wrap multi-row writes in a transaction; `appendAuditLog` and `appendDecisionHistory` map PostgreSQL's `23505` unique-violation SQLSTATE to `AppendOnlyViolationError` so the append-only contract is identical across all three adapters.

**Still NOT production-grade — Postgres fixes durability and concurrency, not identity:**

- No authentication, no project-level RBAC, no row-level security. The adapter is reachable by anyone who can reach the Next.js process; deployment must front it with real auth (ADR-015).
- Real confidential source documents MUST NOT be saved into the database — only synthetic / sanitized text belongs here (PLATFORM_BRIEF.md §10, §12 rule 6).
- Generated `.docx` and `_cover_email.md` binaries are **never** written into persistence; `ExportFile.content` is a text summary stored inside the JSONB ProjectState column.
- `pg` is server-only. The Next webpack config aliases it to `false` in the client bundle and lists it under `experimental.serverComponentsExternalPackages`; the `no-sdk-imports` test refuses any `import "pg"` outside `lib/persistence/postgres-adapter.ts`.

### Optional durable E2E (file adapter)

`packages/web/e2e/durable-persistence.spec.ts` is gated by `E2E_DURABLE_PERSISTENCE=true`. CI keeps it skipped. To run locally:

```bash
E2E_DURABLE_PERSISTENCE=true \
PERSISTENCE_DRIVER=file \
PERSISTENCE_FILE_PATH=.tmp-e2e-data \
  npm run e2e -w @contractops/web
```

It creates a project, walks to "issues_open", rejects an Issue Card, then opens a **fresh browser context** and verifies the project and the decision history both still exist — proving the disk-backed store survives the simulated tab-close.

### Optional PostgreSQL integration test (Milestone 3H)

`packages/web/tests/persistence-postgres-integration.test.ts` is gated by `POSTGRES_INTEGRATION=true`. CI keeps it skipped — the standard `npm run verify` pipeline never touches a real DB. To run locally against a disposable dev/staging instance (the test calls `resetDemoStore()` and deletes every `contractops_*` row):

```bash
POSTGRES_INTEGRATION=true \
DATABASE_URL=postgres://user:pass@host:5432/dbname \
POSTGRES_SSL=false \
  npm run test -w @contractops/web -- persistence-postgres-integration
```

It walks `createProject → saveProjectState → appendAuditLog → appendDecisionHistory`, asserts append-only enforcement via real `23505` violations, opens a **fresh adapter on the same pool** (simulating a process restart) and verifies the data survives.

## Server-side in-memory store (Milestone 3D)

The web MVP is now backed by a **server-side in-memory project store**. The browser is no longer the source of truth — `localStorage` is unused for project data.

> **NOT FOR PRODUCTION.** State lives in `process.memory`. It **resets on every server restart**. There is no persistence, no replication, no auth. The store is a demo and CI scaffold; a future milestone will replace `packages/web/lib/server-store.ts`'s storage layer with PostgreSQL (or another durable DB) without changing the Operation-descriptor boundary. Until then: **do not post real confidential source documents** into the store — only synthetic / sanitized text belongs here (PLATFORM_BRIEF.md §10, §12 rule 6).

### API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/projects` | `GET` | List project summaries |
| `/api/projects` | `POST` | Create a new project (`{ name }`) |
| `/api/projects/[id]` | `GET` | Return full `ProjectState` + project audits |
| `/api/projects/[id]/operations` | `POST` | Apply an `Operation` descriptor; returns updated state + new audits |
| `/api/projects/[id]/audit-logs` | `GET` | Return the project's append-only audit log |
| `/api/projects/[id]/decision-history` | `GET` | Return the project's `IssueDecisionHistoryEntry[]` |
| `/api/projects/reset` | `POST` | **Dev/demo only.** Drops every project + audit. In production (`NODE_ENV === "production"`) returns 403 unless `ALLOW_SERVER_STORE_RESET=true` is set. |

The `/operations` endpoint accepts a typed `Operation` from `packages/web/lib/operations.ts`:

```ts
type Operation =
  | { name: "add_source"; args: {...} }
  | { name: "lock_source_pack"; args: {} }
  | { name: "decide_issue"; args: { issue_id, decision, partial_note?, reason_note? } }
  | { name: "approve_final"; args: {} }
  | ...; // 17 named operations total
```

It dispatches each descriptor to the matching `core.agg*` function — every workflow invariant (Source Pack lock, pending-blocks-final, append-only audits, append-only decision history, clean/commentary separation) is still enforced by `@contractops/core`. The route is a thin pass-through.

### Multi-session demo

Two browser contexts that point at the same Next.js process share state through the server. The Playwright `multi-session.spec.ts` proves it:

1. Browser **A** creates a project and walks it up through "issues_open".
2. Browser **B** opens the same project URL — sees A's state including every pending Issue Card.
3. Browser **B** rejects one Issue Card with a reason note.
4. Browser **A** reloads — sees B's change, reads B's append-only `decision_history` entry (`pending → rejected · rejected by browser B`).
5. The rejected card still stays excluded from A's revision, and final approval is still blocked while any pending card remains.

### What changed in the web layer

- `packages/web/lib/server-store.ts` — process-wide `Map<projectId, ProjectState>` pinned on `globalThis` so HMR doesn't recreate it.
- `packages/web/lib/operations.ts` — `Operation` discriminated union (single source of truth between client builders and server dispatcher).
- `packages/web/lib/server-aggregate-context.ts` — server-side `AggregateContext` factory. Real OpenAI / Anthropic providers are now instantiated **directly on the server** via `selectProviderByName(name, env)` — the old browser→proxy→server hop is no longer needed (the `/api/agent/*` proxy routes remain for backward compatibility).
- `packages/web/components/store-provider.tsx` — API-backed. Tracks in-flight ops and mirrors the count on `<html data-ops-in-flight="N">` so Playwright tests can deterministically wait via `waitForStoreIdle(page)`.
- `packages/web/lib/actions.ts` — `act*` functions now return serializable `Operation` descriptors instead of running aggregates inline.

The bundle gets noticeably smaller as a side effect — the agent / aggregate code no longer ships to the browser.

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

## Alpha evaluation (Milestone 4C)

Three sanitized fixtures cover the contract families wired into the Alpha v0.1 platform:

| Fixture | Contract type | Notes |
|---|---|---|
| `fixtures/synthetic-nda.json` | NDA | Bidirectional, `example.test` counterparty, 24-month term |
| `fixtures/synthetic-service-agreement.json` | Service Agreement | Synthetic vendor, payment milestones, SLA optional |
| `fixtures/synthetic-booth-event.json` | Event Booth Entry | Existing fixture from Milestone 0; reused unchanged |

All three fixtures contain **only synthetic content** — `example.test` domains, obviously invented amounts, no real counterparty / client / BOF facts.

Run the evaluation:

```bash
npm run alpha:eval
```

The runner (`scripts/run-alpha-evaluation.ts`) walks each fixture through the full workflow (create → sources → lock → classify → playbook → intake → Deal Memo → Drafting Plan → v0 → reviews → decisions → final QA → revision → final approval → exports), records stage completion + Issue Card counts + export metadata + invariant outcomes, and writes a markdown report to `docs/10_ALPHA_EVALUATION_REPORT.md`. The script exits non-zero if any invariant fails.

Pinned invariants enforced by the runner (in addition to the unit + acceptance suite):

- Rejected Issue Cards are NEVER applied to the revision.
- Pending Issue Cards block final approval (any pending → final approval throws).
- The `clean_docx` export contains no internal-commentary markers (`[COMMENTARY]`, `[INTERNAL]`, `[REDLINE_RATIONALE]`, `[NEGOTIATION_GUIDANCE]`, `법무주석`).
- The `commentary_docx` and `negotiation_matrix_docx` exports carry the `INTERNAL ONLY` banner.
- Source Pack lock is enforced (cannot mutate sources after lock).
- Lawyer-only ops (approvals, final approve, decide issue, classify) refuse non-lawyer actors.

See [docs/09_ALPHA_READINESS_CHECKLIST.md](docs/09_ALPHA_READINESS_CHECKLIST.md) for the area-by-area readiness review and [docs/10_ALPHA_EVALUATION_REPORT.md](docs/10_ALPHA_EVALUATION_REPORT.md) for the most recent run's results + go/no-go recommendation.

## Solo Drafting Loop (post-alpha Pilot P1)

> Practical solo-lawyer workflow. The full enterprise scaffolding (3D–3L,
> 4A–4C) stays in place; this is a focused, opinionated wrapper on top.

### What it is

A single in-house lawyer drives one project from raw source material
(business request emails, reference contracts, term sheets) to a
high-quality draft via repeated cycles of:

```
[GPT contract_drafter]
       ↓
[Claude counterparty_reviewer] [OpenAI source_consistency_reviewer] [OpenAI legal_style_reviewer]
       ↓                                ↓                                  ↓
             [review_synthesizer] (Gemini-target, mock-only in P1)
       ↓
[GPT revision_agent]   →   next iteration
       ↓
[lawyer stops loop]   →   QA & Final → Exports
```

Every step requires a user click — there is NO autonomous loop. Default
guidance suggests 3 iterations; no hard product limit.

### Role map

| Step | Role (model class) | Provider seam | Default mode |
|---|---|---|---|
| Initial draft (v0) | `contract_drafter` | OpenAI | mock |
| Counterparty review | `counterparty_reviewer` | Anthropic (Claude) | mock |
| Source-consistency review | `source_consistency_reviewer` | OpenAI (Gemini reserved post-P1) | mock |
| Legal-style review | `legal_style_reviewer` | OpenAI | mock |
| Review synthesis (NEW) | `review_synthesizer` | provider-agnostic seam; Gemini is the post-P1 target | mock (P1) |
| Revision | `revision_agent` | OpenAI | mock |
| Human accept/reject | `human_lawyer` (no model) | n/a | always real (lawyer is in the loop) |

Real-mode opt-in for any of the LLM roles is unchanged — same gates from
Milestones 4A/4B (`USE_REAL_LLM=true` + `LLM_PROVIDER_ALLOWLIST` +
`REAL_LLM_ROLE_ALLOWLIST` + API key). `review_synthesizer` stays mock in
P1 by design: adding a Google/Gemini provider is the next focused task.
The seam is already provider-agnostic — wiring Gemini is a one-line
addition to `tryReal()` once the provider lands.

### Page + operations

- New UI page: **`/projects/[id]/draft-loop`** ("Draft Loop" in the sidebar).
- New state record: `DraftIteration` (in `ProjectState.draft_iterations`).
- New aggregate operations:
  - `create_draft_iteration` — open a new cycle
  - `synthesize_reviews` — run the synthesizer against the iteration's pending Issue Cards
  - `batch_accept_review_issues` — convenience: lawyer accepts all non-critical pending cards in one click (critical cards must be decided individually on the Issues page; per-card decision_history entries + audit logs are still appended)
  - `stop_draft_loop` — mark "ready for final review" (does NOT auto-approve final)
- New permissions: `run_draft_loop` + `batch_accept_issues` (both lawyer-only; business roles cannot drive the loop).

### Source input

The loop treats `SourceDocumentContent` rows as the lawyer's intake:
business request emails, reference materials, prior contracts, term
sheets, and internal instructions. There is **no file parsing, no PDF
conversion, no OCR** — paste synthetic text on the Sources page first.
The loop page shows a warning if `source_contents` is empty.

### Mock vs real mode

- Mock mode is the default and is mandatory — every loop step works
  end-to-end against mock providers (covered by
  `packages/web/e2e/draft-loop.spec.ts`).
- Real mode reuses Milestone 4A/4B gates. `review_synthesizer` is
  mock-only in P1; adding Gemini is the next focused task.
- **Do not paste real confidential documents** until production
  security controls (auth, RBAC, retention, redaction) are approved.

### What the loop does NOT do

- It does NOT auto-approve final or auto-export.
- It does NOT bypass Issue Cards (synthesis is a recommendation layer; the
  lawyer's decisions remain authoritative).
- It does NOT apply rejected or deferred Issue Cards (rejected card text
  is invariant-excluded from the next revision — same guard as 4A).
- It does NOT replace any existing page — Sources / Playbook / Intake /
  Deal Memo / Drafting Plan / Issues / QA / Exports are unchanged.

## Security and production limitations (Alpha v0.1)

**Alpha v0.1 is a development seam, not a production system.** Do not run real confidential client documents through it. The platform meets the seam-level requirements for an internal alpha demo (mock-mode everywhere by default, gated real-LLM seams for development, append-only audit logs, demo actor + RBAC matrix, durable persistence option). It does NOT meet the requirements for production legal work:

| Concern | Alpha v0.1 status |
|---|---|
| Authentication | Demo actor cookie (default) OR signed-cookie session against an in-memory user store (3J). **No OAuth, no SSO, no NextAuth, no enterprise IdP integration.** |
| Multi-tenancy / org RBAC | Project-scoped membership + 4-role permission matrix (3L). **No org-level tenancy boundary, no per-org data isolation, no admin UI for membership across orgs.** |
| External sending | **Not implemented.** Cover email is a Markdown download only. The platform NEVER sends email, NEVER triggers e-signature, NEVER POSTs to a counterparty endpoint. |
| PDF conversion | **Not implemented.** Source files are referenced by metadata only; their content is provided as text (`source_contents`). |
| Real-document ingestion security | **Not implemented.** No on-server file scanning, no in-flight redaction, no retention policy enforcement, no audit forwarding to a SIEM, no encryption beyond the persistence driver's defaults. |
| Real-LLM mode | Off by default. Six roles can be opted in via `USE_REAL_LLM` + `LLM_PROVIDER_ALLOWLIST` + `REAL_LLM_ROLE_ALLOWLIST` (see [Real mode](#real-mode-milestones-2e--4a--4b--openaiclaude-for-selected-roles)). **Normal CI is mock-only** and never holds API keys. **Use synthetic data only.** |
| Confidential data | **Forbidden.** Until the controls above ship, do not paste or upload real confidential source documents into any environment — local dev, gated E2E specs, or otherwise. |

These limitations are tracked in [docs/11_POST_ALPHA_BACKLOG.md](docs/11_POST_ALPHA_BACKLOG.md). Production deployment requires explicit go-ahead AND completion of the production-blocking items in that backlog. Nothing in Alpha v0.1 implies any of those items will be implemented.

## Hard rules

- AI does not make final decisions.
- Every substantive change traces to an Issue Card with a human decision.
- Source Pack is locked for a final ContractVersion.
- Internal commentary is never included in the external clean export.

See PLATFORM_BRIEF.md §5 for the full list of non-negotiable rules.
