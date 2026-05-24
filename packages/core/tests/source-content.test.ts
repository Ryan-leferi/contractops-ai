import { describe, expect, it } from "vitest";
import {
  aggAddSource,
  aggCreateProject,
  createInMemoryRepository,
  emptyProjectState,
  type ProjectState,
} from "@contractops/core";
import {
  sourceDocumentContentSchema,
  type SourceDocumentContent,
} from "@contractops/schemas";
import { testEnv, user } from "./helpers";

describe("SourceDocumentContent", () => {
  it("is a distinct entity keyed by source_document_id, separate from SourceDocument", () => {
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
    const doc = added.state.source_documents[0]!;

    // SourceDocument does not carry text body
    expect("text_content" in doc).toBe(false);

    // SourceDocumentContent references SourceDocument by id; not the other way
    const content: SourceDocumentContent = {
      source_document_id: doc.id,
      project_id: doc.project_id,
      content_type: "text",
      text_content: "synthetic content",
      language: "ko",
      is_synthetic: true,
      created_at: env.now(),
    };
    expect(sourceDocumentContentSchema.parse(content)).toEqual(content);
    expect(content.source_document_id).toBe(doc.id);
  });

  it("a Repository<SourceDocumentContent> stores content separately", () => {
    const repo = createInMemoryRepository<SourceDocumentContent>(
      (c) => c.source_document_id,
    );
    const sample: SourceDocumentContent = {
      source_document_id: "doc1",
      project_id: "p1",
      content_type: "text",
      text_content: "synthetic body",
      language: null,
      is_synthetic: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    repo.put(sample);
    expect(repo.get("doc1")).toEqual(sample);
    expect(repo.list().length).toBe(1);
  });

  it("emptyProjectState initializes source_contents as []", () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    expect(created.state.source_contents).toEqual([]);
  });

  it("ProjectState carries source_documents and source_contents as separate fields", () => {
    const env = testEnv();
    const created = aggCreateProject({ name: "T", created_by: user }, env);
    let state: ProjectState = created.state;
    state = aggAddSource(
      state,
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

    const doc = state.source_documents[0]!;
    // Attach content via a separate field (caller responsibility)
    const stateWithContent: ProjectState = {
      ...state,
      source_contents: [
        {
          source_document_id: doc.id,
          project_id: state.project.id,
          content_type: "text",
          text_content: "[synthetic] sample text",
          language: null,
          is_synthetic: true,
          created_at: env.now(),
        },
      ],
    };

    expect(stateWithContent.source_documents.length).toBe(1);
    expect(stateWithContent.source_contents.length).toBe(1);
    expect(stateWithContent.source_contents[0]!.source_document_id).toBe(doc.id);
    // Mutating contents does not mutate documents (immutable update style)
    expect(stateWithContent.source_documents).toBe(state.source_documents);
  });
});
