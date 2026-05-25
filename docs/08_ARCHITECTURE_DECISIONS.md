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
