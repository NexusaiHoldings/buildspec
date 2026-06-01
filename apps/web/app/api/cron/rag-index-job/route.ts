/**
 * GET /api/cron/rag-index-job — Vercel Cron handler for background RAG indexing.
 *
 * Picks up specdraft_documents with index_status = 'pending', parses each
 * file, generates OpenAI embeddings, and upserts chunks into pgvector.
 *
 * Auth: Authorization header must be "Bearer <CRON_SECRET>".
 * Vercel Cron automatically sends this header when CRON_SECRET is set in the
 * project environment. Unauthenticated calls receive 401.
 *
 * Feature: F1-003 — Document Ingestion + RAG Indexing Pipeline.
 */

import { NextResponse } from "next/server";
import { parseDocument } from "@/lib/specdraft/document-parser";
import { ensureSchema, indexDocument } from "@/lib/specdraft/rag-indexer";
import { buildDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Maximum documents to process per cron invocation. Keeps wall-clock time
// under Vercel's 60-second serverless function limit.
const BATCH_SIZE = 10;

interface PendingDocument {
  id: string;
  project_id: string;
  file_id: string;
  filename: string;
  mime_type: string;
  storage_key: string;
}

interface JobResult {
  id: string;
  filename: string;
  status: "indexed" | "failed";
  chunkCount?: number;
  error?: string;
}

export async function GET(request: Request): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = buildDb();
  const startedAt = Date.now();

  try {
    // Ensure tables exist before any queries (idempotent, cached after first run)
    await ensureSchema();

    // Atomically claim BATCH_SIZE pending documents by flipping them to
    // 'processing'. If the job crashes mid-batch, a follow-up run can
    // detect stale 'processing' rows via updated_at and reset them.
    const rows = await db.query<PendingDocument>(
      `UPDATE specdraft_documents
       SET index_status = 'processing',
           updated_at   = NOW()
       WHERE id IN (
         SELECT id
         FROM   specdraft_documents
         WHERE  index_status = 'pending'
         ORDER  BY created_at ASC
         LIMIT  $1
       )
       RETURNING id, project_id, file_id, filename, mime_type, storage_key`,
      BATCH_SIZE,
    );

    if (rows.length === 0) {
      return NextResponse.json({
        processed: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
        message: "No pending documents",
      });
    }

    const results: JobResult[] = [];

    for (const doc of rows) {
      try {
        // 1. Fetch + extract text from the stored file
        const parsed = await parseDocument(doc.storage_key, doc.mime_type);

        // 2. Chunk, embed, and upsert into pgvector
        const chunkCount = await indexDocument(
          doc.id,
          doc.project_id,
          parsed.text,
        );

        // 3. Mark indexed
        await db.execute(
          `UPDATE specdraft_documents
           SET index_status  = 'indexed',
               chunk_count   = $1,
               indexed_at    = NOW(),
               error_message = NULL,
               updated_at    = NOW()
           WHERE id = $2`,
          chunkCount,
          doc.id,
        );

        results.push({ id: doc.id, filename: doc.filename, status: "indexed", chunkCount });
      } catch (docErr) {
        const message =
          docErr instanceof Error ? docErr.message : String(docErr);

        // Record failure so operators can diagnose without re-processing
        await db
          .execute(
            `UPDATE specdraft_documents
             SET index_status  = 'failed',
                 error_message = $1,
                 updated_at    = NOW()
             WHERE id = $2`,
            message.slice(0, 500),
            doc.id,
          )
          .catch(() => undefined);

        results.push({
          id: doc.id,
          filename: doc.filename,
          status: "failed",
          error: message.slice(0, 200),
        });
      }
    }

    const processed = results.filter((r) => r.status === "indexed").length;
    const failed    = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      processed,
      failed,
      durationMs: Date.now() - startedAt,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rag-index-job] Fatal error:", message);
    return NextResponse.json(
      { error: "Internal error", detail: message },
      { status: 500 },
    );
  }
}
