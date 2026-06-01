/**
 * Spec Drafts Index — lists all CSI divisions and their draft status for a project.
 *
 * Server component: fetches spec draft summaries from the DB and renders the
 * division grid. No client-side JS required for the initial view.
 */

import Link from "next/link";
import { getAllDivisions, type CsiDivision } from "@/lib/specdraft/division-registry";
import { listProjectSpecDrafts, type SpecDraft } from "@/lib/specdraft/csi-drafter";

interface PageProps {
  params: { id: string };
}

type DraftSummary = Omit<SpecDraft, "parts">;

const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  complete: { bg: "#16a34a", label: "Complete" },
  drafting: { bg: "#d97706", label: "Drafting…" },
  pending: { bg: "#6b7280", label: "Pending" },
  error: { bg: "#dc2626", label: "Error" },
};

function DivisionCard({
  division,
  draft,
  projectId,
}: {
  division: CsiDivision;
  draft: DraftSummary | undefined;
  projectId: string;
}): JSX.Element {
  const statusInfo = draft
    ? (STATUS_STYLES[draft.status] ?? STATUS_STYLES.pending)
    : { bg: "#6b7280", label: "Not started" };

  return (
    <Link
      href={`/projects/${projectId}/specs/${division.id}`}
      style={{
        display: "block",
        padding: "1rem 1.25rem",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        textDecoration: "none",
        color: "inherit",
        background: "#fff",
        transition: "box-shadow 0.15s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <div>
          <span
            style={{
              display: "inline-block",
              fontFamily: "monospace",
              fontSize: "0.75rem",
              background: "#f3f4f6",
              borderRadius: "4px",
              padding: "1px 6px",
              marginBottom: "0.35rem",
              color: "#374151",
            }}
          >
            Div {division.id}
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: "0.95rem",
              fontWeight: 600,
              lineHeight: 1.3,
            }}
          >
            {division.title}
          </h3>
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.8rem",
              color: "#6b7280",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {division.description}
          </p>
        </div>
        <span
          style={{
            flexShrink: 0,
            display: "inline-block",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "#fff",
            background: statusInfo.bg,
            borderRadius: "999px",
            padding: "2px 10px",
            marginTop: "2px",
            whiteSpace: "nowrap",
          }}
        >
          {statusInfo.label}
        </span>
      </div>
      {draft?.ragChunkCount !== undefined && draft.ragChunkCount > 0 && (
        <p
          style={{
            margin: "0.6rem 0 0",
            fontSize: "0.75rem",
            color: "#9ca3af",
          }}
        >
          {draft.ragChunkCount} RAG source{draft.ragChunkCount !== 1 ? "s" : ""} indexed
        </p>
      )}
    </Link>
  );
}

export default async function SpecsIndexPage({ params }: PageProps): Promise<JSX.Element> {
  const projectId = params.id;
  const allDivisions = getAllDivisions();

  let drafts: DraftSummary[] = [];
  try {
    drafts = await listProjectSpecDrafts(projectId);
  } catch {
    // DB may not be seeded yet; render the grid with no-draft state
  }

  const draftByDivision = new Map<string, DraftSummary>(
    drafts.map((draft) => [draft.divisionId, draft])
  );

  const completedCount = drafts.filter((draft) => draft.status === "complete").length;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <div>
          <nav
            style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.4rem" }}
          >
            <Link href={`/projects/${projectId}`} style={{ color: "#6b7280" }}>
              Project
            </Link>
            {" / "}
            <span>Specifications</span>
          </nav>
          <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700 }}>
            CSI Spec Drafts
          </h1>
          <p style={{ margin: "0.4rem 0 0", color: "#6b7280", fontSize: "0.9rem" }}>
            {completedCount} of {allDivisions.length} divisions drafted
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            fontSize: "0.78rem",
            alignItems: "center",
          }}
        >
          {Object.entries(STATUS_STYLES).map(([key, info]) => (
            <span key={key} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: info.bg,
                  display: "inline-block",
                }}
              />
              <span style={{ color: "#6b7280" }}>{info.label}</span>
            </span>
          ))}
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#6b7280",
                display: "inline-block",
              }}
            />
            <span style={{ color: "#6b7280" }}>Not started</span>
          </span>
        </div>
      </div>

      {/* progress bar */}
      <div
        style={{
          height: 6,
          background: "#f3f4f6",
          borderRadius: "999px",
          marginBottom: "2rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(completedCount / allDivisions.length) * 100}%`,
            background: "#16a34a",
            borderRadius: "999px",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* division grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "1rem",
        }}
      >
        {allDivisions.map((division) => (
          <DivisionCard
            key={division.id}
            division={division}
            draft={draftByDivision.get(division.id)}
            projectId={projectId}
          />
        ))}
      </div>
    </main>
  );
}
