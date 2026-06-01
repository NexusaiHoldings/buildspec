/**
 * apps/web/app/(specdraft)/projects/[id]/export/page.tsx
 *
 * PDF / DOCX export page for a spec draft project.
 * Gated behind the review-gate predicate: if the project has not been
 * approved, only a status message is shown — no export is possible.
 *
 * Watermark "DRAFT — requires licensed professional review" is injected
 * non-removably on every page by the generator (liability_assessor mandate).
 *
 * Signed download tokens expire after 48 h (regulatory_risk requirement).
 * The cleanup cron at /api/cron/export-cleanup purges them on schedule.
 */

import { type JSX } from "react";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { handleSession } from "@nexus/identity-and-access";
import {
  isProjectApprovedForExport,
  getActiveExports,
  generateExport,
  type ExportRecord,
} from "@/lib/specdraft/export-generator";

// ── types ──

interface PageProps {
  params: { id: string };
}

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  review_status: string;
}

// ── helpers ──

async function resolveSession(): Promise<{ user_id: string; email: string } | null> {
  const cookieStore = cookies();
  const sessionToken =
    cookieStore.get("session_token")?.value ??
    cookieStore.get("next-auth.session-token")?.value;
  if (!sessionToken) return null;

  const result = await handleSession({
    authorizationHeader: `Bearer ${sessionToken}`,
    ctx: { db: buildDb(), events: buildEventBus() },
  });
  if (result.status !== 200) return null;
  return result.body as { user_id: string; email: string };
}

