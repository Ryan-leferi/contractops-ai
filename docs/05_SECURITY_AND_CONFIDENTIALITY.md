# 05 — Security and Confidentiality

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §5 (rules 10–11), §10, §12.

## Secrets

1. Do NOT hardcode secrets.
2. Read API keys from environment variables only.
3. No secret may be committed to the repository or to a fixture.

## Documents and access

4. Source documents are stored with project-level access control.
5. Internal commentary documents are confidential. They MUST never be sent externally and MUST never appear in the external clean export (PLATFORM_BRIEF.md §5 rule 7).

## Test data

6. Do NOT send real confidential source documents to test environments.
7. Fixtures MUST be synthetic or sanitized. See [fixtures/README.md](../fixtures/README.md) and PLATFORM_BRIEF.md §10.
8. BOF-style fixtures are reference fixtures only. BOF facts MUST NOT be hardcoded into platform logic (see ADR-009 in `docs/08_ARCHITECTURE_DECISIONS.md`).

## Audit

9. Keep AuditLog entries for: project creation, source upload, Source Pack lock, Playbook confirmation, Deal Memo approval, Drafting Plan approval, Issue Card decisions, revision generation, final approval, export (PLATFORM_BRIEF.md §12 rule 4).
10. Preserve model outputs and prompt versions for audit (PLATFORM_BRIEF.md §12 rule 7).

## Mock mode

11. Mock mode is required.
12. Mock mode MUST remain operable even after real APIs are integrated (PLATFORM_BRIEF.md §5 rule 12 and §12 rule 8).

## Operational hard rules

13. AI MUST NOT externally send a contract (PLATFORM_BRIEF.md §5 rule 2).
14. Marking a contract as final requires human approval (PLATFORM_BRIEF.md §5 rule 3).
