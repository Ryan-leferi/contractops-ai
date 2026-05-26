# 03 — Agent Roles

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §7. Each model is used for what it does best. The human lawyer remains the decider.

## GPT

- contract structure;
- Deal Memo;
- Drafting Plan;
- v0 drafting;
- revision integration;
- Korean legal style review;
- legal commentary generation;
- final QA assistance.

## Claude

- counterparty counsel review;
- adversarial review;
- negotiation risk detection;
- likely counterparty pushback;
- redline response support.

## Gemini

- source consistency review;
- proposal / guide / email comparison;
- schedule / fee / table consistency;
- long source document synthesis.

> **Post-alpha Pilot P1 update.** Gemini is the intended backend for the
> new `review_synthesizer` role (Solo Drafting Loop) but is NOT
> implemented in P1. The synthesizer role + seam are wired with mock
> provider only; a future Google/Gemini provider plugs in via
> `selectProviderByName("google", ...)` + a one-line `tryReal()` branch
> without touching aggregate or role code. See ADR-022.

## review_synthesizer (NEW — Pilot P1)

Pilot P1 — Solo Drafting Loop only. Consumes the three reviewer outputs
(`counterparty_reviewer`, `source_consistency_reviewer`,
`legal_style_reviewer`) + the current draft and produces a structured
`RevisionSynthesisOutput`:

- groups duplicate findings across reviewers (one Issue Card group per
  underlying problem, with the worst severity preserved);
- triages by severity, top-down;
- flags reviewer conflicts (e.g., "delete" vs "rewrite") + recommends
  a resolution;
- drops low-confidence items or items contradicted by Playbook
  `mandatory_clauses`;
- emits a clause-scoped imperative instruction package
  (`instructions_for_gpt_revision`) that the next `revision_agent` run
  embeds verbatim;
- preserves EVERY source `issue_card_id` in `source_issue_card_ids`
  (provenance — `aggSynthesizeReviews` refuses to persist a synthesis
  that dropped any pending id).

Hard rules:

- The synthesizer NEVER mutates contract content. It only produces an
  instruction package + an AgentRun.
- The synthesizer NEVER decides Issue Cards (the lawyer's decisions
  remain authoritative).
- The synthesizer NEVER bypasses Issue Cards (rejected/deferred cards
  are still invariant-excluded from the next revision).

Mock-only in P1. The role agent + AgentRun fields + provider seam are
identical to the other LLM roles, so wiring a real Gemini provider in a
later pilot is a one-line addition to `tryReal()`.

## Python QA (deterministic, NOT LLM)

Implemented as the **Deterministic QA engine** (Milestone 2D) under
`packages/core/src/qa/`. Code-based checks only — no LLM, no provider, no
network call. Findings become Issue Cards with `source_agent =
"deterministic_qa"` and flow through the same accept / partially_accept /
reject / defer decision path as any other Issue Card.

Checks shipped:

- forbidden expression detection (기타 → 그 밖의, 함에 있어, 결과손해, 20K, 해석되지 아니한다, 취득하지 못한다, …)
- Korean numbering check (제N조 / ① / 1. / 가. ordering and presence)
- cross-reference resolution (제N조, 제N조 제M항, 제N조 제M항 제K호)
- amount format consistency (금 1,000,000원 vs 100만 원 vs 1,000,000원)
- date format consistency (2026. 6. 19. vs 2026년 6월 19일 vs 2026.06.19)
- clean / commentary leakage scan (법무주석, [COMMENTARY], [INTERNAL], [REDLINE_RATIONALE], [NEGOTIATION_GUIDANCE])
- undefined technical term candidates (repeated uppercase abbreviations + platform vocab)

**Mutual non-replacement** (PLATFORM_BRIEF.md §5 rule 13):

- Deterministic QA MUST NOT be replaced by LLM review.
- LLM `final_qa_assistant` MUST NOT be replaced by deterministic QA.
- Both run on the final QA step (`aggRunMockFinalQA`): the deterministic pass
  fires FIRST and is guaranteed to run even if the LLM call fails; the LLM
  pass runs second on top.
- Neither replaces a human lawyer. Every finding from either engine becomes
  an Issue Card that a lawyer must accept, reject, partially-accept, or
  defer.

The deterministic engine emits a `deterministic_qa_run` AuditLog entry with
`qa_engine: "deterministic"`, the finding count, and which check ids ran.
It does NOT emit an AgentRun (AgentRun is reserved for LLM provider calls).

## Human lawyer

- confirms contract type;
- approves Playbook or Custom Drafting Plan;
- approves Deal Memo;
- approves or rejects Issue Cards;
- approves final draft;
- decides legal risk and negotiation position;
- authorizes external delivery.

## Mock mode

In mock mode, every AI agent returns canned, deterministic output suitable for end-to-end testing. Mock mode MUST remain available even after real APIs are integrated (PLATFORM_BRIEF.md §5 rule 12 and §12 rule 8).
