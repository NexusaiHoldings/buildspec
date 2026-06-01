/**
 * SpecDraft — New Project page (/projects/new).
 *
 * Server component with an inline server action. On submit, creates the
 * project in 'pending' status and redirects to its activation page so the
 * user can complete billing before RAG indexing begins.
 */

import type { JSX } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { createProject } from "@/lib/specdraft/project-billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getSession(): Promise<{ user_id: string; email: string } | null> {
  const cookieStore = cookies();
  const token = cookieStore.get("session_token")?.value;
  if (!token) return null;

  const result = await handleSession({
    authorizationHeader: `Bearer ${token}`,
    ctx: { db: buildDb(), events: buildEventBus() },
  });

  if (result.status !== 200 || typeof result.body !== "object") return null;
  return result.body as { user_id: string; email: string };
}

interface PageProps {
  searchParams?: { error?: string };
}

export default async function NewProjectPage({
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect("/api/auth/login");
  }

  async function handleCreate(formData: FormData): Promise<never> {
    "use server";

    const cookieStore = cookies();
    const token = cookieStore.get("session_token")?.value;
    if (!token) redirect("/api/auth/login");

    const authResult = await handleSession({
      authorizationHeader: `Bearer ${token}`,
      ctx: { db: buildDb(), events: buildEventBus() },
    });
    if (authResult.status !== 200 || typeof authResult.body !== "object") {
      redirect("/api/auth/login");
    }
    const sess = authResult.body as { user_id: string };

    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const description =
      (formData.get("description") as string | null)?.trim() ?? "";

    if (!name) {
      redirect("/projects/new?error=name-required");
    }

    const project = await createProject(sess.user_id, name, description);
    redirect(`/projects/${project.id}/activate`);
  }

  const errorMessage =
    searchParams?.error === "name-required"
      ? "Project name is required."
      : null;

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "3rem auto",
        padding: "0 1.25rem",
        fontFamily: "inherit",
      }}
    >
      <div style={{ marginBottom: "1.75rem" }}>
        <a
          href="/projects"
          style={{
            fontSize: "0.875rem",
            color: "var(--substrate-accent, #2563eb)",
            textDecoration: "none",
          }}
        >
          ← Back to Projects
        </a>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: "0.75rem 0 0.25rem",
          }}
        >
          New Project
        </h1>
        <p style={{ fontSize: "0.9rem", opacity: 0.6, margin: 0 }}>
          After creation you will be prompted to activate the project ($200–$800
          one-time fee) before RAG indexing begins.
        </p>
      </div>

      {errorMessage && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 7,
            padding: "0.75rem 1rem",
            marginBottom: "1.25rem",
            fontSize: "0.875rem",
            color: "#991b1b",
          }}
        >
          {errorMessage}
        </div>
      )}

      <form
        action={handleCreate}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label
            htmlFor="name"
            style={{ fontSize: "0.875rem", fontWeight: 600 }}
          >
            Project Name <span style={{ color: "#e53e3e" }}>*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="e.g. 101 Main St – Mechanical Spec"
            style={{
              padding: "0.6rem 0.75rem",
              borderRadius: 6,
              border: "1.5px solid rgba(128,128,128,0.3)",
              fontSize: "0.9375rem",
              width: "100%",
              boxSizing: "border-box",
              background: "transparent",
              color: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label
            htmlFor="description"
            style={{ fontSize: "0.875rem", fontWeight: 600 }}
          >
            Description{" "}
            <span style={{ fontWeight: 400, opacity: 0.55 }}>(optional)</span>
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            placeholder="Brief description of the project scope…"
            style={{
              padding: "0.6rem 0.75rem",
              borderRadius: 6,
              border: "1.5px solid rgba(128,128,128,0.3)",
              fontSize: "0.9375rem",
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              background: "transparent",
              color: "inherit",
              fontFamily: "inherit",
            }}
          />
        </div>

        <button
          type="submit"
          style={{
            padding: "0.625rem 1.5rem",
            background: "var(--substrate-accent, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            fontSize: "0.9375rem",
            fontWeight: 600,
            cursor: "pointer",
            alignSelf: "flex-start",
          }}
        >
          Create Project
        </button>
      </form>
    </div>
  );
}
