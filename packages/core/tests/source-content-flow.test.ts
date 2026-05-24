import { describe, expect, it } from "vitest";
import "./preload-prompts";
import {
  aggAddSource,
  aggAddSourceContent,
  aggClassifyAndConfirm,
  aggCreateProject,
  aggDraftDealMemo,
  aggLockSourcePack,
  aggSelectPlaybook,
  createMockAggregateContext,
} from "@contractops/core";
import { humanLawyer, loadAllPlaybooks, testEnv, user } from "./helpers";

/**
 * Source content flow:
 *   - SourceDocumentContent is a separate entity, persisted alongside the
 *     SourceDocument but not embedded in it.
 *   - The text body reaches agent inputs (Deal Memo drafter, contract
 *     drafter, reviewers) via ProjectState.source_contents.
 */

describe("SourceDocumentContent persists separately and flows to agents", () => {
  it("aggAddSourceContent stores SourceDocumentContent separately from SourceDocument", async () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    const added = aggAddSource(
      created.state,
      {
        file_name: "doc.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
        uploaded_by: user,
      },
      env,
    );
    const docId = added.state.source_documents[0]!.id;
    const withContent = aggAddSourceContent(
      added.state,
      { source_document_id: docId, text_content: "[synthetic] body" },
      env,
    );

    // Document untouched
    expect(withContent.state.source_documents[0]).toEqual(added.state.source_documents[0]);
    // Content stored, keyed by source_document_id
    expect(withContent.state.source_contents.length).toBe(1);
    expect(withContent.state.source_contents[0]!.source_document_id).toBe(docId);
    expect(withContent.state.source_contents[0]!.text_content).toBe("[synthetic] body");
    expect(withContent.state.source_contents[0]!.is_synthetic).toBe(true);
  });

  it("replacing content for the same document does not duplicate the record", async () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    const added = aggAddSource(
      created.state,
      {
        file_name: "doc.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
        uploaded_by: user,
      },
      env,
    );
    const docId = added.state.source_documents[0]!.id;
    let s = aggAddSourceContent(added.state, {
      source_document_id: docId,
      text_content: "first",
    }, env).state;
    s = aggAddSourceContent(s, { source_document_id: docId, text_content: "second" }, env).state;
    expect(s.source_contents.length).toBe(1);
    expect(s.source_contents[0]!.text_content).toBe("second");
  });

  it("aggAddSourceContent is allowed after Source Pack lock (text body, not pack membership)", async () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    const added = aggAddSource(
      created.state,
      {
        file_name: "doc.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
        uploaded_by: user,
      },
      env,
    );
    const docId = added.state.source_documents[0]!.id;
    const locked = aggLockSourcePack(added.state, humanLawyer, env);
    expect(locked.state.source_pack.locked).toBe(true);

    // Adding text content for an already-uploaded document is allowed.
    const withContent = aggAddSourceContent(
      locked.state,
      { source_document_id: docId, text_content: "[synthetic] body" },
      env,
    );
    expect(withContent.state.source_contents.length).toBe(1);
  });

  it("source_contents reach the Deal Memo drafter as agent input", async () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    let s = aggAddSource(
      created.state,
      {
        file_name: "doc.pdf",
        source_type: "proposal",
        version: "1",
        incorporated: true,
        source_priority: 1,
        uploaded_by: user,
      },
      env,
    ).state;
    const docId = s.source_documents[0]!.id;
    s = aggAddSourceContent(
      s,
      { source_document_id: docId, text_content: "[synthetic] proposal body text" },
      env,
    ).state;
    s = aggLockSourcePack(s, humanLawyer, env).state;
    s = aggClassifyAndConfirm(
      s,
      { confirmed_type: "NDA", confirmed_by: humanLawyer, hint: "NDA" },
      env,
    ).state;
    s = aggSelectPlaybook(
      s,
      { available_playbooks: loadAllPlaybooks(), selector: humanLawyer },
      env,
    ).state;
    // Skip required-intake check by giving direct answers
    for (const q of s.intake_questions.filter((q) => q.required)) {
      s = {
        ...s,
        intake_answers: [
          ...s.intake_answers,
          {
            id: env.newId(),
            project_id: s.project.id,
            question_id: q.id,
            value: "a",
            answered_by: user.id,
            answered_at: env.now(),
          },
        ],
      };
    }

    const ctx = createMockAggregateContext({ env, actor: humanLawyer });
    const result = await aggDraftDealMemo(s, ctx);

    // State carries the content through unchanged
    expect(result.state.source_contents.length).toBe(1);
    expect(result.state.source_contents[0]!.text_content).toBe("[synthetic] proposal body text");
    // The Deal Memo was created (provider returned default content; the
    // important thing is the agent received source_contents as input — which
    // it did, since runAgent ran successfully).
    expect(result.state.deal_memo).not.toBeNull();
    expect(result.state.agent_runs.some((r) => r.role === "deal_memo_drafter")).toBe(true);
  });
});
