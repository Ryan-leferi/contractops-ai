# 00 — Product Context

Derived from [PLATFORM_BRIEF.md](../PLATFORM_BRIEF.md) §1, §2, §11. If this document and the brief disagree, the brief wins.

## Identity

ContractOps AI is a browser-based web application for Korean in-house legal teams.

It helps lawyers create, review, revise, QA, annotate, and negotiate many types of contracts using multiple AI models in a controlled workflow.

## What it is not

- Not a single-contract generator.
- Not limited to any one contract family (event, booth, marketing, influencer, supply, NDA, service, license, etc.).
- Not a general chatbot.
- Not an autonomous legal decision-maker.

## Who decides

AI drafts and reviews. The human lawyer decides and approves. Every substantive change is traceable to an Issue Card and a human decision.

## Multi-model design

The platform uses several models, each for what it does best. See `docs/03_AGENT_ROLES.md`.

## MVP shape

A scoped slice of the universal workflow. The full MVP includes project list, project creation, source upload and tagging, Source Pack lock, contract type selection, Playbook selection, intake questions, mock Deal Memo, mock Drafting Plan, mock v0 draft, mock multi-model reviews, Issue Tracker, revision generation from approved issues only, mock final QA, and an export page with placeholder outputs.

The MVP must NOT include real LLM calls, real DOCX export, external sending, full Word-like editor, n8n, LangGraph, SharePoint, or e-signature integration. See PLATFORM_BRIEF.md §11.

## Language and legal context

Korean legal drafting conventions are first-class. See `docs/02_PLAYBOOK_SYSTEM.md` and PLATFORM_BRIEF.md §6.
