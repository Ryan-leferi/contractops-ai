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
