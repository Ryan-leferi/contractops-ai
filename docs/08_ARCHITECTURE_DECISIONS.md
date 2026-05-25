# 08 — Architecture Decisions

Lightweight ADRs. Each decision derives from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) and is binding until amended.

---

## ADR-001 — Build workflow core and tests before UI

**Source:** PLATFORM_BRIEF.md §13 rule 3.

**Decision:** All workflow rules are implemented as a state machine with tests under TASKS.md Milestone 1 BEFORE any UI page is built.

**Consequence:** UI work is blocked until the workflow tests pass.

---

## ADR-002 — Mock mode is permanent

**Source:** PLATFORM_BRIEF.md §5 rule 12 and §12 rule 8.

**Decision:** Mock mode is a first-class mode of the system. It is not removed when real APIs are integrated.

**Consequence:** Every agent call site must support both real and mock backends behind a single interface.

---

## ADR-003 — Playbooks are data, not code

**Source:** PLATFORM_BRIEF.md §3, §4.

**Decision:** Each Playbook is a file in `playbooks/` loaded at runtime. Workflow code does not reference contract names directly.

**Consequence:** Adding a contract type does not require workflow code changes. Tests assert that workflow modules do not branch on contract-type string literals.

---

## ADR-004 — Issue Cards are the sole channel for substantive revision

**Source:** PLATFORM_BRIEF.md §2 (traceability), §5 rules 4–5, §8.

**Decision:** The Revision Agent reads only IssueCards with `human_decision in {accepted, partially_accepted}`. No other code path may modify a ContractVersion.

**Consequence:** Any new review or QA source must emit Issue Cards. There are no "side-channel" patches.

---

## ADR-005 — Source Pack is immutable once locked

**Source:** PLATFORM_BRIEF.md §5 rule 8, §9.

**Decision:** A locked SourcePack rejects all mutations. New source material requires a new SourcePack.

**Consequence:** Every ContractVersion references a stable SourcePack snapshot.

---

## ADR-006 — ContractVersion is tied to (source_pack_id, playbook_id)

**Source:** PLATFORM_BRIEF.md §9; derived data model in `docs/04_DATA_MODEL.md`.

**Decision:** A ContractVersion record is invalid without both ids. Tests assert this at the persistence layer.

**Consequence:** Reviewing a past contract version always reveals which sources and which Playbook produced it.

---

## ADR-007 — Clean / commentary separation is enforced at the export layer

**Source:** PLATFORM_BRIEF.md §5 rules 6–7.

**Decision:** Two separate render paths produce two separate ExportArtifact records. A test asserts that the clean artifact contains no content tagged as commentary.

**Consequence:** It is not possible to produce a single document that mixes clean and commentary content.

---

## ADR-008 — Deterministic QA is not replaced by LLM review

**Source:** PLATFORM_BRIEF.md §5 rule 13, §7.

**Decision:** Date, amount, cross-reference, numbering, version, and forbidden-expression checks run as Python code, not as LLM prompts.

**Consequence:** Even when LLMs are offline or mocked, deterministic QA still runs.

---

## ADR-009 — BOF is fixture-only

**Source:** PLATFORM_BRIEF.md §10.

**Decision:** A BOF-style fixture may live under `fixtures/` for testing. BOF-specific facts must never appear in platform code.

**Consequence:** A grep for BOF in source code outside `fixtures/` must return nothing of substance.

---

## ADR-010 — Korean drafting conventions are encoded in Playbooks and deterministic QA, not in the workflow

**Source:** PLATFORM_BRIEF.md §5 rule 14, §6.

**Decision:** Korean drafting style (numbering, preferred verbs, forbidden expressions) is encoded in Playbook fields (`drafting_style_notes`, `final_qa_checklist`) and in deterministic QA rules (forbidden expression detection, numbering checks). The workflow itself is language-agnostic.

**Consequence:** Future support for additional jurisdictions adds Playbooks and QA rules; it does not fork the workflow.

---

## ADR-011 — Server-side in-memory project store (no DB yet)

**Source:** Milestone 3D scope; PLATFORM_BRIEF.md §13 rule 8 ("avoid overengineering").

**Decision:** ProjectState, AuditLog, IssueDecisionHistory, SourceDocumentContent, QA runs, AgentRuns, and ExportFile metadata for the web app live in a process-wide `Map<projectId, ProjectState>` exposed via `packages/web/lib/server-store.ts`. The browser is no longer the source of truth — `localStorage` is unused. Every workflow mutation goes through `POST /api/projects/[id]/operations`, which dispatches a named `Operation` descriptor to a `core.agg*` function (workflow logic stays in `@contractops/core`).

