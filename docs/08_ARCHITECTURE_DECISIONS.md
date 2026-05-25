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

---

## ADR-017 — Signed-cookie auth provider + minimal user store; demo mode stays the default (Milestone 3J)

**Source:** Milestone 3J scope; ADR-016 (auth boundary).

**Decision:** Add a SECOND `AuthSessionResolver` implementation — `SignedCookieAuthProvider` — backed by an HMAC-SHA256 signed session cookie and a minimal user store with PBKDF2-SHA256 password hashes. Mode selection is environment-driven (`AUTH_MODE`):

- `AUTH_MODE=demo` (default) keeps the 3I `DemoSessionAuthProvider` exactly as-is. Every existing test + the demo Playwright suite + the CI `npm run verify` pipeline are unaffected.
- `AUTH_MODE=signed_cookie` switches the factory in `session-resolver.ts` to the new provider. Routes still call `resolveActorFromRequest(request)` unchanged — the boundary added in ADR-016 absorbs the swap.

Configuration is centralized in `lib/auth/config.ts`. The parser refuses dangerous combinations at boot:

- `AUTH_MODE=signed_cookie` with no `AUTH_SESSION_SECRET` → `AuthSessionSecretMissingError`.
- `AUTH_MODE=signed_cookie` with `AUTH_SESSION_SECRET` < 32 chars → `AuthSessionSecretWeakError`.
- `NODE_ENV=production` with `AUTH_MODE=demo` → `DemoAuthInProductionError` unless `ALLOW_DEMO_AUTH_IN_PRODUCTION=true` (dev override).
- Unknown `AUTH_MODE` value → `UnknownAuthModeError`.

In `signed_cookie` mode, `DEMO_AUTH_ENABLED` defaults to `false` and `POST /api/auth/demo/actor` returns 403 `DEMO_AUTH_DISABLED`. The signed provider has no use for the demo cookie; silently accepting demo-actor POSTs would create a parallel identity channel that bypasses the signed session.

User store: `MemoryUserStore` implementing the `UserStore` interface (`getUserById`, `getUserByEmail`, `createUser`, `listUsers`, `setDisabled`, `clear`). Lives in process memory; restart wipes it. A future milestone replaces it with a Postgres-backed store, but the interface is the seam. Users are intentionally separate from the project `PersistenceAdapter` (3E/3H) so the two layers can evolve independently — for early staging it's plausible to want real auth + still-in-memory projects.

Password hashing: PBKDF2-HMAC-SHA256 from Node's stdlib `crypto` — no native binding to compile (rules out bcrypt / argon2 npm packages). 120k iterations, 16-byte salt, 32-byte derived key, encoded as `pbkdf2-sha256-v1$<iter>$<salt-b64url>$<key-b64url>`. The version prefix lets a future hardening milestone migrate to bcrypt / argon2id without invalidating existing hashes (rehash-on-next-login). Tests assert `password_hash !== plaintext` and exercise wrong-password / disabled-user / malformed-hash paths.

Signed session: payload `{ user_id, issued_at, expires_at }` (unix seconds) base64url-encoded, followed by `HMAC-SHA256(secret, payload)` — a small, audit-friendly subset of JWT. One fixed algorithm (no `alg: "none"` confusion), no unused claims. Verification uses `timingSafeEqual` for the signature comparison. Tests cover round-trip, tampered payload / signature rejection (`INVALID_SIGNATURE`), expired tokens (`EXPIRED`), and malformed input (`INVALID_TOKEN_SHAPE`).

Auth routes:

- `POST /api/auth/login { email, password }` — signed_cookie mode only. Returns 200 + Set-Cookie on success; 401 `INVALID_CREDENTIALS` (generic, no email-enumeration leak) on missing user / disabled user / wrong password; 400 `AUTH_MODE_MISMATCH` in demo mode.
- `POST /api/auth/logout` — clears both the signed cookie AND the demo cookie defensively, in both modes.
- `GET /api/auth/session` — extended to return `{ auth_mode, demo_enabled, authenticated, actor, source }` in both modes. The client uses `auth_mode` + `demo_enabled` to decide whether to render the demo dropdown vs. the login form.
- `POST /api/auth/dev/seed` — DEV-only, gated by `E2E_SIGNED_AUTH=true`. Seeds three sanitized users (`lawyer.kim@example.test`, `lawyer.park@example.test`, `biz.choi@example.test`) with the caller-supplied password. 403 otherwise.

Test infrastructure:

