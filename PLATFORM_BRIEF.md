# ContractOps AI — Platform Brief

## 1. Product Identity

ContractOps AI is a browser-based web application for Korean in-house legal teams.

It helps lawyers create, review, revise, QA, annotate, and negotiate many types of contracts using multiple AI models in a controlled workflow.

It is not a single-contract generator.
It is not limited to event, booth, marketing, influencer, supply, NDA, service, or license contracts.
It is not a general chatbot.
It is not an autonomous legal decision-maker.

AI drafts and reviews.
The human lawyer decides and approves.

## 2. Universal Contract Workflow

1. User creates a contract project.
2. User uploads source documents.
3. System creates and locks a Source Pack.
4. System classifies or suggests contract type.
5. Human lawyer confirms contract type.
6. System selects a Contract Playbook.
7. System generates required intake questions from the Playbook.
8. User answers intake questions.
9. AI creates Deal Memo.
10. Human lawyer approves Deal Memo.
11. AI creates Drafting Plan.
12. Human lawyer approves Drafting Plan.
13. GPT drafts v0 contract.
14. Claude reviews from counterparty counsel perspective.
15. Gemini checks source consistency against source documents.
16. GPT checks Korean legal style, structure, definitions, and cross-references.
17. Python deterministic QA checks dates, amounts, cross-references, numbering, version, and forbidden expressions.
18. Findings become Issue Cards.
19. Human lawyer approves, partially approves, rejects, or defers each Issue Card.
20. Revision Agent applies only approved or partially approved Issue Cards.
21. Human lawyer approves final draft.
22. System exports:
    - external clean DOCX;
    - internal legal commentary DOCX;
    - negotiation matrix;
    - cover email draft.

Every substantive contract change must be traceable to:

1. an Issue Card; and
2. a human lawyer decision.

## 3. Contract Playbook

A Contract Playbook is a reusable drafting and review guide for a contract type.

Each Playbook must define:

1. contract_type
2. contract_family
3. legal_characterization
4. required_intake_questions
5. optional_intake_questions
6. default_table_of_contents
7. mandatory_clauses
8. optional_clauses
9. common_risks
10. red_flags
11. source_document_expectations
12. drafting_style_notes
13. negotiation_positions
14. fallback_clauses
15. final_qa_checklist

If no suitable Playbook exists, the system uses Custom Contract mode.

In Custom Contract mode, the system may propose a temporary Drafting Plan, but a human lawyer must approve it before drafting.

## 4. Initial Playbooks for MVP

MVP should include only a small number of sample playbooks:

1. NDA
2. Service Agreement / 업무위탁계약
3. Event Booth Entry / 행사 부스 입점계약
4. Custom Contract

The system must be designed so more Playbooks can be added later.

## 5. Non-Negotiable Rules

1. AI must not make final legal decisions.
2. AI must not externally send a contract.
3. AI must not mark a contract as final without human approval.
4. Every substantive change must be traceable to an Issue Card.
5. Rejected Issue Cards must never be applied.
6. External clean version and internal commentary version must be separated.
7. Internal commentary must never appear in the external version.
8. Source Pack must be locked for a final contract version.
9. Contract draft generation requires approved Deal Memo and approved Drafting Plan.
10. API keys must never be hardcoded.
11. Confidential documents must not be used in tests.
12. Mock mode must exist even after real API integration.
13. Deterministic QA must not be replaced by LLM review.
14. The system must support Korean legal drafting conventions.

## 6. Korean Legal Drafting Principles

1. Prefer “하여야 한다”, “할 수 있다”, “하지 아니한다.”
2. Use Korean numbering:
   - Article: 제1조
   - Paragraph: ①, ②, ③
   - Item: 1., 2., 3.
   - Sub-item: 가., 나., 다.
3. If an article has only one paragraph, paragraph numbering may be omitted.
4. Avoid “기타”; prefer “그 밖의.”
5. Avoid “함에 있어.”
6. Avoid unnecessary English contract translation tone.
7. Avoid unnecessary “결과손해”; prefer “간접손해 또는 특별손해” when appropriate.
8. Repeated technical terms should be defined inline or through a definition clause.
9. Do not overcomplicate contracts.
10. Keep contracts signable and operationally useful.

