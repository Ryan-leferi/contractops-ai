# Alpha v0.1 — Readiness Checklist (Milestone 4C)

> **Frozen 2026-05-25.** This checklist is the area-by-area review backing the Alpha v0.1 freeze declaration in [`README.md`](../README.md#status). It is read-only after freeze except for documented bug / security / invariant fixes. Anything not on this list is post-alpha (see [`docs/11_POST_ALPHA_BACKLOG.md`](11_POST_ALPHA_BACKLOG.md)).

Status legend:

- ✅ Ready — implemented, tested, documented.
- ⚠ Limited — implemented for the alpha seam, NOT production-ready. See "Known limitations" rows.
- ❌ Out of scope — explicitly not in Alpha v0.1. Documented in the backlog only.

---

## 1. Workflow completeness

| Area | Status | Evidence |
|---|---|---|
| Project create / list / archive | ✅ | `aggCreateProject` + `/api/projects` route + `e2e/nda-happy-path.spec.ts` |
| Source upload (metadata + synthetic content) | ✅ | `aggAddSource` + `aggAddSourceContent` + Sources page textarea |
| Source Pack lock | ✅ | `aggLockSourcePack` + status guard; post-lock mutation throws |
| Contract classification + lawyer confirmation | ✅ | `aggClassifyAndConfirm` (lawyer-only) + `e2e/custom-contract.spec.ts` |
| Playbook selection + Custom Contract fallback | ✅ | `aggSelectPlaybook` + 4 sample Playbooks + `is_custom_marker` flag |
| Intake question generation + answer capture | ✅ | Per-Playbook required/optional questions + IntakeAnswer entity |
| Deal Memo draft + lawyer approve | ✅ | `aggDraftDealMemo` + `aggApproveDealMemo` (lawyer-only) |
| Drafting Plan draft + lawyer approve | ✅ | `aggDraftDraftingPlan` + `aggApproveDraftingPlan` (lawyer-only) |
| v0 contract draft generation | ✅ | `aggCreateV0` via `contract_drafter` role |
| Three-reviewer parallel review | ✅ | `aggRunMockReviews` (Promise.all over counterparty + source-consistency + legal-style) |
| Deterministic QA (non-LLM) | ✅ | `packages/core/src/qa/` — 7 checks, runs alongside LLM final QA, separate `source_agent = "deterministic_qa"` |
| LLM final QA assistant | ✅ | `aggRunMockFinalQA` via `final_qa_assistant` role |
| Issue Card decisions (4 outcomes + partial note + reason note) | ✅ | `aggDecideIssue` + `IssueDecisionHistoryEntry` append-only history (3C) |
| Revision agent applies only accepted / partially-accepted cards | ✅ | `aggCreateRevision` filters BEFORE prompt rendering; tested at unit + E2E level |
| Final approval (lawyer-only, no pending cards) | ✅ | `aggApproveFinal` + status guard |
| Exports (clean DOCX, commentary DOCX, cover email MD, negotiation matrix DOCX) | ✅ | `aggCreateExport` + `ExportRenderer` (3A/3B) — server-side, in-memory, never disk-persisted |
| **Known limitations** | ⚠ | Single-tenant; no org boundary; no external sending; no PDF conversion; no e-signature |

## 2. Source Pack lock

| Area | Status | Evidence |
|---|---|---|
| `lock_source_pack` op requires lawyer actor | ✅ | RBAC matrix in `packages/core/src/permissions.ts`; tested in `tests/permissions.test.ts` + `e2e/lawyer-ui-guards.spec.ts` |
| Source / source_content mutations refuse after lock | ✅ | `aggAddSource` + `aggAddSourceContent` assert pre-lock status |
| Source Pack id is recorded on every ContractVersion + export | ✅ | `source_pack_id` field; covered by `tests/repository.test.ts` |
| Locked Source Pack is part of every export's metadata | ✅ | ExportRenderer methods embed the source_pack_id; tested in `core/tests/export-renderer.test.ts` |

## 3. Playbook selection

| Area | Status | Evidence |
|---|---|---|
| 4 sample Playbooks (NDA, Service Agreement, Event Booth Entry, Custom Contract) | ✅ | `playbooks/*.json` |
| Playbook drives intake, mandatory clauses, common risks, red flags, fallback positions, final QA checklist | ✅ | `playbookSchema` in `packages/schemas/src/playbook.ts` + `tests/playbooks.test.ts` |
| Custom Contract enforces explicit Drafting Plan approval before v0 | ✅ | `aggCreateV0` guard + `e2e/custom-contract.spec.ts` |
| No contract-type literal branching in workflow code | ✅ | `core/tests/no-contract-literals.test.ts` |

## 4. Intake

| Area | Status | Evidence |
|---|---|---|
| Required intake questions surface per Playbook | ✅ | `aggSelectPlaybook` populates `intake_questions` |
| Optional intake answered separately | ✅ | `required: false` questions ignored by required-completeness checks |
| Required-question completeness gates Deal Memo drafting | ✅ | `aggDraftDealMemo` guard + `e2e/nda-happy-path.spec.ts` |

## 5. Deal Memo

| Area | Status | Evidence |
|---|---|---|
| Generated from Playbook + intake answers + Source Pack | ✅ | `runDealMemoDrafter` role agent |
| Lawyer approval gates the Drafting Plan stage | ✅ | Status transitions in `core/src/project-status.ts` |
| Real mode (OpenAI) opt-in via provider allowlist (2C backward compat) | ⚠ | Server only; not used in CI |

## 6. Drafting Plan

| Area | Status | Evidence |
|---|---|---|
| Generated per Playbook + Deal Memo | ✅ | `runDraftingPlanDrafter` role agent |
| Lawyer approval gates v0 generation | ✅ | Status guard + `e2e/custom-contract.spec.ts` |

## 7. v0 draft

| Area | Status | Evidence |
|---|---|---|
| Mock by default; output validated against `contractDraftOutputSchema` | ✅ | `runContractDrafter` + Zod schema + retry-once-then-throw on the OpenAI provider |
| Real OpenAI opt-in via `REAL_LLM_ROLE_ALLOWLIST=contract_drafter` (4A) | ⚠ | Gated; mock by default; tested in `tests/real-llm-routing-4a.test.ts` + `core/tests/real-llm-4a-routing.test.ts` |
| AgentRun records mode + provider_id + model_id + prompt_version | ✅ | Required schema fields; surfaced in Agent Runs UI panel |
| Invalid LLM output never produces a ContractVersion | ✅ | Aggregate op surfaces the throw; tested in `core/tests/real-llm-4a-routing.test.ts` |

## 8. Review

| Area | Status | Evidence |
|---|---|---|
| `counterparty_reviewer` (Anthropic real opt-in) | ⚠ | 4B wiring — requires role allowlist; mock by default; tested in `real-llm-routing-4b.test.ts` + `real-llm-4b-routing.test.ts` |
| `source_consistency_reviewer` (OpenAI real opt-in) | ⚠ | 4B wiring — same gate |
| `legal_style_reviewer` (OpenAI real opt-in) | ⚠ | 4B wiring — same gate |
| Three reviewers run in parallel inside `aggRunMockReviews` | ✅ | `Promise.all` over `resolveProvider(ctx, role)` for each |
| All review output validated by `issueCardListOutputSchema` | ✅ | Single Zod schema for all three reviewers |
| Findings become pending IssueCards seeded into ProjectState | ✅ | `createIssueCards` + `tests/issue-tracker.test.ts` |
| Gemini for source-consistency | ❌ | Not implemented in Alpha v0.1 (see ADR-021); `GOOGLE_API_KEY` reserved for post-alpha |

## 9. Issue Card decision

| Area | Status | Evidence |
|---|---|---|
| 4 decisions: accepted / partially_accepted / rejected / deferred | ✅ | `IssueHumanDecision` enum + `aggDecideIssue` |
| Lawyer-only | ✅ | RBAC matrix + UI guard + `e2e/lawyer-ui-guards.spec.ts` |
| Optional partial note + optional reason note | ✅ | `IssueCard.partial_note` + `IssueCard.reason_note` (3C) |
| Append-only decision history (every change captured) | ✅ | `decision_history` field + `tests/decision-history.test.ts` |
| Pending cards block final approval | ✅ | `aggApproveFinal` guard + `e2e/issues-tracker.spec.ts` |

## 10. Revision

| Area | Status | Evidence |
|---|---|---|
| Only accepted + partially_accepted cards seed the revision prompt | ✅ | Filter inside `aggCreateRevision`; tested at unit + E2E level |
| Rejected card text never appears in the revision content | ✅ | E2E heuristic in `e2e/real-contract-draft.spec.ts` + fixture invariant in this runner |
| Real OpenAI opt-in via `REAL_LLM_ROLE_ALLOWLIST=revision_agent` (4A) | ⚠ | Gated; mock by default |
| AgentRun provenance recorded | ✅ | Same fields as v0 |

## 11. Deterministic QA

| Area | Status | Evidence |
|---|---|---|
| 7 non-LLM checks (numbering, party references, definitions, governing-law presence, etc.) | ✅ | `packages/core/src/qa/checks/*.ts` |
| Runs independently of LLM final QA | ✅ | `aggRunDeterministicQA` + `aggRunMockFinalQA` |
| Findings become IssueCards with `source_agent = "deterministic_qa"` | ✅ | Tested in `tests/deterministic-qa.test.ts` + `e2e/deterministic-qa.spec.ts` |
| LLM review does NOT replace deterministic QA | ✅ | Both run; PLATFORM_BRIEF.md §5 rule 13 |

## 12. Final approval

| Area | Status | Evidence |
|---|---|---|
| Lawyer-only | ✅ | RBAC matrix + `e2e/lawyer-ui-guards.spec.ts` |
| Refuses when ANY Issue Card is pending | ✅ | `e2e/issues-tracker.spec.ts:203` |
| Sets `ContractVersion.final = true` and freezes the Source Pack pointer | ✅ | `aggApproveFinal` |
| Audit log captures approver actor + timestamp | ✅ | `final_approved` audit event |

## 13. Exports

| Area | Status | Evidence |
|---|---|---|
| Clean DOCX (external) | ✅ | `build-clean.ts` — forbidden-marker scrub asserted in tests + E2E |
| Commentary DOCX (internal only banner + footer) | ✅ | `build-commentary.ts` |
| Cover email Markdown (internal — never sent) | ✅ | `build-cover-email.ts` — explicit "system does NOT auto-send" line |
| Negotiation matrix DOCX (internal only banner + decision matrix + per-card detail) | ✅ | `build-negotiation-matrix.ts` |
| All four exports gated by `final = true` | ✅ | API route `/api/exports/render` + RBAC `export_artifact` permission |
| docx package kept out of client bundle (SDK isolation test) | ✅ | `core/tests/no-sdk-imports.test.ts` |
| Bytes never written to disk on server | ✅ | Streaming response; tested in `e2e/exports.spec.ts` |

## 14. Auth / session

| Area | Status | Evidence |
|---|---|---|
| Demo actor cookie (default) | ✅ | `DemoSessionAuthProvider` (3I) |
| Signed-cookie session with HS256-signed JWT + in-memory user store | ⚠ | 3J wiring — single-process only; not production identity |
| Auth event audit (login, logout, demo actor switch) | ✅ | `MemoryAuthEventStore` (3K) + dev/admin `/api/auth/events` route |
| OAuth / SSO / NextAuth | ❌ | Out of scope (see backlog) |
| Enterprise IdP integration | ❌ | Out of scope |

## 15. RBAC

| Area | Status | Evidence |
|---|---|---|
| 4 project roles: `owner_lawyer`, `reviewer_lawyer`, `business_contributor`, `business_viewer` | ✅ | `ProjectRole` enum (3L) |
| Permission matrix over 20+ operations | ✅ | `packages/core/src/permissions.ts` + `tests/permissions.test.ts` |
| Project creator auto-added as `owner_lawyer` | ✅ | Auto-membership in server-store; tested in `tests/membership-routes.test.ts` |
| Server enforces permission BEFORE provider routing | ✅ | API route guard fires first; tested in `e2e/membership-rbac.spec.ts` |
| Body `actor_id` impersonation rejected for signed sessions | ✅ | `resolveOperationActor` (3J) + `e2e/multi-actor.spec.ts` |
| Org-level tenancy | ❌ | Not implemented in alpha (see backlog) |

## 16. Audit / security logs

| Area | Status | Evidence |
|---|---|---|
| Append-only domain AuditLog (one entry per side-effect) | ✅ | `core/tests/audit-append-only.test.ts` |
| Append-only auth/security event log | ✅ | `MemoryAuthEventStore` (3K) |
| Provider provenance on every LLM-driven audit event (provider_id, mode, agent_run_id) | ✅ | Asserted in `scripts/run-fixture.ts` + scenarios |
| Decision history captures every IssueCard decision change | ✅ | `IssueDecisionHistoryEntry` (3C) |
| Audit forwarding to a SIEM | ❌ | Not implemented (see backlog) |

## 17. Persistence

| Area | Status | Evidence |
|---|---|---|
| In-memory adapter (default; CI) | ✅ | `MemoryPersistenceAdapter` (3D + 3E) |
| File adapter (JSON + JSONL, durable local dev) | ✅ | `FilePersistenceAdapter` (3E) + gated E2E `e2e/durable-persistence.spec.ts` |
| PostgreSQL adapter (durable, multi-process) | ✅ | `PostgresPersistenceAdapter` (3H) + gated integration test |
| Boot rejects unknown driver values | ✅ | `tests/persistence-postgres-unit.test.ts` |
| On-disk encryption beyond DB defaults | ❌ | Not implemented (see backlog) |

## 18. CI / hygiene

| Area | Status | Evidence |
|---|---|---|
| GitHub Actions workflow runs `npm run verify` on every push (mock-only) | ✅ | `.github/workflows/ci.yml` (2F) |
| `npm run verify` = test + typecheck + build + fixture + e2e + repo:hygiene | ✅ | Root `package.json` scripts |
| Repo hygiene scans for secrets + forbidden artifact paths on 275+ tracked files | ✅ | `scripts/check-repo-hygiene.mjs` |
| `.docx`, `.md` generated artifacts, `.env`, `DATABASE_URL` values blocked | ✅ | Hygiene script + `.gitignore` |
| Gated real-provider specs default to skip in CI | ✅ | `E2E_REAL_OPENAI`, `E2E_REAL_CONTRACT_DRAFT`, `E2E_REAL_REVIEW`, `E2E_SIGNED_AUTH`, `E2E_DURABLE_PERSISTENCE` all default to false |
| No real API keys ever held in CI | ✅ | None of the gated specs run on CI; CI workflow file does not set them |

## 19. Known limitations (Alpha v0.1)

These are intentional limits of the alpha. They are NOT bugs. Production work requires resolving them — see [`docs/11_POST_ALPHA_BACKLOG.md`](11_POST_ALPHA_BACKLOG.md).

1. **Auth is not production-grade.** Signed-cookie + in-memory user store. No OAuth, no SSO, no NextAuth, no enterprise IdP.
2. **No multi-tenant org boundary.** Single deployment; project-level RBAC only. Cross-org isolation is not implemented.
3. **External sending is not implemented.** No email send, no e-signature, no counterparty endpoint. Cover email is a Markdown download.
4. **No PDF conversion / no automated document ingestion.** Sources are metadata + manually pasted synthetic text. No OCR, no PDF parsing, no DOCX upload parsing.
5. **No retention / redaction / SIEM forwarding.** Append-only logs exist but stay in-process or in the configured persistence driver. Nothing is encrypted in transit between adapters; on-disk encryption is the driver's responsibility.
6. **Real-LLM mode is dev-only.** Mock is default in CI; gated E2Es require explicit env flags and use synthetic data only.
7. **Gemini is not implemented.** `source_consistency_reviewer` runs on OpenAI; `GOOGLE_API_KEY` is reserved for post-alpha.
8. **No production document storage.** Source content lives inside `ProjectState.source_contents` — fine for synthetic dev data, not for real confidential text at scale.
9. **No client-side encryption.** Browser → server is plain HTTPS; no end-to-end encryption.
10. **Use only synthetic data.** Real confidential documents must not be paste into any environment until items 1–9 are resolved AND explicitly approved.

## Acceptance criteria summary

| 4C acceptance criterion | Met |
|---|---|
| `npm run verify` passes | ✅ (Phase D) |
| Existing tests still pass | ✅ |
| Alpha evaluation script passes (or reports expected skipped items) | ✅ (Phase D) |
| Typecheck passes | ✅ |
| Next build passes | ✅ |
| Fixture harness passes | ✅ |
| Playwright demo E2E passes | ✅ |
| Repo hygiene passes | ✅ |
| No new product feature added | ✅ |
| No new provider added | ✅ |
| No external sending added | ✅ |
| No OAuth/SSO/NextAuth added | ✅ |
| No generated artifacts or secrets committed | ✅ |
| Alpha readiness checklist exists | ✅ (this file) |
| Alpha evaluation report exists | ✅ (`docs/10_ALPHA_EVALUATION_REPORT.md`) |
| Known limitations documented | ✅ (§19 above + README §"Security and production limitations") |
| Post-alpha backlog clearly separated | ✅ (`docs/11_POST_ALPHA_BACKLOG.md`) |
| Normal CI remains mock-mode | ✅ |
| Gated real-provider tests skipped by default | ✅ |