**Consequence:**

- Multi-browser-context demo: two tabs or browsers point at the same server process and see the same state.
- The store **resets on every server restart** and has **no persistence, no auth, no replication**. This is explicit non-production behavior; the README documents it as such.
- Real durability (PostgreSQL or another database) is out of scope for this milestone and explicitly forbidden by the milestone prompt. A future milestone will swap `lib/server-store.ts`'s storage layer for a real database. The Operation-descriptor boundary makes that swap a one-file change — no page or aggregate logic needs to move.
- Real LLM providers (OpenAI, Anthropic) are now instantiated directly on the server inside `lib/server-aggregate-context.ts` via `selectProviderByName(name, env)`; the browser no longer needs the `/api/agent/*` proxy hop. The old proxy routes remain for backward compatibility but are no longer used by the StoreProvider.
- Confidential source documents MUST NOT be POSTed into this store. Per PLATFORM_BRIEF.md §10 and the milestone prompt, only synthetic / sanitized text belongs here — the in-memory store provides no encryption or access control.

---

## ADR-012 — Pluggable persistence behind a `PersistenceAdapter` interface

**Source:** Milestone 3E scope; ADR-011's "future milestone will swap the storage layer" commitment.

**Decision:** All server-side state access (`ProjectState`, `AuditLog`, `IssueDecisionHistoryEntry`) goes through a single `PersistenceAdapter` interface (`packages/web/lib/persistence/types.ts`). Two adapters ship in 3E:

1. **`MemoryPersistenceAdapter`** — the default. Same `globalThis`-pinned Map as 3D, now wrapped in the interface. CI and `npm run dev` use it without any env var.
2. **`FilePersistenceAdapter`** — opt-in via `PERSISTENCE_DRIVER=file`. Writes per-project files under `PERSISTENCE_FILE_PATH` (default `./.contractops-data/`):
   - `<id>.project.json` — full `ProjectState` snapshot (rewritten on save).
   - `<id>.audits.jsonl` — one `AuditLog` per line, append-only.
   - `<id>.history.jsonl` — one `IssueDecisionHistoryEntry` per line, append-only.
   Append-only is enforced at the adapter: a duplicate id throws `AppendOnlyViolationError` before the disk write.

**Consequence:**

- Memory remains default. `PERSISTENCE_DRIVER` set to anything other than `memory` or `file` throws at boot (`UnknownPersistenceDriverError`). `sqlite` is reserved for a future adapter and currently throws — there is no silent fallback.
- The file adapter is **local dev / demo only**. No auth, no encryption, no replication, no multi-process locking. Real production durability lands in a future milestone (PostgreSQL or similar) behind the same interface; only `lib/persistence/` adds a third file.
- `.contractops-data/`, `.tmp-e2e-data/`, and `*.db` / `*.sqlite` / `*.sqlite3` are gitignored, and `npm run repo:hygiene` refuses to allow them to be tracked.
- Generated `.docx` and `_cover_email.md` artifacts are never written into the persistence root — `ExportFile.content` is a text summary, not the binary.
- Real confidential source documents MUST NOT be POSTed into either adapter. PLATFORM_BRIEF.md §10 and §12 rule 6 still apply.

---

## ADR-013 — Demo actor registry (per-actor demo, NOT authentication)

**Source:** Milestone 3F scope; PLATFORM_BRIEF.md §7 (human lawyer roles) + §12 rule 4 (AuditLog).

**Decision:** The web app exposes an "Acting as" dropdown in the global header that lets a demo user pick one of three predefined actors:

- `lawyer_kim` (`human_lawyer`) — registry default
- `lawyer_park` (`human_lawyer`) — second lawyer, for hand-off / override scenarios
- `business_choi` (`user`) — non-lawyer; blocked from lawyer-only ops

The registry lives in `packages/web/lib/demo-actors.ts` and is shared between client and server. Every `/api/projects` and `/api/projects/[id]/operations` request includes an `actor_id` field; the server resolves it against the registry and rejects unknown ids with HTTP 400 (`UnknownActorError`). The resolved `Actor` (with `id`, `role`, `display_name`) flows through `applyOperationToStore` → core's `agg*` functions, so the existing role guards (`actor.role === "human_lawyer"`) fire as designed when `business_choi` attempts an approval.

**Consequence:**

