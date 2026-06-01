"use client";

import { useCallback, useEffect, useState, type JSX } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type ReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "changes_requested";

interface SpecSection {
  id: string;
  spec_id: string;
  division_id: string;
  title: string;
  ai_draft_text: string;
  current_text: string;
  review_status: ReviewStatus;
  sort_order: number;
  version: number;
}

interface DiffHunk {
  type: "equal" | "insert" | "delete";
  value: string;
}

interface ExportReadinessResult {
  ready: boolean;
  totalSections: number;
  approvedSections: number;
  pendingSections: string[];
  rejectedSections: string[];
}

// ── Diff engine (word-level LCS) ─────────────────────────────────────────────

function computeWordDiff(original: string, redlined: string): DiffHunk[] {
  const origWords = original.split(/(\s+)/);
  const redlWords = redlined.split(/(\s+)/);
  const m = origWords.length;
  const n = redlWords.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let r = 1; r <= m; r++) {
    for (let c = 1; c <= n; c++) {
      if (origWords[r - 1] === redlWords[c - 1]) {
        lcs[r][c] = lcs[r - 1][c - 1] + 1;
      } else {
        lcs[r][c] = Math.max(lcs[r - 1][c], lcs[r][c - 1]);
      }
    }
  }

  const raw: DiffHunk[] = [];
  let ri = m;
  let ci = n;
  while (ri > 0 || ci > 0) {
    if (ri > 0 && ci > 0 && origWords[ri - 1] === redlWords[ci - 1]) {
      raw.unshift({ type: "equal", value: origWords[ri - 1] });
      ri--;
      ci--;
    } else if (
      ci > 0 &&
      (ri === 0 || lcs[ri][ci - 1] >= lcs[ri - 1][ci])
    ) {
      raw.unshift({ type: "insert", value: redlWords[ci - 1] });
      ci--;
    } else {
      raw.unshift({ type: "delete", value: origWords[ri - 1] });
      ri--;
    }
  }

  const merged: DiffHunk[] = [];
  for (const hunk of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === hunk.type) {
      last.value += hunk.value;
    } else {
      merged.push({ type: hunk.type, value: hunk.value });
    }
  }
  return merged;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ReviewStatus, { label: string; color: string }> = {
  pending: { label: "Pending Review", color: "#8b8b8b" },
  in_review: { label: "In Review", color: "#1d6fa8" },
  approved: { label: "Approved", color: "#1a7d3c" },
  rejected: { label: "Rejected", color: "#a82020" },
  changes_requested: { label: "Changes Requested", color: "#b06b00" },
};