- `tests/auth-config.test.ts` (18 cases) — env parsing, mode defaults, secret-missing/weak/production guards.
- `tests/auth-password.test.ts` (6 cases) — hash ≠ plaintext, round-trip, wrong-password rejected, random salt, malformed hashes don't throw.
- `tests/auth-signed-token.test.ts` (8 cases) — sign/verify round-trip, tampered payload + signature + secret rejection, expiry boundary.
- `tests/auth-user-store.test.ts` (16 cases) — CRUD, duplicate-id + duplicate-email rejection, disabled flag, ordering, `seedDemoUsers` idempotency, `SignedCookieAuthProvider` end-to-end (valid cookie, tampered, expired, missing user, disabled user).
- `tests/auth-routes-signed.test.ts` (16 cases) — `/api/auth/login` (valid, unknown email, wrong password, disabled, malformed, wrong mode), `/api/auth/logout`, `/api/auth/session` in signed mode (anonymous, valid cookie, expired), demo route hardening, operations route in signed mode (body.actor_id rejected, no-cookie 401, role guard fires, lawyer succeeds + Audit records signed-in actor).
- `e2e/signed-auth.spec.ts` — gated Playwright; multi-context login/logout/role-rejection/impersonation-rejection/export-separation flow. CI never sets the gate.

**Consequence:**

- **The auth boundary (ADR-016) was sufficient as-designed.** Adding `SignedCookieAuthProvider` required ZERO changes to `core` workflow code, project routes, the persistence layer, or any page component. Only `session-resolver.ts` picked up a one-line `mode === "signed_cookie"` branch in the factory.
- **`npm run verify` is unchanged.** `AUTH_MODE` defaults to `demo`, so the standard CI pipeline keeps using the demo provider and every existing test passes. Switching to signed-cookie is always the operator's deliberate choice.
- **Demo-mode behavior is byte-identical to 3I.** Demo cookies, the actor dropdown, the multi-actor E2E — nothing about the demo flow changed. The new mode is purely additive.
- **Impersonation is still impossible.** Both modes share the 3I body.actor_id rejection. In signed_cookie mode, the impossibility extends to "no cookie at all" (401 instead of demo default).
- **Signed-cookie mode is NOT production authentication YET.** Still missing: OAuth / SSO integration, per-project RBAC (the role check is the same `actor.role === "human_lawyer"`), rate limiting on login, account lockout, MFA, password reset, email verification, audit of auth events themselves, and key-id support for secret rotation. ADR-017 is a **seam**, not a destination. Production deployment **still requires** all of the above.
- **Migration path is explicit.** 3K = OAuth / SSO provider (third `AuthSessionResolver`). 3L = per-project assignment + production RBAC. 3M = auth-event audit. 3N = hardening (rate limiting, MFA, password reset, CSRF tokens on logout). Each step adds capability without disturbing the already-shipped layers.
- **No new npm dependencies.** All crypto comes from Node's stdlib (`crypto.pbkdf2`, `crypto.createHmac`, `crypto.randomBytes`, `crypto.timingSafeEqual`). No `bcrypt`, `argon2`, `iron-session`, `jose`, `jsonwebtoken`, or `next-auth` was added. When a future milestone needs interoperability with another service or a hardened deployment, it will pull in exactly the deps it needs — not before.
- **No real users or real passwords in the repo.** The seeded users use the IANA-reserved `example.test` TLD (RFC 6761 §6.4) so the addresses can never reach a real mailbox. The seeding password is the obvious literal `"demo-password"`. `repo:hygiene` continues to refuse any committed secret pattern.

---

## ADR-018 — Append-only auth/security event log (Milestone 3K)

**Source:** Milestone 3K scope; ADR-016 (auth boundary); ADR-017 (signed-cookie + user store).

**Decision:** Introduce a SEPARATE append-only event log, `AuthEventStore`, that records authentication-layer transitions emitted by the 3I + 3J routes. It lives BESIDE `AuditLog` (which records workflow actions) — the two never share storage. The default implementation is `MemoryAuthEventStore` (in-process map); production replaces this with a real SIEM forwarder behind the same `AuthEventStore` interface.

Event types (closed set):

```
login_success
login_failed
logout
session_invalid
session_expired
session_tampered
demo_actor_switch
demo_auth_forbidden
```

Adding a new variant requires (a) extending the union in `lib/auth/auth-events.ts`, (b) adding the emit call from a route, (c) extending `tests/auth-events-routes.test.ts`. Tests fail loudly if a route emits a type that isn't in the union.

Schema (per event):

```
id              ae_<uuid>
event_type      one of the eight above
actor_id        resolved actor id; null pre-auth
user_id         signed-cookie user id; null in demo mode
email           normalized (lowercased + trimmed); set on login_*; null otherwise
occurred_at     ISO 8601
request_context { user_agent, ip, path, method } — all bounded, all nullable
result          "success" | "failure"
reason_code     short machine-readable, mirrors route response.code when one exists
metadata        bounded extras — NEVER passwords, tokens, secrets, cookies
```

