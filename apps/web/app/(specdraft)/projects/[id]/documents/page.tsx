/**
 * /projects/[id]/documents — Project document vault with RAG indexing status.
 *
 * Server component: fetches documents server-side and passes data down.
 * File upload is handled by the @nexus/files-and-media FileUploader (client
 * component), which calls /api/files. A server action then queues the
 * uploaded file_id for RAG indexing in specdraft_documents.
 *
 * Feature: F1-003 — Document Ingestion + RAG Indexing Pipeline.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { handleSession } from "@nexus/identity-and-access";
import { FileUploader } from "@nexus/files-and-media";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionData {
  user_id: string;
  email: string;
  session_id: string;
}

interface ProjectDocument {
  id: string;
  file_id: string;
  filename: string;
  mime_type: string;
  index_status: string;
  chunk_count: number;
  error_message: string | null;
  indexed_at: string | null;
  created_at: string;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getSession(): Promise<SessionData | null> {
  const cookieStore = cookies();
  const token = cookieStore.get("session_token")?.value;
  if (!token) return null;

  const result = await handleSession({
    authorizationHeader: `Bearer ${token}`,
    ctx: { db: buildDb(), events: buildEventBus() },
  });

  if (result.status !== 200) return null;
  return result.body as SessionData;
}

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchProjectDocuments(
  projectId: string,
): Promise<ProjectDocument[]> {
  const db = buildDb();
  const rows = await db.query<ProjectDocument>(
    `SELECT id, file_id, filename, mime_type, index_status,
            chunk_count, error_message, indexed_at, created_at
     FROM specdraft_documents
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    projectId,
  );
  return rows;
}

// ── Server action ─────────────────────────────────────────────────────────────

async function queueDocumentAction(formData: FormData): Promise<void> {
  "use server";

  const projectId = (formData.get("projectId") as string | null) ?? "";
  const fileId = (formData.get("fileId") as string | null) ?? "";

  if (!projectId.trim() || !fileId.trim()) return;

  const db = buildDb();

  interface FileRow {
    id: string;
    filename: string;
    mime_type: string;
    storage_key: string;
    status: string;
  }

  const fileRows = await db
    .query<FileRow>(
      `SELECT id, filename, mime_type, storage_key, status
       FROM files WHERE id = $1 LIMIT 1`,
      fileId.trim(),
    )
    .catch(() => [] as FileRow[]);

  if (fileRows.length === 0) return;
  const file = fileRows[0];
  if (file.status === "quarantined" || file.status === "deleted") return;

  // Upsert into specdraft_documents — ignore duplicates via the unique index
  await db
    .execute(
      `INSERT INTO specdraft_documents
         (project_id, file_id, filename, mime_type, storage_key, index_status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (project_id, file_id) DO NOTHING`,
      projectId.trim(),
      file.id,
      file.filename,
      file.mime_type,
      file.storage_key,
    )
    .catch(() => undefined);

  revalidatePath(`/projects/${projectId}/documents`);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function statusLabel(status: string): string {
  switch (status) {
    case "indexed":    return "✓ Indexed";
    case "pending":    return "⏳ Pending";
    case "processing": return "⚙ Processing";
    case "failed":     return "✗ Failed";
    default:           return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "indexed":    return "#15803d";
    case "pending":    return "#b45309";
    case "processing": return "#1d4ed8";
    case "failed":     return "#b91c1c";
    default:           return "#6b7280";
  }
}

function mimeShort(mime: string): string {
  if (mime.includes("pdf"))  return "PDF";
  if (mime.includes("word") || mime.includes("docx")) return "DOCX";
  if (mime.startsWith("text/")) return "TXT";
  return mime.split("/").pop() ?? mime;
}

// ── Page component ────────────────────────────────────────────────────────────

export default async function DocumentsPage({
  params,
}: {
  params: { id: string };
}): Promise<React.ReactElement> {
  const session = await getSession();
  if (!session) redirect("/login");

  const documents = await fetchProjectDocuments(params.id).catch(
    () => [] as ProjectDocument[],
  );

  const indexed   = documents.filter((d) => d.index_status === "indexed").length;
  const pending   = documents.filter((d) => d.index_status === "pending").length;
  const failed    = documents.filter((d) => d.index_status === "failed").length;

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        maxWidth: 960,
        margin: "0 auto",
        padding: "2rem 1.5rem",
        color: "#111",
      }}
    >
      {/* Header */}
      <header style={{ marginBottom: "1.75rem" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 0.3rem" }}>
          Document Vault
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
          Upload blueprints, scopes of work, and prior specs. The indexing
          pipeline chunks and embeds them for AI-assisted spec drafting.
        </p>
        {documents.length > 0 && (
          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              gap: "1.25rem",
              fontSize: 13,
              color: "#374151",
            }}
          >
            <span style={{ color: "#15803d" }}>✓ {indexed} indexed</span>
            {pending > 0 && (
              <span style={{ color: "#b45309" }}>⏳ {pending} pending</span>
            )}
            {failed > 0 && (
              <span style={{ color: "#b91c1c" }}>✗ {failed} failed</span>
            )}
          </div>
        )}
      </header>

      {/* Upload section */}
      <section
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 10,
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <h2
          style={{ fontSize: 15, fontWeight: 600, margin: "0 0 1rem", color: "#1e293b" }}
        >
          Upload Files
        </h2>
        {/* FileUploader from @nexus/files-and-media handles the drag-and-drop */}
        <FileUploader userId={session.user_id} />

        <div
          style={{
            marginTop: "1.5rem",
            paddingTop: "1.25rem",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <h3
            style={{ fontSize: 13, fontWeight: 600, margin: "0 0 0.4rem", color: "#374151" }}
          >
            Queue an uploaded file for indexing
          </h3>
          <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 0.75rem" }}>
            After uploading, paste the file ID (UUID shown in the list above)
            to add it to this project&apos;s RAG index.
          </p>
          <form
            action={queueDocumentAction}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input type="hidden" name="projectId" value={params.id} />
            <input
              type="text"
              name="fileId"
              placeholder="File ID (UUID)"
              required
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              style={{
                flex: 1,
                padding: "0.45rem 0.75rem",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 13,
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "0.45rem 1.1rem",
                background: "#1d4ed8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              Queue for indexing
            </button>
          </form>
        </div>
      </section>

      {/* Document table */}
      <section>
        <h2
          style={{ fontSize: 15, fontWeight: 600, margin: "0 0 1rem", color: "#1e293b" }}
        >
          Project Documents{" "}
          <span style={{ fontWeight: 400, color: "#9ca3af" }}>
            ({documents.length})
          </span>
        </h2>

        {documents.length === 0 ? (
          <div
            style={{
              padding: "3rem 2rem",
              textAlign: "center",
              color: "#9ca3af",
              border: "1px dashed #d1d5db",
              borderRadius: 8,
              fontSize: 14,
            }}
          >
            No documents yet. Upload a PDF or DOCX and queue it for indexing.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  {["Filename", "Type", "Chunks", "Status", "Indexed at"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: h === "Chunks" ? "center" : "left",
                        padding: "0.5rem 0.75rem",
                        color: "#374151",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >
                    <td
                      style={{
                        padding: "0.6rem 0.75rem",
                        fontWeight: 500,
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.filename}
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0.75rem",
                        color: "#6b7280",
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {mimeShort(doc.mime_type)}
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0.75rem",
                        textAlign: "center",
                        color: "#374151",
                      }}
                    >
                      {doc.chunk_count > 0 ? doc.chunk_count : "—"}
                    </td>
                    <td style={{ padding: "0.6rem 0.75rem" }}>
                      <span
                        style={{
                          color: statusColor(doc.index_status),
                          fontWeight: 500,
                        }}
                      >
                        {statusLabel(doc.index_status)}
                      </span>
                      {doc.error_message && (
                        <span
                          style={{
                            display: "block",
                            fontSize: 11,
                            color: "#b91c1c",
                            marginTop: 2,
                          }}
                        >
                          {doc.error_message.slice(0, 120)}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "0.6rem 0.75rem",
                        color: "#9ca3af",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.indexed_at
                        ? new Date(doc.indexed_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