function StatusBadge({ status }: { status: ReviewStatus }): JSX.Element {
  const { label, color } = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

// ── Diff viewer ───────────────────────────────────────────────────────────────

function DiffViewer({
  original,
  redlined,
}: {
  original: string;
  redlined: string;
}): JSX.Element {
  const hunks = computeWordDiff(original, redlined);
  return (
    <div
      style={{
        fontFamily: "monospace",
        fontSize: 13,
        lineHeight: 1.7,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        padding: "12px 16px",
        background: "#fafafa",
        border: "1px solid #e0e0e0",
        borderRadius: 6,
        maxHeight: 320,
        overflowY: "auto",
      }}
    >
      {hunks.map((hunk, idx) => {
        if (hunk.type === "equal") {
          return <span key={idx}>{hunk.value}</span>;
        }
        if (hunk.type === "delete") {
          return (
            <span
              key={idx}
              style={{
                background: "#ffe0e0",
                color: "#a82020",
                textDecoration: "line-through",
                padding: "0 2px",
              }}
            >
              {hunk.value}
            </span>
          );
        }
        return (
          <span
            key={idx}
            style={{ background: "#e0ffe0", color: "#1a7d3c", padding: "0 2px" }}
          >
            {hunk.value}
          </span>
        );
      })}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  section,
  onApprove,
  onReject,
  onRequestChanges,
  onSaveRedline,
}: {
  section: SpecSection;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onRequestChanges: (id: string, notes: string) => Promise<void>;
  onSaveRedline: (id: string, redlinedText: string) => Promise<void>;
}): JSX.Element {
  const [editText, setEditText] = useState(section.current_text);
  const [showDiff, setShowDiff] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [changesNotes, setChangesNotes] = useState("");
  const [actionPanel, setActionPanel] = useState<"none" | "reject" | "changes">(
    "none"
  );
  const [saving, setSaving] = useState(false);

  const hasEdits = editText !== section.ai_draft_text;

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    try {
      await onSaveRedline(section.id, editText);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #d0d0d0",
        borderRadius: 8,
        marginBottom: 24,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "#f5f5f5",
          borderBottom: "1px solid #d0d0d0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{section.title}</span>
          <StatusBadge status={section.review_status} />
        </div>
        <button
          onClick={() => setShowDiff((v) => !v)}
          style={{
            fontSize: 12,
            padding: "4px 12px",
            cursor: "pointer",
            borderRadius: 4,
            border: "1px solid #c0c0c0",
            background: showDiff ? "#e8f0fe" : "#fff",
          }}
        >
          {showDiff ? "Hide Diff" : "Show Diff"}
        </button>
      </div>

      {/* Diff panel */}
      {showDiff && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e8e8e8" }}>
          <p style={{ fontSize: 12, color: "#666", marginBottom: 8, margin: 0 }}>
            AI draft vs. current markup — red = deleted, green = inserted
          </p>
          <div style={{ marginTop: 8 }}>
            <DiffViewer original={section.ai_draft_text} redlined={editText} />
          </div>
        </div>
      )}

      {/* Inline editor */}
      <div style={{ padding: "12px 16px" }}>
        <p style={{ fontSize: 12, color: "#888", marginTop: 0, marginBottom: 6 }}>
          Edit to add your redlines — changes are tracked against the AI draft.
        </p>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={8}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 13,
            lineHeight: 1.6,
            padding: "10px 12px",
            border: "1px solid #c0c0c0",
            borderRadius: 6,
            resize: "vertical",
            boxSizing: "border-box",
          }}
        />
        {hasEdits && (
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              marginTop: 8,
              padding: "6px 18px",
              background: "#1d6fa8",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Redline"}
          </button>
        )}
      </div>

      {/* Review actions */}
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid #e8e8e8",
          background: "#fafafa",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <button
          onClick={() => void onApprove(section.id)}
          disabled={section.review_status === "approved"}
          style={{
            padding: "6px 16px",
            background: "#1a7d3c",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor:
              section.review_status === "approved" ? "not-allowed" : "pointer",
            opacity: section.review_status === "approved" ? 0.5 : 1,
          }}
        >
          Approve
        </button>
        <button
          onClick={() =>
            setActionPanel(actionPanel === "changes" ? "none" : "changes")
          }
          style={{
            padding: "6px 16px",
            background: "#b06b00",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Request Changes
        </button>
        <button
          onClick={() =>
            setActionPanel(actionPanel === "reject" ? "none" : "reject")
          }
          style={{
            padding: "6px 16px",
            background: "#a82020",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Reject
        </button>

        {actionPanel === "reject" && (
          <div style={{ width: "100%", marginTop: 8 }}>
            <textarea
              placeholder="Reason for rejection…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid #c0c0c0",
                borderRadius: 4,
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={() => {
                void onReject(section.id, rejectReason);
                setActionPanel("none");
              }}
              style={{
                marginTop: 6,
                padding: "5px 14px",
                background: "#a82020",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Confirm Reject
            </button>
          </div>
        )}

        {actionPanel === "changes" && (
          <div style={{ width: "100%", marginTop: 8 }}>
            <textarea
              placeholder="Describe the changes needed…"
              value={changesNotes}
              onChange={(e) => setChangesNotes(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid #c0c0c0",
                borderRadius: 4,
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={() => {
                void onRequestChanges(section.id, changesNotes);
                setActionPanel("none");
              }}
              style={{
                marginTop: 6,
                padding: "5px 14px",
                background: "#b06b00",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Submit Request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export gate banner ────────────────────────────────────────────────────────

function ExportGateBanner({
  readiness,
}: {
  readiness: ExportReadinessResult | null;
}): JSX.Element {
  if (!readiness) return <></>;
  if (readiness.ready) {
    return (
      <div
        style={{
          background: "#e8f5e9",
          border: "1px solid #81c784",
          borderRadius: 8,
          padding: "14px 20px",
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 20 }}>✓</span>
        <div>
          <strong style={{ color: "#1a7d3c" }}>
            All sections approved — export is unlocked.
          </strong>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "#2e7d32" }}>
            {readiness.approvedSections} of {readiness.totalSections} sections
            reviewed and approved.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        background: "#fff3e0",
        border: "1px solid #ffb74d",
        borderRadius: 8,
        padding: "14px 20px",
        marginBottom: 24,
      }}
    >
      <strong style={{ color: "#e65100" }}>
        Export blocked — human review required (liability gate).
      </strong>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#bf360c" }}>
        All spec sections must be approved before export is permitted.{" "}
        {readiness.approvedSections}/{readiness.totalSections} approved.
        {readiness.pendingSections.length > 0
          ? ` ${readiness.pendingSections.length} section(s) pending review.`
          : ""}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>
        Liability mandate: &quot;Draft — requires licensed professional review before
        contract incorporation.&quot;
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RedlinePage({
  params,
}: {
  params: { id: string; divisionId: string };
}): JSX.Element {
  const { id: projectId, divisionId } = params;

  const [sections, setSections] = useState<SpecSection[]>([]);
  const [readiness, setReadiness] = useState<ExportReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const res = await fetch(
          `/api/specdraft/projects/${projectId}/specs/${divisionId}/sections`
        );
        if (!res.ok) {
          throw new Error(
            `Failed to load sections: ${res.status} ${res.statusText}`
          );
        }
        const data = (await res.json()) as {
          sections: SpecSection[];
          specId: string;
        };
        if (cancelled) return;
        setSections(data.sections);
        setSpecId(data.specId);

        if (data.specId) {
          const gateRes = await fetch(
            `/api/specdraft/specs/${data.specId}/export-readiness`
          );
          if (gateRes.ok && !cancelled) {
            const gateData = (await gateRes.json()) as ExportReadinessResult;
            setReadiness(gateData);
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [projectId, divisionId]);

  const refreshReadiness = useCallback(async () => {
    if (!specId) return;
    try {
      const res = await fetch(
        `/api/specdraft/specs/${specId}/export-readiness`
      );
      if (res.ok) {
        const data = (await res.json()) as ExportReadinessResult;
        setReadiness(data);
      }
    } catch {
      // non-blocking refresh failure — gate will re-check on next action
    }
  }, [specId]);

  const handleApprove = useCallback(
    async (sectionId: string) => {
      const res = await fetch(`/api/specdraft/sections/${sectionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        setError(`Failed to approve section: ${res.statusText}`);
        return;
      }
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId ? { ...s, review_status: "approved" as ReviewStatus } : s
        )
      );
      await refreshReadiness();
    },
    [refreshReadiness]
  );

  const handleReject = useCallback(
    async (sectionId: string, reason: string) => {
      const res = await fetch(`/api/specdraft/sections/${sectionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", notes: reason }),
      });
      if (!res.ok) {
        setError(`Failed to reject section: ${res.statusText}`);
        return;
      }
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId ? { ...s, review_status: "rejected" as ReviewStatus } : s
        )
      );
      await refreshReadiness();
    },
    [refreshReadiness]
  );

  const handleRequestChanges = useCallback(
    async (sectionId: string, notes: string) => {
      const res = await fetch(`/api/specdraft/sections/${sectionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_changes", notes }),
      });
      if (!res.ok) {
        setError(`Failed to submit changes request: ${res.statusText}`);
        return;
      }
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? { ...s, review_status: "changes_requested" as ReviewStatus }
            : s
        )
      );
      await refreshReadiness();
    },
    [refreshReadiness]
  );

  const handleSaveRedline = useCallback(
    async (sectionId: string, redlinedText: string) => {
      const section = sections.find((s) => s.id === sectionId);
      if (!section) return;
      const res = await fetch(`/api/specdraft/sections/${sectionId}/redlines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalText: section.ai_draft_text,
          redlinedText,
        }),
      });
      if (!res.ok) {
        setError(`Failed to save redline: ${res.statusText}`);
        return;
      }
      setSections((prev) =>
        prev.map((s) =>
          s.id === sectionId ? { ...s, current_text: redlinedText } : s
        )
      );
    },
    [sections]
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <p style={{ color: "#888", textAlign: "center" }}>
          Loading spec sections…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <div
          style={{
            background: "#fce8e8",
            border: "1px solid #f48080",
            borderRadius: 8,
            padding: "16px 20px",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>
          Spec Redline Editor
        </h1>
        <p style={{ color: "#666", margin: 0, fontSize: 14 }}>
          Division {divisionId} · Project {projectId} · Review and mark up each
          section before export.
        </p>
      </header>

      <ExportGateBanner readiness={readiness} />

      {sections.length === 0 ? (
        <p style={{ color: "#888" }}>
          No spec sections found for this division.
        </p>
      ) : (
        sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            onApprove={handleApprove}
            onReject={handleReject}
            onRequestChanges={handleRequestChanges}
            onSaveRedline={handleSaveRedline}
          />
        ))
      )}

      <footer
        style={{
          borderTop: "1px solid #e0e0e0",
          paddingTop: 16,
          marginTop: 32,
          fontSize: 12,
          color: "#999",
        }}
      >
        All spec sections require licensed professional review before contract
        incorporation. Export is blocked until all included sections are approved.
      </footer>
    </section>
  );
}