Privacy design:

- **The route never passes the password to the recorder.** The login route handler holds the plaintext password just long enough to call `verifyPassword`; the recorder gets `metadata.detail` only (`UNKNOWN_EMAIL` / `WRONG_PASSWORD` / `DISABLED_USER`).
- **The route never passes the signed token to the recorder.** The session route handler catches `InvalidSessionError`, extracts the `cause_code` (`EXPIRED` / `INVALID_SIGNATURE` / `INVALID_TOKEN_SHAPE` / `UNKNOWN_USER` / `DISABLED_USER` / `UNKNOWN_ACTOR_COOKIE`), and emits the corresponding event with `reason_code = cause_code`. The cookie value itself is never read by the recorder.
- **The recorder defensively rejects forbidden metadata keys.** `FORBIDDEN_METADATA_KEYS = { password, password_hash, token, session_token, signature, cookie, secret, session_secret, auth_session_secret, api_key }` — any match (case-insensitive) makes the recorder drop the entire event with a console error. A route that accidentally tries to log a password records nothing at all, which is preferable to leaking one.
- **The privacy sweep test runs an end-to-end check.** After a failed-login → successful-login → logout cycle, `tests/auth-events-routes.test.ts` greps the entire event JSON for the test password, the wrong-password attempt, the signed token value, and the signing secret — all four MUST be absent.
- **Generic client error preserved.** All three `login_failed` branches return `{ code: "INVALID_CREDENTIALS", error: "invalid email or password" }`. The email-enumeration leak is in the EVENT LOG (which is internal, dev-gated), never in the response.

Dev inspect route: `GET /api/auth/events` is gated by `AUTH_EVENTS_INSPECT=true`. CI never sets the gate; the gated `signed-auth-events.spec.ts` Playwright spec is the only thing that flips it. The route has NO auth check beyond the env gate — it's a developer / E2E affordance, not a production admin API. Production deployment forwards events to a real SIEM and exposes them through that SIEM's UI.

Storage seam: `AuthEventStore` interface mirrors the established `PersistenceAdapter` pattern (driver-tagged, factory + `__resetForTests` helper). A future milestone replaces `MemoryAuthEventStore` with a file / Postgres / SIEM-forwarding implementation without touching any route handler or recorder.

**Consequence:**

- **Traceability without storage commitment.** Every auth transition is captured before a real SIEM is wired in. The shape of the event log is stable; switching the backend is a one-file change.
- **`npm run verify` is unchanged.** Memory store is the default; no new env vars are required in demo mode. The new test files (`auth-events.test.ts` + `auth-events-routes.test.ts`) run as part of the standard CI pipeline and add 38 cases. The gated `signed-auth-events.spec.ts` is skipped by default.
- **The login route does NOT regress its generic-error behavior.** Tests assert both the client-visible `INVALID_CREDENTIALS` AND the internal `metadata.detail` distinction. A future client regression that tried to leak the internal detail would fail both.
- **Multi-layer defense against password / token logging.** Three independent guards: (1) routes never pass secrets to the recorder; (2) the recorder rejects forbidden metadata keys; (3) the privacy sweep test catches anything the first two miss.
- **Auth events do NOT contaminate workflow `AuditLog`.** A future workflow audit reader (3M / 3N) won't see `login_success` events and won't have to filter them out; conversely the auth event log doesn't grow with workflow noise.
- **Append-only contract identical to other journals.** `AuthEventAppendOnlyViolationError` mirrors `AppendOnlyViolationError` on the persistence adapter — same semantics, same enforcement pattern.
- **NOT a production SIEM.** Still missing: real backend, alerting (e.g. on `login_failed` rate spikes per IP), retention policy, tamper-evident storage, integration with incident-response tooling. ADR-018 is the SEAM; the SIEM integration is a future milestone. Production deployment **still requires** a real security monitoring pipeline.
- **No new dependencies.** UUID v4 from `node:crypto.randomUUID`. No `winston`, `pino`, `bunyan`, or `@datadog/*` package added. The future SIEM-forwarder milestone pulls in exactly what the chosen backend needs.

---

## ADR-019 — Project membership stored inside ProjectState + minimal RBAC matrix (Milestone 3L)

**Source:** Milestone 3L scope; ADR-016 (auth boundary); ADR-017 (signed-cookie + user store).

**Decision:** Add per-project memberships as a small list inside `ProjectState.memberships: ProjectMembership[]`, gate every project-scoped route by a matrix-based permission check, and refuse to create a project when the resolved session actor is not a `human_lawyer`.

Membership shape (`packages/schemas/src/project-membership.ts`):

