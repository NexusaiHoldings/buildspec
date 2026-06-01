/**
 * Agent tool handler: draft_csi_spec_section
 *
 * Confirm-gated mutation. Executes the RAG-grounded LLM prompt chain for a
 * specific CSI division, retrieves project-scoped chunks, generates structured
 * MasterFormat Part 1/2/3 content with source citations, and writes the draft
 * to specdraft_spec_sections. Called when an estimator requests a new division
 * draft.
 *
 * Autonomy: confirm — mutations route through the cross-boundary bridge.
 * csuite-agent-capability-composition-001 Phase B.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

type Args = Record<string, unknown>;

interface RagChunkRow {
  readonly id: string;
  readonly document_id: string;
  readonly chunk_text: string;
  readonly chunk_index: number;
  readonly csi_division: string | null;
}

interface SpecSectionRow {
  readonly id: string;
}

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface DraftContent {
  part1: string;
  part2: string;
  part3: string;
  citations: Array<{
    document_id: string;
    chunk_index: number;
    reference: string;
  }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CSI_DIVISION_RE = /^[0-9]{2}$/;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isValidCsiDivision(value: unknown): value is string {
  return typeof value === "string" && CSI_DIVISION_RE.test(value);
}

async function callLlmGateway(messages: LlmMessage[]): Promise<string> {
  const gatewayUrl =
    process.env.LLM_GATEWAY_URL ?? "http://localhost:3001/v1";
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY ?? "";

  const response = await fetch(`${gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gatewayKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM gateway returned status ${response.status}`);
  }

  const data = (await response.json()) as LlmResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("LLM gateway returned empty content");
  }

  return content;
}

function buildSystemPrompt(division: string, divisionTitle: string): string {
  return (
    `You are a construction specification writer with expertise in MasterFormat CSI standards.\n` +
    `Generate a complete CSI Division ${division} (${divisionTitle}) specification section following\n` +
    `the three-part MasterFormat structure:\n\n` +
    `PART 1 - GENERAL: Scope, references, submittals, quality assurance, delivery/storage/handling.\n` +
    `PART 2 - PRODUCTS: Materials, manufactured units, accessories, fabrication.\n` +
    `PART 3 - EXECUTION: Examination, preparation, installation, field quality control, protection.\n\n` +
    `Use the provided project document excerpts as source material. Cite sources using [DOC:<document_id>] notation.\n` +
    `Output professional specification language suitable for construction contract documents.\n` +
    `Structure your response as JSON with keys: part1, part2, part3, citations.`
  );
}

function buildUserPrompt(
  division: string,
  divisionTitle: string,
  chunks: RagChunkRow[],
): string {
  const excerpts = chunks
    .slice(0, 20)
    .map(
      (chunk, idx) =>
        `[${idx + 1}] [DOC:${chunk.document_id}] (chunk ${chunk.chunk_index}):\n${chunk.chunk_text}`,
    )
    .join("\n\n");

  const contextSection =
    excerpts.length > 0
      ? `Project document excerpts for context:\n\n${excerpts}\n\n`
      : "No project-specific document excerpts are available; generate a standard template.\n\n";

  return (
    `Generate a MasterFormat specification section for CSI Division ${division}: ${divisionTitle}.\n\n` +
    contextSection +
    `Return a JSON object with keys: part1 (string), part2 (string), part3 (string), ` +
    `citations (array of {document_id: string, chunk_index: number, reference: string}).`
  );
}

function parseDraftContent(rawContent: string): DraftContent {
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { part1: rawContent, part2: "", part3: "", citations: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<DraftContent>;
    return {
      part1: typeof parsed.part1 === "string" ? parsed.part1 : "",
      part2: typeof parsed.part2 === "string" ? parsed.part2 : "",
      part3: typeof parsed.part3 === "string" ? parsed.part3 : "",
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    };
  } catch {
    return { part1: rawContent, part2: "", part3: "", citations: [] };
  }
}

const CSI_DIVISION_NAMES: Record<string, string> = {
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics, and Composites",
  "07": "Thermal and Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "Heating, Ventilating, and Air Conditioning",
  "25": "Integrated Automation",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety and Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
  "34": "Transportation",
  "35": "Waterway and Marine",
  "40": "Process Integration",
  "41": "Material Processing and Handling Equipment",
  "42": "Process Heating, Cooling, and Drying Equipment",
  "43": "Process Gas and Liquid Handling, Purification, and Storage Equipment",
  "44": "Pollution and Waste Control Equipment",
  "45": "Industry-Specific Manufacturing Equipment",
  "46": "Water and Wastewater Equipment",
  "48": "Electrical Power Generation",
};

export async function handleDraftCsiSpecSection(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const projectId = args["project_id"];
  const division = args["division"];
  const requestedBy = args["requested_by"];
  const customTitle =
    typeof args["title"] === "string" ? args["title"].trim() : undefined;

  if (!isValidUuid(projectId)) {
    return {
      status: 400,
      body: "project_id is required and must be a valid UUID",
    };
  }

  if (!isValidCsiDivision(division)) {
    return {
      status: 400,
      body: "division is required and must be a 2-digit CSI division number (e.g. '03')",
    };
  }

  if (requestedBy !== undefined && !isValidUuid(requestedBy)) {
    return { status: 400, body: "requested_by must be a valid UUID" };
  }

  const divisionTitle =
    customTitle ?? CSI_DIVISION_NAMES[division] ?? `Division ${division}`;

  // Check for existing draft to prevent duplicate submissions
  let existing: SpecSectionRow[];
  try {
    existing = await ctx.db.query<SpecSectionRow>(
      "SELECT id FROM specdraft_spec_sections" +
        " WHERE project_id = $1::uuid AND csi_division = $2 AND status = 'draft'" +
        " LIMIT 1",
      projectId,
      division,
    );
  } catch {
    return { status: 500, body: "internal error" };
  }

  if (existing.length > 0) {
    return {
      status: 409,
      body: `A draft for CSI Division ${division} already exists for this project (id: ${existing[0].id})`,
    };
  }

  // Retrieve project-scoped RAG chunks for this division
  let chunks: RagChunkRow[];
  try {
    chunks = await ctx.db.query<RagChunkRow>(
      "SELECT rc.id, rc.document_id, rc.chunk_text, rc.chunk_index, rc.csi_division" +
        " FROM rag_chunks rc" +
        " JOIN project_documents pd ON pd.id = rc.document_id" +
        " WHERE pd.project_id = $1::uuid" +
        " AND (rc.csi_division = $2 OR rc.csi_division IS NULL)" +
        " ORDER BY rc.csi_division DESC NULLS LAST, rc.chunk_index ASC" +
        " LIMIT 40",
      projectId,
      division,
    );
  } catch {
    return {
      status: 500,
      body: "failed to retrieve RAG chunks for project",
    };
  }

  // Run the RAG-grounded LLM prompt chain
  let draftContent: DraftContent;
  try {
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(division, divisionTitle),
      },
      {
        role: "user",
        content: buildUserPrompt(division, divisionTitle, chunks),
      },
    ];

    const rawContent = await callLlmGateway(messages);
    draftContent = parseDraftContent(rawContent);
  } catch (caughtErr) {
    const message =
      caughtErr instanceof Error ? caughtErr.message : "unknown error";
    return { status: 502, body: `LLM generation failed: ${message}` };
  }

  // Persist the draft to specdraft_spec_sections
  const sectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await ctx.db.execute(
      "INSERT INTO specdraft_spec_sections" +
        " (id, project_id, csi_division, title, part1, part2, part3," +
        "  citations, status, requested_by, created_at, updated_at)" +
        " VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7," +
        "  $8::jsonb, 'draft', $9, $10, $11)",
      sectionId,
      projectId,
      division,
      divisionTitle,
      draftContent.part1,
      draftContent.part2,
      draftContent.part3,
      JSON.stringify(draftContent.citations),
      isValidUuid(requestedBy) ? requestedBy : null,
      now,
      now,
    );
  } catch {
    return { status: 500, body: "failed to persist spec section draft" };
  }

  await ctx.events.publish("specdraft.section_drafted", {
    section_id: sectionId,
    project_id: projectId,
    csi_division: division,
    title: divisionTitle,
    requested_by: isValidUuid(requestedBy) ? requestedBy : null,
    chunk_count: chunks.length,
  });

  return {
    status: 200,
    body: {
      drafted: true,
      section_id: sectionId,
      project_id: projectId,
      csi_division: division,
      title: divisionTitle,
      status: "draft",
      part1_length: draftContent.part1.length,
      part2_length: draftContent.part2.length,
      part3_length: draftContent.part3.length,
      citation_count: draftContent.citations.length,
      source_chunk_count: chunks.length,
      message: `CSI Division ${division} specification section drafted successfully.`,
    },
  };
}