- **NOT AUTHENTICATION.** No password, no session, no OAuth, no SSO, no real RBAC. The "Acting as" selector is a name-picker, and the registry is the entirety of "authorization". Do not deploy this app to a public URL until a future milestone replaces it with real auth.
- AuditLog entries (`AuditLog.actor`) and IssueDecisionHistory entries (`IssueDecisionHistoryEntry.actor_id` + `.actor_role`) now reflect the selected demo actor instead of a single hardcoded `DEMO_LAWYER`. Decision changes by different lawyers append a multi-actor trail, asserted by the multi-actor E2E.
- Existing core role guards stay the source of truth. Adding new lawyer-only ops doesn't require changes here — they inherit the protection automatically.
- Client-side selection is persisted in `localStorage` under `contractops:demo-actor` and is per-browser-context. The Playwright multi-actor spec leverages this to seed each context with a different actor via `addInitScript`.
- The legacy `DEMO_LAWYER` / `DEMO_USER` constants in `lib/actions.ts` and `lib/server-aggregate-context.ts` now alias the registry default (`lawyer_kim`) and `business_choi` respectively; the IDs they expose changed (`lawyer_demo` → `lawyer_kim`, `user_demo` → `business_choi`) but no test depended on the literal old values.

---

## ADR-014 — Lawyer-only UI affordances (UI guards are convenience, server is authority)

**Source:** Milestone 3G scope; ADR-013 demo actor registry.

**Decision:** Pages disable lawyer-only buttons in the browser when the selected demo actor's role is not `human_lawyer`, using a single helper `canActAsLawyer(actor)` exported from `packages/web/lib/demo-actors.ts` and a `useCurrentActor()` hook on the `StoreProvider`. Disabled buttons carry a `title` attribute with the bilingual message `REQUIRES_LAWYER_MESSAGE` ("변호사 권한이 필요한 작업입니다 (Requires human_lawyer)"); pages also render an inline `data-testid="lawyer-required-note"` warning when the selected actor cannot proceed.