```
ProjectMembership {
  id            mem_<uuid>
  project_id    matches ProjectState.project.id
  actor_id      matches Actor.id  (resolved via session, never trusted from body)
  project_role  "owner_lawyer" | "reviewer_lawyer" | "business_contributor" | "business_viewer"
  created_at    ISO 8601
  created_by    actor_id of whoever granted it (the auto-grant uses the creator's own id)
  disabled_at   ISO 8601 or null   (soft-delete; never hard-removed, preserving the audit trail)
}
```

Storage trade-off: memberships live INSIDE `ProjectState` rather than in a separate journal at the persistence-adapter level. This was chosen because (a) memberships are bounded per-project (typically ≤ 10 rows), not append-only-forever; (b) every persistence adapter (memory / file / Postgres) handles `ProjectState` blob writes uniformly — no new `appendMembership` method needed; (c) the project list visibility filter requires N+1 reads which is acceptable for the MVP. A future milestone moves memberships to a normalized index table; the migration is contained because every route already goes through `loadActiveMembership` / `requireProjectPermission`.

Permission matrix (`packages/web/lib/auth/permissions.ts`):

```
owner_lawyer         every permission, incl. approve_final + manage_memberships
reviewer_lawyer      everything EXCEPT { approve_deal_memo, approve_drafting_plan,
                                          approve_final, manage_memberships }
business_contributor view_project + add_source + answer_intake + export_clean
business_viewer      view_project + export_clean (read-only)
```

`mapOperationToPermission(op)` maps every `Operation` variant to exactly one permission and fails CLOSED (returns `null` → 403) for unmapped ops — adding a new `Operation` without touching the map can't accidentally open a hole. `mapExportTypeToPermission(type)` does the same for `export_clean` (any member) vs `export_internal` (lawyer-only — commentary + negotiation matrix).

Server-side enforcement flow:

```
route → resolveActorFromRequest    (3I / 3J session)
      → getProjectState
      → requireProjectPermission(state, actor.id, mapOperationToPermission(op))
              ├── no membership     → ProjectAccessDeniedError      → 403 PROJECT_ACCESS_DENIED
              ├── role lacks perm   → ProjectPermissionDeniedError  → 403 PROJECT_PERMISSION_DENIED
              └── allowed           → continue
      → applyOperationToStore        (core role guard still in place as defense in depth)
```

Auto-membership: `createProjectInStore` adds an `owner_lawyer` membership for the creator atomically (single `adapter.createProject(state, creationAudit)` call) and emits a `membership_created` AuditLog row. A non-lawyer creator is refused at this point (`NonLawyerCannotCreateProjectError` → 403 `NON_LAWYER_CANNOT_CREATE_PROJECT`) so an unmanageable project can never be created.

Membership management API (owner-only):

```
GET    /api/projects/[id]/memberships                          any active member
POST   /api/projects/[id]/memberships                          owner_lawyer
DELETE /api/projects/[id]/memberships/[membership_id]          owner_lawyer
```

Granting a lawyer-typed project role to a non-lawyer global actor is refused (`PROJECT_ROLE_REQUIRES_LAWYER` → 403). Disabling the LAST active `owner_lawyer` is refused (`CANNOT_REMOVE_LAST_OWNER` → 422). Disabling is soft — the row stays for the audit trail (`disabled_at` is set, never deleted), so `membership_disabled` AuditLog entries paired with the original `membership_created` give a complete history.

UI: `/projects/[id]/members` shows the caller's `my_project_role`, the full membership list, and (for owners) the add / disable controls. The page hides controls the caller can't use, but every action goes through the same authoritative server check — no devtools bypass.

Test infrastructure:

- `tests/permissions.test.ts` (40+ cases) — exhaustive matrix truth table + operation/export mappers.
- `tests/project-authz.test.ts` (15+ cases) — `loadActiveMembership` / `requireProjectMembership` / `requireProjectPermission` happy paths + every error mode (no_membership, membership_disabled, permission_denied).
- `tests/membership-routes.test.ts` (15+ cases) — route handlers via direct invocation: GET filter, GET-by-id denial, audit-log/decision-history lawyer-only, operations permission check, body.actor_id rejection still fires, add member happy + duplicate + lawyer-role guard, disable happy + last-owner refusal + non-owner denial.
- `e2e/membership-rbac.spec.ts` — full multi-context owner → reviewer → contributor flow (kim creates, kim adds park as reviewer, park decides, kim adds choi as contributor, choi can view/answer-intake, choi cannot approve/decide/export-internal, body.actor_id spoofing rejected).
- Updated existing specs (multi-actor, lawyer-ui-guards) to seed memberships before switching actors — old "lawyer-only" 422 paths are now 403 from the matrix layer.

**Consequence:**

