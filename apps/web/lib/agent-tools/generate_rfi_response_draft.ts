/**
 * Agent tool handler: generate_rfi_response_draft
 *
 * Confirm-gated mutation. Retrieves project-scoped RAG chunks matching the RFI
 * question, generates a citation-backed response draft with linked source
 * document references, writes the draft to specdraft_rfi_items, and flags
 * life-safety RFIs for mandatory human review escalation.
 *
 * Autonomy: human_review — mutations route through the cross-boundary bridge.
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

interface RfiItemRow {
  readonly id: string;
  readonly requires_human_review: boolean;
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

interface ResponseDraftContent {
  response_text: string;
  summary: string;
  citations: Array<{
    document_id: string;
    chunk_index: number;
    reference: string;
  }>;
  life_safety_flag: boolean;
  life_safety_reason: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Keywords that indicate life-safety concerns in RFI questions
const LIFE_SAFETY_KEYWORDS = [
  "fire",
  "egress",
  "exit",
  "sprinkler",
  "smoke",
  "structural",
  "seismic",
  "load",
  "bearing",
  "hazard",
  "toxic",
  "asbestos",
  "lead",
  "mold",
  "electrical safety",
  "arc flash",
  "gas line",
  "explosion",
  "collapse",
  "emergency",
  "life safety",
  "life-safety",
  "code compliance",
  "building code",
  "safety violation",
  "fall protection",
  "guardrail",
  "handrail",
  "means of egress",
];

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function detectLifeSafetyFlag(question: string): {
  flagged: boolean;
  reason: string | null;
} {
  const lower = question.toLowerCase();
  for (const keyword of LIFE_SAFETY_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        flagged: true,
        reason: `RFI question contains life-safety keyword: "${keyword}"`,
      };
    }
  }
  return { flagged: false, reason: null };
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

function buildSystemPrompt(isLifeSafety: boolean): string {
  const lifeSafetyNote = isLifeSafety
    ? "\n\nIMPORTANT: This RFI has been flagged as potentially involving life-safety concerns. " +
      "Your response must explicitly note that this requires mandatory human review by a licensed " +
      "professional before any field action is taken. Include a LIFE-SAFETY NOTICE at the top of your response_text."
    : "";

  return (
    `You are a construction project manager and specification expert responding to a Request for Information (RFI).\n` +
    `Generate a professional, citation-backed response draft to the provided RFI question.\n\n` +
    `Guidelines:\n` +
    `- Provide a clear, technically accurate response based on the project documents provided.\n` +
    `- Cite sources using [DOC:<document_id>] notation inline where evidence supports your answer.\n` +
    `- Include a concise one-sentence summary of your response.\n` +
    `- Assess whether this RFI involves any life-safety concerns.\n` +
    `- Output professional language suitable for construction contract documentation.\n` +
    `- Structure your response as JSON with keys: response_text, summary, citations, ` +
    `life_safety_flag (boolean), life_safety_reason (string or null).` +
    lifeSafetyNote
  );
}

function buildUserPrompt(
  question: string,
  rfiNumber: string | null,
  subject: string | null,
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
      ? `Project document excerpts relevant to this RFI:\n\n${excerpts}\n\n`
      : "No project-specific document excerpts are available; base your response on general construction best practices.\n\n";

  const rfiHeader = [
    rfiNumber ? `RFI Number: ${rfiNumber}` : null,
    subject ? `Subject: ${subject}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    (rfiHeader ? `${rfiHeader}\n\n` : "") +
    `RFI Question:\n${question}\n\n` +
    contextSection +
    `Return a JSON object with keys: response_text (string), summary (string), ` +
    `citations (array of {document_id: string, chunk_index: number, reference: string}), ` +
    `life_safety_flag (boolean), life_safety_reason (string or null).`
  );
}

function parseResponseDraft(rawContent: string): ResponseDraftContent {
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      response_text: rawContent,
      summary: "",
      citations: [],
      life_safety_flag: false,
      life_safety_reason: null,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ResponseDraftContent>;
    return {
      response_text:
        typeof parsed.response_text === "string" ? parsed.response_text : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      life_safety_flag: parsed.life_safety_flag === true,
      life_safety_reason:
        typeof parsed.life_safety_reason === "string"
          ? parsed.life_safety_reason
          : null,
    };
  } catch {
    return {
      response_text: rawContent,
      summary: "",
      citations: [],
      life_safety_flag: false,
      life_safety_reason: null,
    };
  }
}

export async function handleGenerateRfiResponseDraft(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const projectId = args["project_id"];
  const rfiItemId = args["rfi_item_id"];
  const question = args["question"];
  const rfiNumber =
    typeof args["rfi_number"] === "string" ? args["rfi_number"].trim() : null;
  const subject =
    typeof args["subject"] === "string" ? args["subject"].trim() : null;
  const requestedBy = args["requested_by"];

  if (!isValidUuid(projectId)) {
    return {
      status: 400,
      body: "project_id is required and must be a valid UUID",
    };
  }

  if (!isValidUuid(rfiItemId)) {
    return {
      status: 400,
      body: "rfi_item_id is required and must be a valid UUID",
    };
  }

  if (typeof question !== "string" || question.trim().length === 0) {
    return {
      status: 400,
      body: "question is required and must be a non-empty string",
    };
  }

  if (requestedBy !== undefined && !isValidUuid(requestedBy)) {
    return { status: 400, body: "requested_by must be a valid UUID" };
  }

  const trimmedQuestion = question.trim();

  // Pre-flight: check for an existing draft for this RFI item to prevent duplicates
  let existing: RfiItemRow[];
  try {
    existing = await ctx.db.query<RfiItemRow>(
      "SELECT id, requires_human_review FROM specdraft_rfi_items" +
        " WHERE project_id = $1::uuid AND rfi_item_id = $2::uuid AND status = 'draft'" +
        " LIMIT 1",
      projectId,
      rfiItemId,
    );
  } catch {
    return { status: 500, body: "internal error" };
  }

  if (existing.length > 0) {
    return {
      status: 409,
      body: `A draft response already exists for RFI item ${rfiItemId} (draft id: ${existing[0].id})`,
    };
  }

  // Keyword-based life-safety pre-screen before LLM call
  const preScreenResult = detectLifeSafetyFlag(trimmedQuestion);

  // Retrieve project-scoped RAG chunks semantically relevant to the RFI question
  let chunks: RagChunkRow[];
  try {
    chunks = await ctx.db.query<RagChunkRow>(
      "SELECT rc.id, rc.document_id, rc.chunk_text, rc.chunk_index, rc.csi_division" +
        " FROM rag_chunks rc" +
        " JOIN project_documents pd ON pd.id = rc.document_id" +
        " WHERE pd.project_id = $1::uuid" +
        " ORDER BY rc.chunk_index ASC" +
        " LIMIT 40",
      projectId,
    );
  } catch {
    return {
      status: 500,
      body: "failed to retrieve RAG chunks for project",
    };
  }

  // Run the RAG-grounded LLM prompt chain
  let draftContent: ResponseDraftContent;
  try {
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(preScreenResult.flagged),
      },
      {
        role: "user",
        content: buildUserPrompt(trimmedQuestion, rfiNumber, subject, chunks),
      },
    ];

    const rawContent = await callLlmGateway(messages);
    draftContent = parseResponseDraft(rawContent);
  } catch (caughtErr) {
    const message =
      caughtErr instanceof Error ? caughtErr.message : "unknown error";
    return { status: 502, body: `LLM generation failed: ${message}` };
  }

  // Merge keyword pre-screen with LLM life-safety assessment
  const requiresHumanReview =
    preScreenResult.flagged || draftContent.life_safety_flag;
  const lifeSafetyReason =
    preScreenResult.reason ?? draftContent.life_safety_reason ?? null;

  // Persist the draft to specdraft_rfi_items
  const draftId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await ctx.db.execute(
      "INSERT INTO specdraft_rfi_items" +
        " (id, project_id, rfi_item_id, rfi_number, subject, question," +
        "  response_text, summary, citations, status, requires_human_review," +
        "  life_safety_reason, requested_by, created_at, updated_at)" +
        " VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6," +
        "  $7, $8, $9::jsonb, 'draft', $10," +
        "  $11, $12, $13, $14)",
      draftId,
      projectId,
      rfiItemId,
      rfiNumber,
      subject,
      trimmedQuestion,
      draftContent.response_text,
      draftContent.summary,
      JSON.stringify(draftContent.citations),
      requiresHumanReview,
      lifeSafetyReason,
      isValidUuid(requestedBy) ? requestedBy : null,
      now,
      now,
    );
  } catch {
    return { status: 500, body: "failed to persist RFI response draft" };
  }

  await ctx.events.publish("specdraft.rfi_response_drafted", {
    draft_id: draftId,
    project_id: projectId,
    rfi_item_id: rfiItemId,
    rfi_number: rfiNumber,
    requires_human_review: requiresHumanReview,
    life_safety_flagged: requiresHumanReview,
    requested_by: isValidUuid(requestedBy) ? requestedBy : null,
    chunk_count: chunks.length,
  });

  const responseBody: Record<string, unknown> = {
    drafted: true,
    draft_id: draftId,
    project_id: projectId,
    rfi_item_id: rfiItemId,
    status: "draft",
    requires_human_review: requiresHumanReview,
    response_text_length: draftContent.response_text.length,
    summary: draftContent.summary,
    citation_count: draftContent.citations.length,
    source_chunk_count: chunks.length,
    message: requiresHumanReview
      ? `RFI response draft generated and flagged for mandatory human review (life-safety concern: ${lifeSafetyReason ?? "LLM-detected"}).`
      : "RFI response draft generated successfully.",
  };

  if (requiresHumanReview) {
    responseBody["life_safety_reason"] = lifeSafetyReason;
    responseBody["human_review_required"] = true;
    responseBody["escalation_note"] =
      "This RFI response must be reviewed and approved by a licensed professional before field distribution.";
  }

  return { status: 200, body: responseBody };
}