Guarded surfaces (all call sites already protected by core's `actor.role === "human_lawyer"` checks):

- `/projects/[id]/contract-type` — confirm-type-btn
- `/projects/[id]/deal-memo` — approve-deal-memo-btn
- `/projects/[id]/drafting-plan` — approve-plan-btn
- `/projects/[id]/issues` — accept-btn / reject-btn / defer-btn / partial-accept-btn / re-accept-btn-* / re-reject-btn-* / re-defer-btn-* / re-partial-btn-*
- `/projects/[id]/qa` — approve-final-btn
- `/projects/[id]/exports` — every `create-export-<type>-btn` (clean DOCX, commentary DOCX, negotiation matrix, cover email)

**Consequence:**

- **UI is convenience. Server is authority.** The `POST /api/projects/[id]/operations` route still resolves the supplied `actor_id` against the demo registry and rejects lawyer-only ops attempted by `business_choi` with HTTP 422. The Playwright spec asserts both: the UI button is disabled AND a forced API call returns 422.
- The legacy "happy path" specs (`nda-happy-path`, `multi-session`, `multi-actor`) all run with `lawyer_kim` as the default actor, so adding the disabled-on-non-lawyer rule does not regress them — they were already only ever clicked as a lawyer.
- No new dependency. The `title` attribute drives the tooltip; no JS tooltip library.
- A future real-auth milestone replaces the demo registry chokepoint without changing the UI guards: `canActAsLawyer` still receives a fully-formed `Actor`, just one that came from a real session token instead of a `localStorage` selection.
- Production deployment **still requires real authentication and authorization**. The UI guard is not a security boundary; only the server-side role check is.

---

## ADR-015 — PostgreSQL adapter behind the same `PersistenceAdapter` interface (Milestone 3H)

**Source:** Milestone 3H scope; ADR-012 (pluggable persistence).

**Decision:** Add a third `PersistenceAdapter` implementation, `PostgresPersistenceAdapter`, backed by the [`pg`](https://www.npmjs.com/package/pg) node-postgres driver. Selectable via `PERSISTENCE_DRIVER=postgres` + `DATABASE_URL`. Memory remains the CI / default; file remains the local-dev option; Postgres is the durable, multi-process option.

The schema is bootstrapped lazily on first read or write through idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements emitted by the adapter itself — there is **no migration framework** (no Prisma, no Drizzle, no Knex). The four tables mirror the existing in-memory + file shapes:

```
contractops_projects                 — id PK, name, status, created_at
contractops_project_states           — project_id PK FK, state JSONB (overwritten on save)
contractops_audit_logs               — id PK, project_id FK, entry JSONB (append-only)
contractops_issue_decision_history   — id PK, project_id FK, entry JSONB (append-only)
```

`createProject` and `saveProjectState` wrap multi-row writes in `BEGIN / COMMIT / ROLLBACK` via `pool.connect()`. `appendAuditLog` and `appendDecisionHistory` catch PostgreSQL's `23505` unique-violation SQLSTATE on duplicate-id INSERTs and rethrow as `AppendOnlyViolationError`, so the append-only contract is byte-identical to the memory and file adapters.

Test infrastructure:

- The adapter targets a minimal `PgPoolLike` interface (`query / connect / end`), not `pg.Pool` directly. Unit tests inject `FakePgPool` (in-memory SQL pattern matcher; throws synthetic `{ code: "23505" }` on duplicate INSERTs) and run the same contract suite as memory and file (`persistence-adapter.test.ts`).
- A separate `persistence-postgres-unit.test.ts` covers postgres-specific deep tests (bootstrap idempotency, transactional rollback on `createProject` collisions, `close() → pool.end()` forwarding).
- A gated integration test (`persistence-postgres-integration.test.ts`, `POSTGRES_INTEGRATION=true` + `DATABASE_URL`) runs the same scenario against a real PostgreSQL endpoint. CI never sets the gate.

`pg` isolation is enforced the same way `openai`, `@anthropic-ai/sdk`, and `docx` are: the `no-sdk-imports` test refuses any `import "pg"` outside `packages/web/lib/persistence/postgres-adapter.ts`. The Next webpack config aliases `pg: false` on the client and includes `pg` in `experimental.serverComponentsExternalPackages`.

**Consequence:**

- Adding the Postgres adapter required **zero** changes to `core` workflow code, API routes, the StoreProvider, or any UI page. The boundary established by ADR-012 worked exactly as designed.
- `npm run verify` is unchanged — memory remains the default, so the standard CI pipeline doesn't require Postgres. Switching to Postgres is always the operator's deliberate choice (`PostgresConfigError` blocks startup if `DATABASE_URL` is missing; **no silent fallback** to memory).
- The schema is the simplest thing that satisfies the persistence contract: JSONB everywhere except the project summary table. We can normalize later if a future feature actually needs it; over-normalizing now would lock us into a migration framework before we know which queries matter.
- Postgres fixes **durability and concurrency**. It does NOT fix identity, RBAC, encryption-at-rest beyond what the DB provides, or row-level access control. ADR-013 (demo actor) and ADR-014 (lawyer-only guards) remain in place; production deployment still requires real authentication and project-level authorization on top — Postgres is necessary but not sufficient.
- Confidential source documents remain forbidden in any adapter (PLATFORM_BRIEF.md §10, §12 rule 6). The Postgres adapter is no exception. Generated `.docx` and `_cover_email.md` binaries are still never stored — `ExportFile.content` is a text summary inside the JSONB ProjectState column.
- TLS is opt-in via `POSTGRES_SSL=true` (passes `rejectUnauthorized: false`, suitable for managed providers like Supabase / Neon / RDS that present chains the local trust store doesn't carry). Hardened deployments should swap `createPgPool` for a factory that passes a real CA bundle.

---

## ADR-016 — Server-side auth boundary; operation routes must NOT trust `actor_id` in the request body (Milestone 3I)

**Source:** Milestone 3I scope; ADR-013 (demo actor registry); ADR-014 (lawyer-only UI guards).

**Decision:** Introduce a single server-side seam, `AuthSessionResolver` in `packages/web/lib/auth/`, that every API route uses to answer "who is making this request?". The only Milestone 3I implementation is `DemoSessionAuthProvider`, which reads the actor id from a server-set `contractops_demo_actor` cookie and validates it against the existing `DEMO_ACTOR_REGISTRY`. Workflow operation routes (`POST /api/projects`, `POST /api/projects/[id]/operations`) **REJECT** any request body that carries `actor_id` — the field is no longer a transport concern, it is server-resolved.

Cookie shape:

```
contractops_demo_actor=<actor_id>; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000
```

Set + cleared via three new routes — `GET /api/auth/session`, `POST /api/auth/demo/actor`, `DELETE /api/auth/demo/actor` — that are the ONLY way to change the active actor. The browser no longer writes the cookie directly (`httpOnly: true`) and no longer reads or persists actor state in `localStorage`.

The boundary itself is the interface in `lib/auth/types.ts`:

```ts
interface AuthSession { actor: AuthActor; source: "demo_cookie" | "demo_default" }
interface AuthSessionResolver {
  resolveSession(request: Request): Promise<AuthSession | null>;
  resolveActor(request: Request):   Promise<AuthSession>;
}
```

with two helper functions every route calls instead of touching cookies or the registry directly: `resolveActorFromRequest(request)` and `requireAuthenticatedActor(request)`. In demo mode both fall back to `lawyer_kim` when no cookie is present; an INVALID cookie always throws `InvalidSessionError` (never silently downgrades). The distinction between the two helpers documents intent for the future real-auth swap, where `requireAuthenticatedActor` will throw `UnauthenticatedError` instead of defaulting.

Test infrastructure:

- `tests/auth-demo-session.test.ts` — pure-function tests of `DemoSessionAuthProvider`, `parseCookieHeader`, and the resolver façade. Covers default fallback, valid cookie, invalid cookie (throws), and the unknown-vs-missing distinction.
- `tests/auth-routes.test.ts` — imports the App Router route handlers directly and invokes them with constructed `Request` objects (no Next dev server). Asserts `GET /api/auth/session` defaults / cookie / invalid; `POST + DELETE /api/auth/demo/actor`; `POST /api/projects` and `POST /api/projects/[id]/operations` REJECT `body.actor_id` with `OPERATION_ACTOR_ID_FORBIDDEN` (400); a `business_choi` cookie cannot approve Deal Memo (422); a `lawyer_park` cookie succeeds where Choi failed.
- `packages/web/e2e/multi-actor.spec.ts` — three browser contexts each seeded with a different actor cookie via `setDemoActorCookie(context, id)`. Asserts the audit trail shows the correct actor per request, that `business_choi`'s `decide_issue` is rejected with 422, that a forced `body.actor_id="lawyer_kim"` from the Choi context is rejected with 400, and that an unknown actor cookie returns 401.
- `packages/web/e2e/lawyer-ui-guards.spec.ts` — switches the dropdown (which now calls `POST /api/auth/demo/actor`) and asserts the server still rejects forced approvals from the Choi cookie. Also asserts the 400 on attempted `body.actor_id` impersonation.

Implementation note — Next.js App Router compiles each route handler as its own server-side module, which can produce a SECOND copy of `InvalidSessionError` whose `instanceof` check on objects thrown from `@/lib/auth` returns false in dev. Each route uses a small `isInvalidSession(err)` predicate that matches on `err.code === "INVALID_SESSION"` instead of `instanceof`. The string code lives on the prototype and survives module duplication, while still being unique enough to never accidentally match an unrelated error.

**Consequence:**

- **`body.actor_id` impersonation is impossible.** A logged-in `business_choi` cannot pretend to be `lawyer_kim` by hand-editing one field in a POST body — the rejection fires BEFORE the operation runs. This closes the most obvious attack on the 3F-era demo, where a malicious browser could trivially elevate itself.
- **Cookie identity is the single source of "who".** AuditLog + IssueDecisionHistory entries always reflect the cookie-resolved actor, not anything the client sent. The append-only contracts established in 3C / 3E / 3H are unchanged; they just stamp a more trustworthy actor.
- **Multi-context multi-actor demo works naturally.** Different browser contexts get different cookie jars, so three Playwright contexts each seeded with a different actor cookie can drive the workflow without any client-side wiring. The `multi-actor` spec proves this end-to-end.
- **Persistence is untouched.** Memory / file / Postgres adapters all keep working. The auth boundary lives strictly above the persistence boundary; both follow the same "single interface, swap implementations later" pattern.
- **NOT production authentication.** No password, no signed token, no rate limit, no audit of the auth events themselves. Anyone who can reach the Next.js process can become any registry actor via one POST. Production deployment **still requires** a real identity provider, a user table, a project-membership table, and per-project RBAC. The migration path is:
  1. Replace `DemoSessionAuthProvider` with a real `AuthSessionResolver` backed by a signed JWT or DB-backed session table.
  2. Add user + project-membership tables; tighten `requireAuthenticatedActor` to throw on missing sessions.
  3. Layer per-project lawyer assignments on top of the existing `role === "human_lawyer"` check.
  4. Keep `POST /api/auth/demo/actor` only behind an explicit `DEMO_AUTH=true` flag for local dev.
- **No new dependencies.** Cookie parsing is a 10-line helper; cookie setting is `NextResponse.cookies.set`. No `cookie`, `iron-session`, `next-auth`, or signing library was added. When the future real-auth milestone arrives it will pull in exactly the deps it needs — not before.