- **Authoritative authorization.** Every project read AND every mutation passes through `requireProjectPermission` (or its sibling `requireProjectMembership`) on the server BEFORE the operation runs. UI guards remain a UX convenience.
- **Non-member projects don't leak.** `GET /api/projects` filters by `isProjectVisibleTo`; `GET /api/projects/[id]` returns 403 with a uniform shape so an outsider can't even confirm a project exists.
- **Body actor_id spoofing remains rejected (3I invariant).** The membership check fires AFTER the body.actor_id rejection but on top of it — three independent layers (cookie → membership → core role) must all pass.
- **Adding a new permission or role is a one-file change.** The matrix is the single source of truth. Forgetting to wire a new permission fails closed at runtime AND fails the test suite (the matrix test asserts the exhaustive truth table).
- **Auto-membership preserves single-actor demos.** Every existing test that ran as `lawyer_kim` keeps working because Kim is auto-granted `owner_lawyer` at creation. Multi-actor specs needed one explicit membership grant call before secondary actors could act.
- **NOT production RBAC.** Still missing: organization-level multi-tenancy, group sync (SCIM / Workday / Azure AD), per-jurisdiction policy, per-record ACLs, time-bounded delegations, role inheritance, fine-grained content sensitivity (PII / privileged-communication tagging). Production deployment must layer real OAuth/SSO + group-derived membership + jurisdiction-aware policy on top — post-Alpha. ADR-019 is a MINIMAL seam, not the final model.
- **No new dependencies.** Membership ids come from `node:crypto.randomUUID`. No `casl`, `accesscontrol`, `oso`, or policy-engine package added.
- **Server-store remains the integration point.** The two new helpers (`addMembershipToProject`, `disableMembershipInProject`) live next to `applyOperationToStore` and use the same persistence adapter, the same audit-log append path, and the same idempotency semantics. A future Postgres-backed membership index reuses the same helper surface.

---

## ADR-020 — Per-role real-LLM allowlist for contract_drafter + revision_agent (Milestone 4A)

**Source:** Milestone 4A scope; ADR-016 (auth boundary), ADR-019 (project RBAC), Milestone 2C (OpenAI provider seam), Milestone 2E (Anthropic provider seam).

**Decision:** Wire the existing provider seam so the `contract_drafter` (v0 draft) and `revision_agent` (revision version) roles can run against the existing OpenAI provider when real mode is explicitly enabled. Add a new `REAL_LLM_ROLE_ALLOWLIST` env var as a SECOND independent gate (on top of `USE_REAL_LLM` + `LLM_PROVIDER_ALLOWLIST` + the matching API key). No new provider SDK, no new agent role, no new aggregate operation.

Gating semantics (per role):

```
deal_memo_drafter (2C):     USE_REAL_LLM + LLM_PROVIDER_ALLOWLIST.includes("openai")
                            + OPENAI_API_KEY   → real / else mock
counterparty_reviewer (2E): USE_REAL_LLM + LLM_PROVIDER_ALLOWLIST.includes("anthropic")
                            + ANTHROPIC_API_KEY → real / else mock
contract_drafter (4A):      ALL of the above (openai variant) AND
                            REAL_LLM_ROLE_ALLOWLIST.includes("contract_drafter")
                                                 → real / else mock
revision_agent (4A):        ALL of the above (openai variant) AND
                            REAL_LLM_ROLE_ALLOWLIST.includes("revision_agent")
                                                 → real / else mock
```

Backward compat: 2C / 2E roles intentionally DO NOT require a `REAL_LLM_ROLE_ALLOWLIST` entry. Existing deployments that already set `USE_REAL_LLM=true` + `LLM_PROVIDER_ALLOWLIST=openai,anthropic` for the Deal Memo + counterparty reviewer roles continue to work without touching their env. The role allowlist is a NEW additive gate that applies only to the roles introduced in 4A — adding a third role to real mode in the future will follow the same pattern.

Why the extra gate (rather than reusing the provider allowlist alone)? `contract_drafter` produces the entire v0 contract body (longest, costliest call) and `revision_agent` mutates it; both are higher-stakes than a single-page Deal Memo. Coupling them to the same provider switch would mean flipping `USE_REAL_LLM=true` to enable the Deal Memo silently enables full real-mode contract generation. The 4A gate makes that an explicit, audit-trail-friendly ops decision.

Implementation surface (server-only):

- `packages/core/src/env-config.ts` — adds `REAL_LLM_ROLE_ALLOWLIST: string[]` to `EnvConfig` + the default. CSV-parsed via the existing `parseList` helper.
- `packages/web/lib/server-aggregate-context.ts` — `tryReal(role)` extended with two new branches (contract_drafter + revision_agent) that check the role allowlist before calling `core.selectProviderByName("openai", envConfig)`.
- No changes to `selectProvider` / `selectProviderByName` / agent functions / aggregate ops / API routes / proxy providers. The existing `getProvider(role)` seam introduced in 2C absorbs the new wiring.
- No changes to `prompts/contract_drafter.md` or `prompts/revision_agent.md` — both already meet the 4A spec (Playbook-driven, mandatory clauses, source list, intake, Korean drafting conventions, no internal commentary in body, strict JSON output).

