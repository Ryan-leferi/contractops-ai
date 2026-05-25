# Fixtures

Reference fixtures used for testing the platform. See [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §10 and [docs/05_SECURITY_AND_CONFIDENTIALITY.md](../docs/05_SECURITY_AND_CONFIDENTIALITY.md).

## Rules

1. Fixtures MUST be synthetic or sanitized. No real confidential source documents.
2. Fixtures MUST NOT contain secrets.
3. Fixture content MUST NOT be referenced from platform code outside this directory or from tests for any purpose other than driving the workflow.

## BOF reference fixture

A BOF-style event booth fixture MAY live here. It is a sanitized reference, used to test:

- source pack;
- event booth playbook;
- no on-site sales risk;
- booth type differences;
- refund policy;
- penalty and damages review;
- source inconsistency review.

BOF is a fixture, NOT the platform's purpose. BOF-specific facts MUST NOT be hardcoded into platform logic. See ADR-009 in [docs/08_ARCHITECTURE_DECISIONS.md](../docs/08_ARCHITECTURE_DECISIONS.md).

## Alpha v0.1 evaluation fixtures (Milestone 4C)

Three sanitized fixtures drive the alpha evaluation runner (`npm run alpha:eval`):

| File | Contract type | Purpose |
|---|---|---|
| [`synthetic-nda.json`](synthetic-nda.json) | NDA | Bidirectional NDA, 24-month term, `example.test` counterparty. Exercises the confidentiality Playbook + intake. |
| [`synthetic-service-agreement.json`](synthetic-service-agreement.json) | Service Agreement | Synthetic vendor SOW + quote + milestone payments + SLA. Exercises the service Playbook + multi-source intake. |
| [`synthetic-booth-event.json`](synthetic-booth-event.json) | Event Booth Entry | Original Milestone 0 fixture, retained unchanged. Exercises the booth Playbook. |

All three are **synthetic** — `example.test` domains, obviously invented amounts, no real party / client / counterparty / BOF facts. They are loaded by `scripts/run-alpha-evaluation.ts` and `scripts/run-fixture.ts`. They MUST NOT be used to seed real workflows or pasted into real-mode runs.
