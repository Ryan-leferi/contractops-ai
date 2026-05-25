# Post-Alpha Backlog (NOT scheduled)

> **Status: backlog, NOT a roadmap.** Nothing in this document is part of the Alpha v0.1 freeze (see [`docs/09_ALPHA_READINESS_CHECKLIST.md`](09_ALPHA_READINESS_CHECKLIST.md)). Items here are **not committed**, **not estimated**, **not prioritized**, and **not assigned**. Production deployment requires explicit go-ahead AND a separate planning pass against the items below.

Per the project's CLAUDE.md / AGENTS.md guardrails: do not start any item on this list as part of routine work. Bug fixes, security fixes, broken-invariant fixes, and documentation updates against the Alpha v0.1 freeze are the only sanctioned ongoing work after Milestone 4C.

---

## Security / identity (production-blocking)

- **B-SEC-01 — Real authentication provider.** Replace the signed-cookie + in-memory user store with a real IdP integration (the original brief permits Microsoft Entra ID via OAuth/OIDC; this is the most likely target). Implies session refresh, server-side session invalidation, password reset, MFA support. Out of scope for alpha per ADR-016 + ADR-017.
- **B-SEC-02 — SSO / enterprise IdP.** SAML or OIDC against the law-firm IdP. Depends on B-SEC-01 architecture.
- **B-SEC-03 — Multi-tenant organization boundary.** Today the platform has project-level RBAC (3L) but no org-level isolation. Production needs `Organization` as a first-class entity, per-org membership lists, and an admin UI for org membership separate from project membership.
- **B-SEC-04 — Audit forwarding to a SIEM.** AuditLog + auth event log are append-only in-process today. Production needs streaming to Splunk / Datadog / ELK / equivalent, with delivery guarantees.
- **B-SEC-05 — On-disk encryption of project state.** Persistence adapters use the underlying driver's defaults today. Production needs explicit at-rest encryption (KMS-backed envelope keys) for `ProjectState.source_contents` and exports.
- **B-SEC-06 — Real-document ingestion controls.** Server-side virus scanning, MIME validation, PII redaction pass, retention policy enforcement, hold-on-litigation support.
- **B-SEC-07 — Real-mode safety review.** Operational checklist for flipping any role to real mode against confidential data: data-residency review, vendor DPA, retention configuration on the LLM vendor, rate-limit budget, kill switch.
- **B-SEC-08 — Client-side encryption.** End-to-end encryption between the browser and the persistence layer so even compromised app-tier servers cannot read source content.
- **B-SEC-09 — Rate limiting + abuse controls on real-LLM seams.** Real-mode roles currently have no in-process rate limit; the LLM vendor's quotas are the only ceiling.

## Workflow / product features (post-alpha)

- **B-FEAT-01 — DOCX / PDF source ingestion.** Today source content is provided as pasted plain text. Production needs DOCX parsing, PDF parsing (PDFium or similar), OCR for scanned PDFs, and a content-pipeline UI.
- **B-FEAT-02 — Counterparty negotiation packet.** A combined export + counterparty-facing draft delivery flow. Requires B-EXT-01 (external sending) before it has any meaning.
- **B-FEAT-03 — Playbook editor UI.** Today Playbooks are JSON files hand-edited by the legal-engineering team. A web UI for editing Playbooks (with diff + approval) would let in-house lawyers maintain their own Playbooks.
- **B-FEAT-04 — Cross-project Playbook reuse analytics.** Decision history aggregation across projects to surface which clauses have the highest accept / reject rates, what reason notes lawyers leave, etc.
- **B-FEAT-05 — Custom Contract Drafting Plan editor.** Today the Custom Contract path generates a Drafting Plan via the LLM; lawyers can approve / reject but cannot edit. A structured editor for the Drafting Plan would unlock cleaner Custom Contract flows.
- **B-FEAT-06 — IssueCard bulk actions.** Bulk accept / reject / defer with a shared reason note.
- **B-FEAT-07 — Side-by-side version comparison.** Visual diff between two `ContractVersion`s. Today the platform stores versions but the UI shows them one at a time.
- **B-FEAT-08 — Source Pack diff after re-lock.** If a Source Pack is unlocked + edited + re-locked, surface what changed.

## External integrations (out of scope by guardrail)

These items are explicitly listed in the project guardrails as **never to be added**:

