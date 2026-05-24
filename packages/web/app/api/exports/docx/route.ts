/**
 * Server-side DOCX export endpoint (Milestone 3A).
 *
 * Why this is server-only:
 *   - The `docx` library is heavy (~MB of XML scaffolding) and pulls Node
 *     built-ins. We do NOT want it in the browser bundle.
 *   - Generated DOCX bytes never round-trip through React state. The route
 *     streams the binary back as a download attachment.
 *
 * Contract:
 *   POST /api/exports/docx
 *   body: { export_type: "clean_docx" | "commentary_docx", project_state: ProjectState }
 *   response (200):
 *     content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *     content-disposition: attachment; filename="...docx"
 *     body: raw DOCX bytes
 *   response (4xx): JSON { error, code }
 *
 * The route re-validates the workflow guards on the server side:
 *   - the posted ProjectState must contain a `final = true` ContractVersion;
 *   - the export_type must be one of the two DOCX kinds we render.
 *
 * The route does NOT call any LLM provider, does NOT touch the filesystem,
 * and does NOT externally send anything. It is purely a render-and-stream
 * boundary.
 */
import { NextResponse } from "next/server";
import { createDocxRenderer, type ExportRenderInput, type ExportRenderType } from "@contractops/core/export-renderer";

// Force the Node.js runtime — the `docx` library uses Buffer / Node APIs and
// is incompatible with the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  export_type?: unknown;
  project_state?: unknown;
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { error: "request body is not valid JSON", code: "BAD_JSON" },
      { status: 400 },
    );
  }

  const export_type = body.export_type;
  if (export_type !== "clean_docx" && export_type !== "commentary_docx") {
    return NextResponse.json(
      {
        error:
          'export_type must be "clean_docx" or "commentary_docx"; got: ' +
          JSON.stringify(export_type),
        code: "BAD_EXPORT_TYPE",
      },
      { status: 400 },
    );
  }

  const renderInput = extractRenderInput(body.project_state);
  if ("error" in renderInput) {
    return NextResponse.json(
      { error: renderInput.error, code: renderInput.code },
      { status: renderInput.status },
    );
  }

  const renderer = createDocxRenderer();
  let rendered;
  try {
    rendered =
      export_type === "clean_docx"
        ? await renderer.renderCleanDocx(renderInput.input)
        : await renderer.renderCommentaryDocx(renderInput.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Clean-render scrub failures land here. 422 = the request was well-formed
    // but the renderer refused to produce the file because it would leak
    // commentary into a clean export.
    return NextResponse.json(
      { error: message, code: "RENDER_REFUSED" },
      { status: 422 },
    );
  }

  return new Response(new Uint8Array(rendered.buffer), {
    status: 200,
    headers: {
      "content-type": rendered.mime_type,
      "content-length": String(rendered.buffer.byteLength),
      "content-disposition": `attachment; filename="${rendered.file_name}"; filename*=UTF-8''${encodeURIComponent(rendered.file_name)}`,
      "cache-control": "no-store",
      "x-export-type": export_type as ExportRenderType,
      "x-export-file-name": encodeURIComponent(rendered.file_name),
    },
  });
}

// ---------- input extraction ----------

type ExtractResult =
  | { input: ExportRenderInput }
  | { error: string; code: string; status: number };

/**
 * Pull the renderer input out of a posted ProjectState. We intentionally do
 * NOT validate the entire ProjectState shape with zod — the renderer only
 * needs a handful of fields, and a strict validation would couple the API
 * route to every schema bump. Instead we duck-type the bits we need and
 * return clear errors when something is missing.
 */
function extractRenderInput(raw: unknown): ExtractResult {
  if (!isObject(raw)) {
    return {
      error: "project_state is required and must be an object",
      code: "BAD_PROJECT_STATE",
      status: 400,
    };
  }
  const project = raw.project;
  if (!isObject(project) || typeof project.id !== "string" || typeof project.name !== "string") {
    return {
      error: "project_state.project is missing id/name",
      code: "BAD_PROJECT",
      status: 400,
    };
  }

  const contract_versions = Array.isArray(raw.contract_versions) ? raw.contract_versions : [];
  const final = contract_versions.find(
    (v) => isObject(v) && v.final === true,
  ) as Record<string, unknown> | undefined;
  if (!final) {
    return {
      error:
        "no final-approved ContractVersion present. Approve a final version before exporting.",
      code: "NO_FINAL_VERSION",
      status: 422,
    };
  }
  if (
    typeof final.id !== "string" ||
    typeof final.source_pack_id !== "string" ||
    typeof final.version_number !== "string"
  ) {
    return {
      error: "final ContractVersion is missing required fields",
      code: "BAD_FINAL_VERSION",
      status: 422,
    };
  }

  // Render input mirrors the ExportRenderInput type. Defensive defaults on
  // the optional fields so a stale localStorage state still renders.
  const input: ExportRenderInput = {
    project: project as ExportRenderInput["project"],
    contract_version: final as unknown as ExportRenderInput["contract_version"],
    playbook: (isObject(raw.playbook) ? raw.playbook : null) as ExportRenderInput["playbook"],
    source_pack_id: final.source_pack_id,
    issue_cards: Array.isArray(raw.issue_cards)
      ? (raw.issue_cards as ExportRenderInput["issue_cards"])
      : [],
    agent_runs: Array.isArray(raw.agent_runs)
      ? (raw.agent_runs as ExportRenderInput["agent_runs"])
      : [],
    qa_runs: Array.isArray(raw.qa_runs)
      ? (raw.qa_runs as ExportRenderInput["qa_runs"])
      : [],
    generated_at: new Date().toISOString(),
  };

  return { input };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