Structured output validation: handled by the existing `OpenAI provider's completeJson` path — schema validation against `contractDraftOutputSchema` / `revisionOutputSchema`, single corrective retry on the first JSON-shape failure, throw on the second. The aggregate dispatcher converts the throw into a failed `AgentRun` row without appending a `ContractVersion`. Tests assert: invalid output → no version added.

AgentRun provenance: already complete in the schema (provider_id, model_id, mode, role, prompt_version, input_hash, output_json, status, started_at, completed_at, token_usage, cost_estimate, error_message). The real-mode runs populate every field; the existing Agent Runs UI panel from 2C already shows `provider_id` + `mode`.

Rejected Issue Cards: the revision agent prompt already lists only `accepted` + `partially_accepted` cards (filtered inside `aggCreateRevision` BEFORE the prompt is rendered). Tests assert the rejected card's `issue_id` does NOT appear in the prompt text sent to the provider.

Test infrastructure:

- `packages/core/tests/env-config.test.ts` — extended with `REAL_LLM_ROLE_ALLOWLIST` CSV-parse cases + default value.
- `packages/core/tests/real-llm-4a-routing.test.ts` (NEW) — 6 cases: `aggCreateV0` routes through real OpenAI when `getProvider("contract_drafter")` returns it, AgentRun records mode=real + provider_id=openai, invalid drafter output → no ContractVersion; `aggCreateRevision` routes through real OpenAI for `revision_agent`, rejected/deferred Issue Card ids are NEVER in the prompt, invalid revision output → no new version; default mock context routes every role to mock.
- `packages/web/tests/real-llm-routing-4a.test.ts` (NEW) — 10 cases: `buildServerAggregateContext` honors the role allowlist; missing `REAL_LLM_ROLE_ALLOWLIST` keeps drafter + revision on mock even with `USE_REAL_LLM=true` + `LLM_PROVIDER_ALLOWLIST=openai`; explicit allowlist enables them independently; missing `OPENAI_API_KEY` silently falls back to mock; wrong provider allowlist (anthropic-only) keeps drafter on mock; 2C `deal_memo_drafter` + 2E `counterparty_reviewer` retain backward-compat gating.
- All 4 EnvConfig literal sites in core tests (`provider.test.ts`, `anthropic-provider.test.ts`, `no-sdk-imports.test.ts`) updated to include `REAL_LLM_ROLE_ALLOWLIST: []`.
- `packages/web/e2e/real-contract-draft.spec.ts` (NEW, gated) — `E2E_REAL_CONTRACT_DRAFT=true`-gated end-to-end flow: kim creates project from synthetic source text, walks to drafting_plan_approved, generates v0 via real OpenAI, mixes accept/reject Issue Card decisions, generates revision via real OpenAI, asserts AgentRun provenance + content non-empty + rejected card text NOT in revision.

**Consequence:**

- **Mock remains the default.** Every existing test passes unmodified except the four EnvConfig literal additions. `npm run verify` does not touch the network.
- **2C + 2E behavior unchanged.** Deployments using the Deal Memo or counterparty reviewer real mode do not need to update their env. The new role allowlist is additive.
- **No new SDK import.** Neither `openai` nor `@anthropic-ai/sdk` is imported outside the two provider files the SDK isolation test already permits.
- **No new aggregate operation, no new client UI flow.** From the UI's perspective, generating v0 still POSTs `{ name: "create_v0" }` to `/api/projects/[id]/operations`; the routing decision happens entirely inside `server-aggregate-context.ts`. The Generate v0 / Generate revision buttons keep working identically — only the body content changes when real mode is fully configured.
- **RBAC from 3L preserved.** The membership check (`view_project` / `create_v0` / `create_revision` permission via `mapOperationToPermission`) fires BEFORE the provider routing, so `business_contributor` / `business_viewer` can NEVER trigger a real OpenAI call, even with real mode enabled.
- **Invalid LLM output cannot become a ContractVersion.** The provider's JSON validator + retry-once + throw-on-second-failure path was already in place from 2C; the aggregate dispatcher surfaces the throw and skips the state mutation. Tests pin this contract.
- **NOT production-ready for confidential documents.** The Alpha v0.1 spec is explicit: use synthetic / sanitized source text only. Real client data awaits production security controls (auth + RBAC ✓ for the seam, retention policy ✗, redaction ✗, audit forwarding to SIEM ✗, on-disk encryption beyond DB defaults ✗).
- **Forward path is 4B.** Real review / source-consistency seam reuses the same `REAL_LLM_ROLE_ALLOWLIST` mechanism — adding `counterparty_reviewer_real` / `source_consistency_reviewer` entries follows the same pattern as 4A.