- **B-EXT-01 — External email sending.** PLATFORM_BRIEF.md §5 rule 2. The platform NEVER sends email.
- **B-EXT-02 — E-signature integration.** Not in scope for Alpha v0.1; not on the roadmap.
- **B-EXT-03 — PDF conversion / generation.** Exports are DOCX + Markdown only. Adding PDF would require a server-side renderer (Chromium-as-a-service or similar) and is explicitly out of scope.
- **B-EXT-04 — LangGraph / n8n orchestration.** Per the guardrails, agent orchestration stays inside the in-process aggregate ops. No external workflow engine.
- **B-EXT-05 — Webhook delivery.** No outbound webhooks. Consumers (a future SIEM, a future internal portal) would pull, not be pushed to.

## LLM / agent surface (post-alpha)

- **B-LLM-01 — Gemini provider for `source_consistency_reviewer`.** ADR-021 notes Gemini was the 4B brief's candidate backend; we chose OpenAI for alpha. `GOOGLE_API_KEY` is reserved in `.env.example` for this. Adding it post-alpha requires a new `GeminiProvider` (SDK isolation row in `no-sdk-imports.test.ts`), an Anthropic-style stub client interface, and a `selectProviderByName("google", ...)` branch.
- **B-LLM-02 — Per-role model override.** Today `OPENAI_MODEL` / `ANTHROPIC_MODEL` are global. Per-role override would let `contract_drafter` use a stronger model than the cheaper reviewers.
- **B-LLM-03 — Prompt evaluation harness.** A separate offline tool to score prompt versions against a held-out set of human-graded reference outputs. Out of scope for alpha; would be necessary before changing prompts in production.
- **B-LLM-04 — Token budget / cost accounting.** AgentRun records `token_usage` + `cost_estimate` but there is no UI / aggregation / monthly cap. Production needs at least an aggregate cost view + per-project ceiling.
- **B-LLM-05 — Streaming UI for long agent runs.** Today the UI waits on a single POST. Long real-mode calls would benefit from streaming progress.

## Persistence (post-alpha)

- **B-PERS-01 — Postgres production hardening.** The 3H adapter works for dev. Production needs migration tooling (no schema migrations exist today; the adapter bootstraps via `CREATE TABLE IF NOT EXISTS`), pooled connection management beyond the default, replication-aware writes, transactional batch operations, dead-letter handling on JSONL audit append failures.
- **B-PERS-02 — Object storage adapter for source content.** Inlining source content in `ProjectState.source_contents` is fine for synthetic dev data; production needs a separate object store (S3-compatible) with signed URLs, retention, and lifecycle policies.
- **B-PERS-03 — Backup / restore tooling.** No backup tooling exists today; the deployment is responsible for using the underlying DB's backups.

## CI / ops (post-alpha)

- **B-OPS-01 — Gated real-LLM smoke test in nightly CI.** The gated real-mode E2E specs (`E2E_REAL_OPENAI`, `E2E_REAL_CONTRACT_DRAFT`, `E2E_REAL_REVIEW`) run only on operator workstations today. A separate scheduled CI job with a dedicated synthetic-only API key + quota cap could exercise the seam on schedule.
- **B-OPS-02 — Dependency vulnerability scanning.** Repo hygiene scans for committed secrets / forbidden artifacts but not for outdated dependencies. `npm audit` is not in the verify gate.
- **B-OPS-03 — Performance budget.** No performance test exists; long source content + many Issue Cards could regress without notice.
- **B-OPS-04 — Production observability.** No structured logging adapter, no metrics export. Production needs OpenTelemetry instrumentation.

## Documentation gaps (post-alpha)

- **B-DOC-01 — Operator runbook.** Today the README documents how to develop. A production deployment would need: incident response for failed LLM calls, rotation of `AUTH_SESSION_SECRET`, key rotation for OpenAI/Anthropic, persistence-driver failover, audit log forwarding configuration.
- **B-DOC-02 — Legal-engineering playbook authoring guide.** Today Playbooks are documented by their schema only. A maintainer-facing guide on how to author a new Playbook with worked examples would help legal-engineering teams self-serve.
- **B-DOC-03 — User guide for lawyers.** The UI is functional but undocumented for end users.

## Process

When work resumes against this backlog:

1. Pick items in dependency order. Anything customer-facing depends on B-SEC-01..03 landing first.
2. Open a separate `5x` milestone family (e.g. `5A — Real auth`, `5B — Multi-tenant org boundary`) and reset the "current milestone" guidance in TASKS.md.
3. Treat the Alpha v0.1 freeze as the baseline. Any divergence from a 4A/4B/4C invariant requires an ADR explaining why and updating ADR-021 / ADR-020 if those are affected.
4. Do not implement multiple items at once. Each one is a separate milestone with its own readiness review.