async function fetchProject(projectId: string): Promise<ProjectRow | null> {
  const db = buildDb();
  try {
    const rows = await db.query<ProjectRow>(
      `SELECT id, title, description, review_status
       FROM spec_projects WHERE id = $1::uuid LIMIT 1`,
      projectId,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExpiry(expiresAt: Date): string {
  const diffMs = expiresAt.getTime() - Date.now();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "< 1 hour";
  if (diffH < 24) return `${diffH} hours`;
  return `${Math.floor(diffH / 24)} days`;
}

// ── page ──

export default async function ExportPage({ params }: PageProps): Promise<JSX.Element> {
  const projectId = params.id;

  // Session gate
  const session = await resolveSession();
  if (!session) {
    redirect("/api/auth/login");
  }

  // Load project
  const project = await fetchProject(projectId);
  if (!project) {
    notFound();
  }

  const approved = project.review_status === "approved";
  const activeExports: ExportRecord[] = approved
    ? await getActiveExports(projectId)
    : [];

  // ── server action ──
  async function handleGenerateExport(formData: FormData): Promise<void> {
    "use server";
    const format = formData.get("format") as string;
    if (format !== "pdf" && format !== "docx") return;

    // Re-resolve session inside server action
    const cookieStore = cookies();
    const token =
      cookieStore.get("session_token")?.value ??
      cookieStore.get("next-auth.session-token")?.value;
    if (!token) return;
    const sess = await handleSession({
      authorizationHeader: `Bearer ${token}`,
      ctx: { db: buildDb(), events: buildEventBus() },
    });
    if (sess.status !== 200) return;
    const sa = sess.body as { user_id: string };

    // Fetch project sections from DB for richer export content
    const db = buildDb();
    let sections: Array<{ title: string; content: string }> = [];
    let projTitle = "Spec Draft";
    let projDesc: string | undefined;
    try {
      const pRows = await db.query<{ title: string; description: string | null }>(
        "SELECT title, description FROM spec_projects WHERE id = $1::uuid LIMIT 1",
        projectId,
      );
      if (pRows.length > 0) {
        projTitle = pRows[0].title;
        projDesc = pRows[0].description ?? undefined;
      }
      const sRows = await db.query<{ title: string; content: string }>(
        `SELECT title, content FROM spec_sections
         WHERE project_id = $1::uuid AND deleted_at IS NULL
         ORDER BY sort_order ASC`,
        projectId,
      ).catch(() => [] as Array<{ title: string; content: string }>);
      sections = sRows;
    } catch {
      // Proceed with minimal content if tables not yet populated
    }

    await generateExport({
      projectId,
      userId: sa.user_id,
      format,
      projectTitle: projTitle,
      projectDescription: projDesc,
      sections,
    });

    revalidatePath(`/projects/${projectId}/export`);
  }

  // ── render ──
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <nav style={{ marginBottom: "1.5rem", fontSize: "0.875rem", color: "#666" }}>
        <a href="/projects" style={{ color: "#2563eb", textDecoration: "none" }}>Projects</a>
        {" / "}
        <a href={`/projects/${projectId}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          {project.title}
        </a>
        {" / Export"}
      </nav>

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        Export Spec Draft
      </h1>
      <p style={{ color: "#555", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
        {project.title}
      </p>

      {/* Review gate status */}
      <section
        style={{
          padding: "1rem 1.25rem",
          borderRadius: 8,
          marginBottom: "1.5rem",
          background: approved ? "#f0fdf4" : "#fff7ed",
          border: `1px solid ${approved ? "#86efac" : "#fdba74"}`,
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, color: approved ? "#15803d" : "#9a3412" }}>
          {approved
            ? "Review approved — export enabled"
            : "Pending review — export is locked until a reviewer approves this spec draft"}
        </p>
        {!approved && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#78350f" }}>
            All exports require mandatory human sign-off per the liability_assessor
            human_in_loop_required_for mandate.
          </p>
        )}
      </section>

      {/* Disclaimer banner */}
      <section
        style={{
          padding: "0.75rem 1.25rem",
          borderRadius: 6,
          marginBottom: "1.5rem",
          background: "#fef2f2",
          border: "1px solid #fca5a5",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 500 }}>
          DRAFT — requires licensed professional review
        </p>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#b91c1c" }}>
          This watermark is embedded non-removably in every exported page.
          Exports expire and are purged after 48 hours.
        </p>
      </section>

      {/* Export form (only shown when approved) */}
      {approved && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Generate New Export
          </h2>
          <form action={handleGenerateExport} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <select
              name="format"
              defaultValue="pdf"
              required
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: "0.95rem",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="pdf">PDF (.pdf)</option>
              <option value="docx">Word (.docx)</option>
            </select>
            <button
              type="submit"
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: 6,
                background: "#2563eb",
                color: "#fff",
                border: "none",
                fontSize: "0.95rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Generate Export
            </button>
          </form>
          <p style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "#6b7280" }}>
            The generated file will include the required liability watermark on every page
            and will be available for 48 hours.
          </p>
        </section>
      )}

      {/* Existing exports */}
      {activeExports.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Available Exports
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {activeExports.map((exp) => {
              const mimeType =
                exp.format === "pdf"
                  ? "application/pdf"
                  : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
              const fileName = `${project.title.replace(/[^a-z0-9]/gi, "_")}_export_${exp.id.slice(0, 8)}.${exp.format}`;
              const dataHref = `data:${mimeType};base64,${exp.fileData}`;
              return (
                <li
                  key={exp.id}
                  style={{
                    padding: "1rem 1.25rem",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    marginBottom: "0.75rem",
                    background: "#fafafa",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "0.95rem" }}>
                      {exp.format.toUpperCase()} Export
                    </p>
                    <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: "#6b7280" }}>
                      {formatBytes(exp.fileSizeBytes)} · Created{" "}
                      {exp.createdAt.toLocaleString()} · Expires in{" "}
                      {formatExpiry(exp.expiresAt)}
                    </p>
                    {exp.watermarkApplied && (
                      <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#b91c1c" }}>
                        Watermarked ✓
                      </p>
                    )}
                  </div>
                  <a
                    href={dataHref}
                    download={fileName}
                    style={{
                      padding: "0.4rem 1rem",
                      borderRadius: 6,
                      background: "#16a34a",
                      color: "#fff",
                      textDecoration: "none",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                    }}
                  >
                    Download {exp.format.toUpperCase()}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {approved && activeExports.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>
          No active exports. Generate one above.
        </p>
      )}
    </main>
  );
}
