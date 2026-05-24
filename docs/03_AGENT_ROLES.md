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

- cross-reference checks;
- date calculation;
- amount format checks;
- forbidden expression detection;
- version / header checks;
- numbering checks;
- repeated undefined term candidate extraction.

Deterministic QA MUST NOT be replaced by LLM review (PLATFORM_BRIEF.md §5 rule 13).

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
