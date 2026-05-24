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

## Status

No fixtures are yet written. They will be added in [TASKS.md](../TASKS.md) Milestone 2.