## ADR-021 — Per-role real-LLM allowlist for the three review roles + BREAKING change to counterparty_reviewer (Milestone 4B)

**Source:** Milestone 4B scope ("Real Review and Source Consistency Seam"); ADR-020 (4A per-role allowlist); Milestone 2E (Anthropic provider seam + original `counterparty_reviewer` real wiring).

**Decision:** Extend the `REAL_LLM_ROLE_ALLOWLIST` gate from 4A to cover all three review roles — `counterparty_reviewer`, `source_consistency_reviewer`, `legal_style_reviewer` — and route them as:

```
counterparty_reviewer (4B):       USE_REAL_LLM + LLM_PROVIDER_ALLOWLIST.includes("anthropic")
                                  + ANTHROPIC_API_KEY
                                  + REAL_LLM_ROLE_ALLOWLIST.includes("counterparty_reviewer")
                                                                  → real (anthropic) / else mock
source_consistency_reviewer (4B): USE_REAL_LLM + LLM_PROVIDER_ALLOWLIST.includes("openai")
                                  + OPENAI_API_KEY
                                  + REAL_LLM_ROLE_ALLOWLIST.includes("source_consistency_reviewer")
                                                                  → real (openai) / else mock
legal_style_reviewer (4B):        USE_REAL_LLM + LLM_PROVIDER_ALLOWLIST.includes("openai")
                                  + OPENAI_API_KEY
                                  + REAL_LLM_ROLE_ALLOWLIST.includes("legal_style_reviewer")
                                                                  → real (openai) / else mock
```

No new provider SDK. No new agent role (the three reviewer functions already exist from 2A/2E and already share the `IssueCardListOutput` schema). No new aggregate operation (`aggRunMockReviews` already calls all three via `resolveProvider(ctx, role)` inside a `Promise.all` from 2C/3D).

**BREAKING change vs 2E — `counterparty_reviewer`.** In 2E this role was gated by `LLM_PROVIDER_ALLOWLIST` alone (parallel to the 2C `deal_memo_drafter` backward compat). 4B revokes that backward compat and now requires `counterparty_reviewer` on `REAL_LLM_ROLE_ALLOWLIST` too. Existing 2E deployments that flipped `USE_REAL_LLM=true` for the counterparty reviewer MUST add `counterparty_reviewer` to `REAL_LLM_ROLE_ALLOWLIST` to keep real mode; otherwise the role silently falls back to the in-process mock (no errors, no network calls).

We accept the break for three reasons:

1. **Consistency.** Having ONLY `deal_memo_drafter` on provider-allowlist-only gating is much easier to explain than having two separate rules ("2C + 2E roles bypass role allowlist; 4A + 4B roles require it"). After 4B every real-capable review role goes through the same explicit per-role gate.
2. **Cost + sensitivity envelope.** A real `counterparty_reviewer` call sends the full contract body + Playbook + source pack to Claude — same risk profile as the 4A `contract_drafter`. It deserves the same explicit ops opt-in.
3. **Single deployer at this stage.** The Alpha v0.1 spec is explicit that real mode is for synthetic-data dev runs only. The "ops surface" of 2E real mode is the same handful of developers running it locally; the migration cost is one env var.

**Gemini is intentionally NOT implemented.** The 4B scope listed Gemini as the candidate backend for `source_consistency_reviewer`. The brief allows it as a candidate but does not require it. We kept `source_consistency_reviewer` on OpenAI to avoid adding a third SDK + auth path (and a `mock__1bd1bb0f__web_search`-class isolation row in the no-SDK test) right before the Alpha freeze. `GOOGLE_API_KEY` remains in `.env.example` reserved for post-alpha. The decision is reversible: the same `REAL_LLM_ROLE_ALLOWLIST` mechanism would route `source_consistency_reviewer` to a future Gemini provider without touching `aggRunMockReviews` or the role agent.

**`legal_style_reviewer` is included.** The 4B scope made this role optional ("if safely supported"). All three review roles share the same `IssueCardListOutput` Zod schema, so the risk profile (prompt-injection surface, hallucinated findings, output validation) is identical to the other two — the Issue-Card-decision invariants from 3C apply unchanged regardless of which reviewer produced the finding. Excluding it would leave one of the three reviewers permanently on mock and split the operational story. Including it costs one extra branch in `tryReal()` and three test files.

Implementation surface (server-only):

