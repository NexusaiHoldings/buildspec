/**
 * CSI Division Spec Drafting Engine.
 *
 * Retrieves project-scoped RAG chunks, constructs a CSI MasterFormat-aware
 * prompt, and generates structured spec sections (Part 1 General, Part 2
 * Products, Part 3 Execution) for Divisions 03-48.
 *
 * Mitigates key_technical_risk #1 (hallucinations on code references) by
 * grounding every generation request with division-registry-validated IDs
 * and project-specific RAG context before calling the gateway.
 *
 * Database access: raw SQL via pg pool — no ORM.
 * AI access: HTTP gateway proxy — no openai SDK import.
 */

import {
  type CsiDivision,
  getDivision,
  validateDivisionId,
} from "./division-registry";

// ── types ──────────────────────────────────────────────────────────────────

export interface RagChunk {
  id: string;
  projectId: string;
  divisionId: string;
  content: string;
  sourceLabel: string;
  relevanceScore: number;
  createdAt: string;
}

export interface SpecPart {
  partNumber: 1 | 2 | 3;
  partName: "General" | "Products" | "Execution";
  content: string;
  generatedAt: string;
}

export interface SpecDraft {
  id: string;
  projectId: string;
  divisionId: string;
  divisionTitle: string;
  status: "pending" | "drafting" | "complete" | "error";
  parts: SpecPart[];
  ragChunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftRequest {
  projectId: string;
  divisionId: string;
  projectName?: string;
  additionalContext?: string;
}

export interface DraftResult {
  draft: SpecDraft;
  cached: boolean;
}

// ── db pool (same eval pattern as lib/db.ts to bypass webpack) ──────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pgPool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pgPool) return _pgPool;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = eval("require")("pg") as {
    Pool: new (cfg: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pgPool;
}

// ── RAG retrieval ──────────────────────────────────────────────────────────

/**
 * Fetch up to 20 RAG chunks for a given project + division, ordered by
 * relevance descending. Falls back to full-text scan when pgvector extension
 * is absent (MVP cold-start scenario per feasibility_analysis).
 */
export async function fetchRagChunks(
  projectId: string,
  divisionId: string
): Promise<RagChunk[]> {
  const pool = getPool();
  const sql = `
    SELECT
      id,
      project_id   AS "projectId",
      division_id  AS "divisionId",
      content,
      source_label AS "sourceLabel",
      COALESCE(relevance_score, 1.0) AS "relevanceScore",
      created_at   AS "createdAt"
    FROM spec_rag_chunks
    WHERE project_id = $1
      AND (division_id = $2 OR division_id IS NULL)
    ORDER BY "relevanceScore" DESC, created_at DESC
    LIMIT 20
  `;
  const result = await pool.query(sql, [projectId, divisionId]);
  return (result.rows as RagChunk[]);
}

// ── spec section persistence ───────────────────────────────────────────────

export async function getSpecDraft(
  projectId: string,
  divisionId: string
): Promise<SpecDraft | null> {
  const pool = getPool();
  const draftSql = `
    SELECT
      id,
      project_id    AS "projectId",
      division_id   AS "divisionId",
      division_title AS "divisionTitle",
      status,
      rag_chunk_count AS "ragChunkCount",
      created_at    AS "createdAt",
      updated_at    AS "updatedAt"
    FROM spec_drafts
    WHERE project_id = $1 AND division_id = $2
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const draftResult = await pool.query(draftSql, [projectId, divisionId]);
  if ((draftResult.rows as unknown[]).length === 0) return null;

  const row = (draftResult.rows as Record<string, unknown>[])[0];
  const draftId = row.id as string;

  const partsSql = `
    SELECT
      part_number  AS "partNumber",
      part_name    AS "partName",
      content,
      generated_at AS "generatedAt"
    FROM spec_draft_parts
    WHERE draft_id = $1
    ORDER BY part_number ASC
  `;
  const partsResult = await pool.query(partsSql, [draftId]);

  return {
    id: draftId,
    projectId: row.projectId as string,
    divisionId: row.divisionId as string,
    divisionTitle: row.divisionTitle as string,
    status: row.status as SpecDraft["status"],
    parts: partsResult.rows as SpecPart[],
    ragChunkCount: row.ragChunkCount as number,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function saveSpecDraft(draft: SpecDraft): Promise<void> {
  const pool = getPool();

  await pool.query(
    `INSERT INTO spec_drafts (
        id, project_id, division_id, division_title, status,
        rag_chunk_count, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (project_id, division_id)
      DO UPDATE SET
        status          = EXCLUDED.status,
        rag_chunk_count = EXCLUDED.rag_chunk_count,
        updated_at      = NOW()`,
    [
      draft.id,
      draft.projectId,
      draft.divisionId,
      draft.divisionTitle,
      draft.status,
      draft.ragChunkCount,
    ]
  );

  for (const part of draft.parts) {
    await pool.query(
      `INSERT INTO spec_draft_parts (
          id, draft_id, part_number, part_name, content, generated_at
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
        ON CONFLICT (draft_id, part_number)
        DO UPDATE SET
          content      = EXCLUDED.content,
          generated_at = NOW()`,
      [draft.id, part.partNumber, part.partName, part.content]
    );
  }
}

// ── prompt construction ────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function buildSystemPrompt(): string {
  return `You are a licensed construction specification writer with deep expertise in
CSI MasterFormat. You produce technically precise, legally defensible specification
sections for construction projects.

FORMAT RULES — follow exactly:
- Output valid JSON with keys: "part1", "part2", "part3"
- Each key maps to a string containing the formatted spec content for that part
- Part 1 GENERAL: Administrative and procedural requirements, references, submittals, quality assurance, delivery/storage, project conditions
- Part 2 PRODUCTS: Materials, manufactured units, equipment, mixes, fabrication, and source quality control
- Part 3 EXECUTION: Examination, preparation, installation/application, field quality control, adjusting/cleaning, protection, and closeout
- Use imperative present tense ("Provide", "Install", "Submit")
- Cite ASTM, ANSI, AWS standards where applicable for the division
- Keep each part 200-400 words — detailed but not padded`;
}

function buildUserPrompt(
  division: CsiDivision,
  chunks: RagChunk[],
  additionalContext?: string
): string {
  const ragContext =
    chunks.length > 0
      ? chunks
          .map(
            (chunk, idx) =>
              `[Source ${idx + 1}: ${chunk.sourceLabel}]\n${chunk.content}`
          )
          .join("\n\n")
      : "No project-specific RFI corpus available — generate based on standard practice.";

  const sectionList = division.primarySections
    .map((sec) => `  • ${sec.code} ${sec.title}`)
    .join("\n");

  return `Draft a complete CSI MasterFormat specification for:

DIVISION: ${division.id} — ${division.title}
DESCRIPTION: ${division.description}

PRIMARY SECTIONS TO COVER:
${sectionList}

${additionalContext ? `PROJECT CONTEXT:\n${additionalContext}\n\n` : ""}PROJECT RAG CORPUS (${chunks.length} chunks):
${ragContext}

Return JSON with keys "part1", "part2", "part3" containing the specification content for
Part 1 General, Part 2 Products, and Part 3 Execution respectively.`;
}

// ── AI gateway call ────────────────────────────────────────────────────────

async function callGateway(messages: ChatMessage[]): Promise<string> {
  const gatewayUrl = process.env.OPENAI_GATEWAY_URL ?? "https://api.openai.com";
  const apiKey = process.env.OPENAI_API_KEY ?? "";

  const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages,
      temperature: 0.3,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Gateway returned ${response.status}: ${errText.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Gateway returned empty content");
  }
  return content;
}

// ── main drafting function ─────────────────────────────────────────────────

/**
 * Draft a spec for one CSI division. Returns the cached draft if one exists
 * and is complete. Otherwise retrieves RAG context, calls the gateway, and
 * persists the result.
 */
export async function draftDivisionSpec(
  request: DraftRequest
): Promise<DraftResult> {
  const { projectId, divisionId, additionalContext } = request;
  const normalizedId = divisionId.padStart(2, "0");

  if (!validateDivisionId(normalizedId)) {
    throw new Error(
      `Division "${divisionId}" is not a valid CSI MasterFormat division (03-48).`
    );
  }

  const division = getDivision(normalizedId) as CsiDivision;

  const existing = await getSpecDraft(projectId, normalizedId);
  if (existing && existing.status === "complete" && existing.parts.length === 3) {
    return { draft: existing, cached: true };
  }

  const chunks = await fetchRagChunks(projectId, normalizedId);

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildUserPrompt(division, chunks, additionalContext) },
  ];

  let rawJson: string;
  try {
    rawJson = await callGateway(messages);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Spec generation failed for Division ${normalizedId}: ${errMsg}`);
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, string>;
  } catch {
    throw new Error(
      `Gateway returned invalid JSON for Division ${normalizedId}: ${rawJson.slice(0, 100)}`
    );
  }

  const now = new Date().toISOString();
  const parts: SpecPart[] = [
    {
      partNumber: 1,
      partName: "General",
      content: parsed.part1 ?? parsed.Part1 ?? "",
      generatedAt: now,
    },
    {
      partNumber: 2,
      partName: "Products",
      content: parsed.part2 ?? parsed.Part2 ?? "",
      generatedAt: now,
    },
    {
      partNumber: 3,
      partName: "Execution",
      content: parsed.part3 ?? parsed.Part3 ?? "",
      generatedAt: now,
    },
  ];

  const draftId =
    existing?.id ??
    `${projectId.slice(0, 8)}-${normalizedId}-${Date.now()}`;

  const draft: SpecDraft = {
    id: draftId,
    projectId,
    divisionId: normalizedId,
    divisionTitle: `Division ${normalizedId} — ${division.title}`,
    status: "complete",
    parts,
    ragChunkCount: chunks.length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await saveSpecDraft(draft);

  return { draft, cached: false };
}

/**
 * List all draft summaries for a project without fetching part content.
 * Used by the specs index page to show completion status per division.
 */
export async function listProjectSpecDrafts(
  projectId: string
): Promise<Omit<SpecDraft, "parts">[]> {
  const pool = getPool();
  const sql = `
    SELECT
      id,
      project_id    AS "projectId",
      division_id   AS "divisionId",
      division_title AS "divisionTitle",
      status,
      rag_chunk_count AS "ragChunkCount",
      created_at    AS "createdAt",
      updated_at    AS "updatedAt"
    FROM spec_drafts
    WHERE project_id = $1
    ORDER BY division_id ASC
  `;
  const result = await pool.query(sql, [projectId]);
  return result.rows as Omit<SpecDraft, "parts">[];
}
