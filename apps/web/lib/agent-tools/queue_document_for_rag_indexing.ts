/**
 * Agent tool handler: queue_document_for_rag_indexing
 *
 * Confirm-gated mutation. Marks a project document as pending RAG indexing
 * and writes a queue entry so the cron job picks it up for chunking and
 * embedding. Called after file categorization confirms the document is a
 * valid construction spec input.
 *
 * Autonomy: autonomous — mutations route through the cross-boundary bridge.
 * csuite-agent-capability-composition-001 Phase B.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";

type Args = Record<string, unknown>;

interface DocumentRow {
  readonly id: string;
  readonly project_id: string;
  readonly rag_status: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export async function handleQueueDocumentForRagIndexing(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const documentId = args["document_id"];
  const projectId = args["project_id"];
  const priority =
    typeof args["priority"] === "string" ? args["priority"] : "normal";

  if (!isValidUuid(documentId)) {
    return {
      status: 400,
      body: "document_id is required and must be a valid UUID",
    };
  }

  if (projectId !== undefined && !isValidUuid(projectId)) {
    return { status: 400, body: "project_id must be a valid UUID" };
  }

  const validPriorities = ["low", "normal", "high"];
  if (!validPriorities.includes(priority)) {
    return {
      status: 400,
      body: `priority must be one of: ${validPriorities.join(", ")}`,
    };
  }

  let docs: DocumentRow[];
  try {
    if (isValidUuid(projectId)) {
      docs = await ctx.db.query<DocumentRow>(
        "SELECT id, project_id, rag_status FROM project_documents" +
          " WHERE id = $1::uuid AND project_id = $2::uuid LIMIT 1",
        documentId,
        projectId,
      );
    } else {
      docs = await ctx.db.query<DocumentRow>(
        "SELECT id, project_id, rag_status FROM project_documents" +
          " WHERE id = $1::uuid LIMIT 1",
        documentId,
      );
    }
  } catch {
    return { status: 500, body: "internal error" };
  }

  if (docs.length === 0) {
    return { status: 404, body: "document not found" };
  }

  const doc = docs[0];

  if (doc.rag_status === "queued" || doc.rag_status === "indexing") {
    return {
      status: 409,
      body: `document is already ${doc.rag_status} for RAG indexing`,
    };
  }

  const previousRagStatus = doc.rag_status;
  const resolvedProjectId = doc.project_id;

  try {
    await ctx.db.execute(
      "UPDATE project_documents" +
        " SET rag_status = 'queued', rag_queued_at = NOW(), updated_at = NOW()" +
        " WHERE id = $1::uuid",
      documentId,
    );
  } catch {
    return { status: 500, body: "failed to update document rag_status" };
  }

  const queueEntryId = crypto.randomUUID();

  try {
    await ctx.db.execute(
      "INSERT INTO rag_index_queue" +
        " (id, document_id, project_id, priority, status, created_at)" +
        " VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'pending', NOW())" +
        " ON CONFLICT (document_id)" +
        " DO UPDATE SET priority = EXCLUDED.priority, status = 'pending'," +
        "   created_at = NOW()",
      queueEntryId,
      documentId,
      resolvedProjectId,
      priority,
    );
  } catch {
    try {
      await ctx.db.execute(
        "UPDATE project_documents" +
          " SET rag_status = $2, updated_at = NOW()" +
          " WHERE id = $1::uuid",
        documentId,
        previousRagStatus,
      );
    } catch {
      // best-effort rollback; primary error takes precedence
    }
    return { status: 500, body: "failed to enqueue document for RAG indexing" };
  }

  await ctx.events.publish("rag.document_queued", {
    document_id: documentId,
    project_id: resolvedProjectId,
    queue_entry_id: queueEntryId,
    priority,
  });

  return {
    status: 200,
    body: {
      queued: true,
      document_id: documentId,
      project_id: resolvedProjectId,
      queue_entry_id: queueEntryId,
      priority,
      message:
        "Document queued for RAG indexing; the cron job will pick it up for chunking and embedding.",
    },
  };
}