- `packages/web/lib/server-aggregate-context.ts` — `tryReal(role)` extended with three new branches (`counterparty_reviewer`, `source_consistency_reviewer`, `legal_style_reviewer`), each checking role allowlist + provider allowlist + API key before calling `core.selectProviderByName("anthropic" | "openai", envConfig)`. The 2E branch that previously bypassed the role allowlist is removed.
- No changes to `packages/core/src/aggregate.ts` — `aggRunMockReviews` already calls `resolveProvider(ctx, role)` for each of the three reviewers in parallel (Promise.all), so per-role routing flows through without further changes.
- No changes to `packages/core/src/agents/roles.ts` — the three reviewer agent functions (`runCounterpartyReviewer`, `runSourceConsistencyReviewer`, `runLegalStyleReviewer`) already exist and already validate output via `issueCardListOutputSchema`.
- No changes to `selectProvider` / `selectProviderByName` / API routes / proxy providers. Everything reuses the 2C `getProvider(role)` seam.
- No new prompt files — the three `prompts/*_reviewer.md` templates already meet the 4B output schema requirement.

AgentRun provenance: already complete (provider_id, model_id, mode, role, prompt_version, input_hash, output_json, status, started_at, completed_at, token_usage, cost_estimate, error_message). The 2C UI panel showing `provider_id` + `mode` automatically reflects the three new real routings without code changes.

Test infrastructure:

- `packages/web/tests/real-llm-routing-4a.test.ts` — counterparty_reviewer backward-compat test updated to assert the new 4B mock fallback (and now describes the role allowlist requirement; the old "2E backward-compat" assertion is retired).
- `packages/web/tests/real-llm-routing-4b.test.ts` (NEW) — 9 cases covering the three review roles individually and together: missing role allowlist → mock; both allowlists + API key → real (correct provider id per role); missing API key → mock; wrong provider on `LLM_PROVIDER_ALLOWLIST` → mock; mixed-provider success path (counterparty=anthropic, source_consistency=openai, legal_style=openai); non-review roles unaffected.
- `packages/core/tests/real-llm-4b-routing.test.ts` (NEW) — 5 cases at the core layer: `aggRunMockReviews` honors per-role routing (counterparty → real Anthropic with mode/provider_id provenance; source_consistency → real OpenAI; legal_style → real OpenAI), mixed-provider routing (all three real simultaneously), and default `createMockAggregateContext()` keeps every review role on mock.
- `packages/web/e2e/real-review.spec.ts` (NEW, gated) — `E2E_REAL_REVIEW=true`-gated end-to-end flow: kim creates project from synthetic source text, walks to a mock v0, calls `run_mock_reviews` so the three real reviewers run in parallel, asserts each AgentRun records mode=real + the correct provider_id, asserts every Issue Card's `source_agent` belongs to the allowed reviewer set.

**Consequence:**

- **Mock remains the default.** Every existing test passes unmodified (one assertion change in `real-llm-routing-4a.test.ts` reflects the documented BREAKING). `npm run verify` continues to make zero network calls.
- **Single explicit role-allowlist rule for every real-capable role except `deal_memo_drafter`.** Easier to document, easier to audit at deploy time.
- **2E deployments must update one env var.** Documented in this ADR + the `.env.example` comment on `ANTHROPIC_API_KEY` + the README real-mode table.
- **No new SDK import.** The SDK isolation test (`packages/core/tests/no-sdk-imports.test.ts`) still restricts `openai` to its provider file and `@anthropic-ai/sdk` to its provider file. Nothing in 4B touches that boundary.
- **No new aggregate operation, no new client UI flow.** The Review page's "Run reviews" button keeps POSTing `{ name: "run_mock_reviews" }` to `/api/projects/[id]/operations`. The routing decision is invisible to the UI; the Agent Runs panel from 2C automatically shows whichever providers ran.
- **RBAC from 3L preserved.** The membership check (`run_mock_reviews` permission via `mapOperationToPermission`) fires BEFORE the provider routing, so `business_contributor` / `business_viewer` can NEVER trigger a real Anthropic or real OpenAI call, even with real mode enabled.
- **Issue-Card-decision invariants from 3C unchanged.** Real-mode reviewer findings still seed pending Issue Cards; the human lawyer still has to decide each one before revision can run.
- **NOT production-ready for confidential documents.** Same caveat as 4A — synthetic data only until production security controls (auth + RBAC ✓, retention ✗, redaction ✗, audit forwarding to SIEM ✗, on-disk encryption beyond DB defaults ✗) ship.
- **Forward path is 4C.** Alpha Freeze & Evaluation: pin envs, lock the verify gate, document the limitations explicitly. No further real-LLM roles are wired in the Alpha v0.1 roadmap.
