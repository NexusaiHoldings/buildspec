/**
 * Division Spec Detail Page — displays the three-part CSI spec draft for one division.
 *
 * Fully client-side component: interactive inline redline editor with
 * server action wiring for draft generation. Loads spec data from the
 * server via a server action on initial render.
 */

"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  getAllDivisions,
  getDivisionTitle,
  type CsiDivision,
} from "@/lib/specdraft/division-registry";

// ── local types (mirrors csi-drafter shapes for safe client serialization) ──

interface SpecPartData {
  partNumber: 1 | 2 | 3;
  partName: string;
  content: string;
  generatedAt: string;
}

interface SpecDraftData {
  id: string;
  projectId: string;
  divisionId: string;
  divisionTitle: string;
  status: string;
  parts: SpecPartData[];
  ragChunkCount: number;
  createdAt: string;
  updatedAt: string;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

// ── spec part editor (client island) ──────────────────────────────────────

function SpecPartEditor({
  part,
  onChange,
}: {
  part: SpecPartData;
  onChange: (partNumber: number, content: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(part.content);
  const [saved, setSaved] = useState(false);

  const partLabels: Record<number, string> = {
    1: "PART 1 — GENERAL",
    2: "PART 2 — PRODUCTS",
    3: "PART 3 — EXECUTION",
  };

  const handleSave = useCallback(() => {
    onChange(part.partNumber, value);
    setSaved(true);
    setEditing(false);
    setTimeout(() => setSaved(false), 2500);
  }, [onChange, part.partNumber, value]);

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        overflow: "hidden",
        marginBottom: "1.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.25rem",
          background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#374151",
            fontFamily: "monospace",
          }}
        >
          {partLabels[part.partNumber] ?? `Part ${part.partNumber}`}
        </span>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {saved && (
            <span style={{ fontSize: "0.75rem", color: "#16a34a" }}>Saved</span>
          )}
          <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
            {new Date(part.generatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <button
            onClick={() => setEditing((prev) => !prev)}
            style={{
              fontSize: "0.75rem",
              padding: "3px 12px",
              borderRadius: "5px",
              border: "1px solid #d1d5db",
              background: editing ? "#f3f4f6" : "#fff",
              cursor: "pointer",
              color: "#374151",
            }}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          {editing && (
            <button
              onClick={handleSave}
              style={{
                fontSize: "0.75rem",
                padding: "3px 12px",
                borderRadius: "5px",
                border: "none",
                background: "#1d4ed8",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Save
            </button>
          )}
        </div>
      </div>
      <div style={{ padding: "1.25rem" }}>
        {editing ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              width: "100%",
              minHeight: 320,
              fontFamily: "monospace",
              fontSize: "0.85rem",
              lineHeight: 1.6,
              border: "1px solid #d1d5db",
              borderRadius: "5px",
              padding: "0.75rem",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        ) : (
          <pre
            style={{
              margin: 0,
              fontFamily: "inherit",
              fontSize: "0.875rem",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#1f2937",
            }}
          >
            {value}
          </pre>
        )}
      </div>
    </section>
  );
}

// ── page component ─────────────────────────────────────────────────────────

export default function DivisionSpecPage(): JSX.Element {
  const [projectId, setProjectId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [division, setDivision] = useState<CsiDivision | null>(null);
  const [draft, setDraft] = useState<SpecDraftData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [draftingState, setDraftingState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Extract route params from the URL on mount
  useEffect(() => {
    const segments = window.location.pathname.replace(/\/$/, "").split("/");
    const specsIdx = segments.lastIndexOf("specs");
    const projIdx = segments.lastIndexOf("projects");
    if (projIdx !== -1 && specsIdx !== -1 && specsIdx > projIdx) {
      const pid = segments[projIdx + 1] ?? "";
      const did = (segments[specsIdx + 1] ?? "").padStart(2, "0");
      setProjectId(pid);
      setDivisionId(did);

      const allDivs = getAllDivisions();
      const found = allDivs.find((div) => div.id === did) ?? null;
      setDivision(found);
    }
  }, []);

  // Load existing spec draft from API once we have projectId + divisionId
  useEffect(() => {
    if (!projectId || !divisionId) return;
    setLoadState("loading");

    fetch(
      `/api/specdraft/draft?projectId=${encodeURIComponent(projectId)}&divisionId=${encodeURIComponent(divisionId)}`
    )
      .then(async (res) => {
        if (res.status === 404) {
          setDraft(null);
          setLoadState("loaded");
          return;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text.slice(0, 200));
        }
        const data = (await res.json()) as SpecDraftData;
        setDraft(data);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        // API route may not exist yet; treat as no draft
        void err;
        setDraft(null);
        setLoadState("loaded");
      });
  }, [projectId, divisionId]);

  const handleGenerateDraft = useCallback(() => {
    if (!projectId || !divisionId) return;
    setDraftingState("loading");
    setErrorMsg("");

    fetch("/api/specdraft/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, divisionId }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text.slice(0, 200));
        }
        const data = (await res.json()) as SpecDraftData;
        setDraft(data);
        setDraftingState("idle");
      })
      .catch((err: unknown) => {
        setDraftingState("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
  }, [projectId, divisionId]);

  const handlePartChange = useCallback(
    (partNumber: number, content: string) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          parts: prev.parts.map((part) =>
            part.partNumber === partNumber ? { ...part, content } : part
          ),
        };
      });
    },
    []
  );

  const divisionTitle = division
    ? `Division ${division.id} — ${division.title}`
    : divisionId
    ? getDivisionTitle(divisionId)
    : "Loading…";

  // ── render ──

  if (loadState === "idle" || (loadState === "loading" && !projectId)) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <p style={{ color: "#6b7280" }}>Loading specification…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem" }}>
      {/* breadcrumb */}
      <nav style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "1.25rem" }}>
        <a
          href={`/projects/${projectId}`}
          style={{ color: "#6b7280", textDecoration: "none" }}
        >
          Project
        </a>
        {" / "}
        <a
          href={`/projects/${projectId}/specs`}
          style={{ color: "#6b7280", textDecoration: "none" }}
        >
          Specifications
        </a>
        {" / "}
        <span style={{ color: "#1f2937" }}>{divisionTitle}</span>
      </nav>

      {/* header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.75rem",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "0.75rem",
              background: "#f3f4f6",
              borderRadius: "4px",
              padding: "2px 8px",
              color: "#374151",
              display: "inline-block",
              marginBottom: "0.4rem",
            }}
          >
            CSI Div {divisionId}
          </span>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
            {division?.title ?? divisionTitle}
          </h1>
          {division && (
            <p
              style={{ margin: "0.4rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}
            >
              {division.description}
            </p>
          )}
        </div>

        {draft && (
          <div
            style={{ fontSize: "0.78rem", color: "#9ca3af", textAlign: "right" }}
          >
            <div>
              Updated:{" "}
              {new Date(draft.updatedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            <div>{draft.ragChunkCount} RAG source(s)</div>
          </div>
        )}
      </div>

      {/* primary sections reference */}
      {division && division.primarySections.length > 0 && (
        <details
          style={{
            marginBottom: "1.75rem",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            padding: "0.75rem 1rem",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontSize: "0.82rem",
              fontWeight: 600,
              color: "#374151",
              userSelect: "none",
            }}
          >
            Covered sections ({division.primarySections.length})
          </summary>
          <ul
            style={{ margin: "0.75rem 0 0", paddingLeft: "1rem", listStyle: "none" }}
          >
            {division.primarySections.map((sec) => (
              <li
                key={sec.code}
                style={{
                  fontSize: "0.82rem",
                  color: "#6b7280",
                  padding: "2px 0",
                  fontFamily: "monospace",
                }}
              >
                {sec.code} — {sec.title}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* loading state */}
      {loadState === "loading" && (
        <div style={{ padding: "2rem 0", color: "#6b7280" }}>
          Loading draft…
        </div>
      )}

      {/* no draft state */}
      {loadState === "loaded" && (!draft || draft.parts.length === 0) && (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            border: "2px dashed #e5e7eb",
            borderRadius: "12px",
            background: "#fafafa",
          }}
        >
          <p style={{ fontSize: "1rem", color: "#6b7280", marginBottom: "1.5rem" }}>
            No spec draft found for{" "}
            <strong style={{ color: "#1f2937" }}>{divisionTitle}</strong>.
          </p>
          <button
            onClick={handleGenerateDraft}
            disabled={draftingState === "loading"}
            style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              padding: "0.65rem 2rem",
              borderRadius: "8px",
              border: "none",
              background: draftingState === "loading" ? "#93c5fd" : "#1d4ed8",
              color: "#fff",
              cursor: draftingState === "loading" ? "not-allowed" : "pointer",
            }}
          >
            {draftingState === "loading" ? "Generating draft…" : "Generate Spec Draft"}
          </button>
          {draftingState === "error" && (
            <p style={{ marginTop: "1rem", fontSize: "0.82rem", color: "#dc2626" }}>
              Error: {errorMsg}
            </p>
          )}
        </div>
      )}

      {/* spec parts */}
      {loadState === "loaded" && draft && draft.parts.length > 0 && (
        <>
          {draft.parts.map((part) => (
            <SpecPartEditor
              key={part.partNumber}
              part={part}
              onChange={handlePartChange}
            />
          ))}

          <div
            style={{
              marginTop: "2rem",
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
            }}
          >
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Re-draft this division spec? Current content will be replaced."
                  )
                ) {
                  setDraft(null);
                  handleGenerateDraft();
                }
              }}
              style={{
                fontSize: "0.82rem",
                padding: "6px 16px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
                color: "#374151",
              }}
            >
              Re-draft
            </button>
            <button
              onClick={() => window.print()}
              style={{
                fontSize: "0.82rem",
                padding: "6px 16px",
                borderRadius: "6px",
                border: "none",
                background: "#1d4ed8",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Export PDF
            </button>
          </div>
        </>
      )}
    </main>
  );
}