## 7. AI Model Roles

GPT:

- contract structure;
- Deal Memo;
- Drafting Plan;
- v0 drafting;
- revision integration;
- Korean legal style review;
- legal commentary generation;
- final QA assistance.

Claude:

- counterparty counsel review;
- adversarial review;
- negotiation risk detection;
- likely counterparty pushback;
- redline response support.

Gemini:

- source consistency review;
- proposal/guide/email comparison;
- schedule/fee/table consistency;
- long source document synthesis.

Python QA:

- cross-reference checks;
- date calculation;
- amount format checks;
- forbidden expression detection;
- version/header checks;
- numbering checks;
- repeated undefined term candidate extraction.

Human lawyer:

- confirms contract type;
- approves Playbook or Custom Drafting Plan;
- approves Deal Memo;
- approves or rejects Issue Cards;
- approves final draft;
- decides legal risk and negotiation position;
- authorizes external delivery.

## 8. Issue Card

All review findings must become Issue Cards.

Issue Card fields:

- issue_id
- project_id
- source_agent
- severity: critical | high | medium | low
- location: article, paragraph, item
- issue_type
- problem
- why_it_matters
- recommended_revision
- business_impact
- recommended_action: accept | revise | reject | defer
- human_decision: pending | accepted | partially_accepted | rejected | deferred
- applied_version

No substantive revision may be applied unless the Issue Card has a human_decision of accepted or partially_accepted.

Rejected Issue Cards must never be applied.

## 9. Source Pack

A Source Pack is the locked set of documents used to create a contract version.

It may include:

- proposal;
- email;
- term sheet;
- quote;
- existing contract;
- operation guide;
- policy;
- internal memo;
- counterparty request;
- redline draft.

A final contract version must state which Source Pack it is based on.

The system must preserve:

- file name;
- upload date;
- source type;
- version;
- whether it is incorporated into the contract;
- source priority.

## 10. Reference Fixtures

Reference fixtures are sample projects used for testing the platform.

Fixtures must be synthetic or sanitized.
They must not contain confidential full source documents.

A BOF-style event booth fixture may be used to test:

- source pack;
- event booth playbook;
- no on-site sales risk;
- booth type differences;
- refund policy;
- penalty and damages review;
- source inconsistency review.

BOF facts must not be hardcoded into generic platform logic.

## 11. MVP Scope

MVP must include:

1. project list;
2. project creation;
3. source upload;
4. source document tagging;
5. Source Pack lock;
6. contract type selection or mock classification;
7. Playbook selection;
8. required intake questions;
9. intake answer entry;
10. mock Deal Memo;
11. Deal Memo approval;
12. mock Drafting Plan;
13. Drafting Plan approval;
14. mock v0 contract draft;
15. mock multi-model reviews;
16. Issue Tracker;
17. issue decision buttons;
18. revision generation from approved issues only;
19. mock final QA;
20. export page with placeholder outputs.

MVP must NOT include:

1. real GPT/Claude/Gemini API calls;
2. real DOCX export;
3. external sending;
4. full Word-like editor;
5. n8n integration;
6. LangGraph integration;
7. SharePoint integration;
8. electronic signature integration.

## 12. Security Principles

1. Do not hardcode secrets.
2. Use environment variables for API keys.
3. Store source documents with project-level access control.
4. Keep audit logs for project creation, source upload, Source Pack lock, Playbook confirmation, Deal Memo approval, Drafting Plan approval, Issue Card decisions, revision generation, final approval, and export.
5. Internal commentary documents are confidential.
6. Do not send real confidential source documents to test environments.
7. Preserve model outputs and prompt versions for audit.
8. Mock mode is required.

## 13. Development Principles

1. Build generic platform, not a single-contract generator.
2. Build mock MVP first.
3. Before UI, implement Workflow Core and tests.
4. Do not connect real LLM APIs until mock workflow passes.
5. Do not implement real DOCX export until workflow and Issue Card logic pass.
6. Use tests to enforce legal workflow rules.
7. Build small milestones.
8. Avoid overengineering.
9. Avoid building a full contract editor in MVP.
10. Do not add dependencies without explaining why.
