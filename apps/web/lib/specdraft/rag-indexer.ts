/**
 * rag-indexer.ts — Chunk documents, embed with OpenAI, upsert to pgvector.
 *
 * Tables are created lazily on first cron run (CREATE TABLE IF NOT EXISTS).
 * Embedding calls go through the OpenAI REST API via fetch — the openai npm
 * package is banned in company apps per project policy.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 1_000;
const CHUNK_OVERLAP = 200;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_INSERT_MAX = 100;

// ── DB pool singleton ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  const { Pool: PgPool } = eval("require")("pg") as {
    Pool: new (cfg: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
}

// ── Schema bootstrap ──────────────────────────────────────────────────────────

let _schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (_schemaEnsured) return;
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS specdraft_documents (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id    UUID        NOT NULL,
      file_id       UUID        NOT NULL,
      filename      TEXT        NOT NULL,
      mime_type     TEXT        NOT NULL,
      storage_key   TEXT        NOT NULL,
      index_status  TEXT        NOT NULL DEFAULT 'pending',
      chunk_count   INTEGER     NOT NULL DEFAULT 0,
      error_message TEXT,
      indexed_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_specdraft_docs_project_file
    ON specdraft_documents (project_id, file_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS specdraft_rag_chunks (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id  UUID        NOT NULL,
      project_id   UUID        NOT NULL,
      chunk_index  INTEGER     NOT NULL,
      content      TEXT        NOT NULL,
      embedding    vector(${EMBEDDING_DIMENSIONS}),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
      ON specdraft_rag_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 50)
    `);
  } catch {
    // pgvector extension not yet enabled — non-fatal; sequential scan used
  }

  _schemaEnsured = true;
}

// ── Text chunking ─────────────────────────────────────────────────────────────

/**
 * Split text into overlapping fixed-size character chunks.
 * Whitespace is collapsed before chunking so chunk sizes are predictable.
 */
export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= normalized.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

// ── Embedding generation ──────────────────────────────────────────────────────

interface EmbeddingApiResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
}

/**
 * Generate a single embedding vector via the OpenAI embeddings API.
 * Uses fetch (not the openai npm package) and respects OPENAI_BASE_URL for
 * gateway proxy routing.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const baseUrl = (
    process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not configured");
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8_191),
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `Embeddings API error: HTTP ${response.status} — ${errText}`,
    );
  }

  const body = (await response.json()) as EmbeddingApiResponse;
  const embedding = body?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embeddings API returned unexpected shape (got ${embedding?.length ?? "none"} dims, expected ${EMBEDDING_DIMENSIONS})`,
    );
  }

  return embedding;
}

// ── Vector upsert ─────────────────────────────────────────────────────────────

/**
 * Delete existing chunks for documentId then insert fresh embeddings.
 * Processes chunks serially to avoid rate-limit bursts on the embeddings API.
 */
export async function upsertChunks(
  documentId: string,
  projectId: string,
  chunks: string[],
): Promise<void> {
  const pool = getPool();

  await pool.query(
    "DELETE FROM specdraft_rag_chunks WHERE document_id = $1",
    [documentId],
  );

  const limited = chunks.slice(0, BATCH_INSERT_MAX);

  for (let i = 0; i < limited.length; i++) {
    const embedding = await generateEmbedding(limited[i]);
    const vectorLiteral = `[${embedding.join(",")}]`;

    await pool.query(
      `INSERT INTO specdraft_rag_chunks
         (document_id, project_id, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [documentId, projectId, i, limited[i], vectorLiteral],
    );
  }
}

// ── High-level orchestrator ───────────────────────────────────────────────────

/**
 * Chunk text and upsert all embeddings. Returns the number of chunks created.
 */
export async function indexDocument(
  documentId: string,
  projectId: string,
  text: string,
): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;
  await upsertChunks(documentId, projectId, chunks);
  return chunks.length;
}

// ── Similarity search ─────────────────────────────────────────────────────────

export interface SimilarChunk {
  content: string;
  document_id: string;
  chunk_index: number;
  similarity: number;
}

/**
 * Find the top-k most similar chunks to queryText within a project using
 * cosine similarity (via pgvector <=> operator).
 */
export async function searchSimilar(
  projectId: string,
  queryText: string,
  limit: number = 5,
): Promise<SimilarChunk[]> {
  const embedding = await generateEmbedding(queryText);
  const vectorLiteral = `[${embedding.join(",")}]`;
  const pool = getPool();

  const result = await pool.query(
    `SELECT content, document_id, chunk_index,
            1 - (embedding <=> $1::vector) AS similarity
     FROM specdraft_rag_chunks
     WHERE project_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [vectorLiteral, projectId, limit],
  );

  return result.rows as SimilarChunk[];
}
