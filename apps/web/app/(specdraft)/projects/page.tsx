/**
 * SpecDraft — Projects listing page (/projects).
 *
 * Server component. Reads session from cookies and lists the current
 * user's projects. Redirects to /api/auth/login if unauthenticated.
 */

import type { JSX } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import { listProjects } from "@/lib/specdraft/project-billing";
import type { ProjectRow } from "@/lib/specdraft/project-billing";

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

function StatusBadge({ status }: { status: string }): JSX.Element {
  const isActive = status === "active";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 12,
        fontSize: "0.75rem",
        fontWeight: 600,
        background: isActive ? "#d1fae5" : "#fef3c7",
        color: isActive ? "#065f46" : "#92400e",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

export default async function ProjectsPage(): Promise<JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  let projects: ProjectRow[] = [];
  try {
    projects = await listProjects(session.user_id);
  } catch {
    projects = [];
  }

  return (
    <div
      style={{
        maxWidth: 860,
        margin: "2.5rem auto",
        padding: "0 1.25rem",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.75rem",
        }}
      >
        <h1 style={{ fontSize: "1.625rem", fontWeight: 700, margin: 0 }}>
          Projects
        </h1>
        <Link
          href="/projects/new"
          style={{
            background: "var(--substrate-accent, #2563eb)",
            color: "#fff",
            padding: "0.5rem 1.125rem",
            borderRadius: 7,
            textDecoration: "none",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          + New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 1rem",
            border: "1px dashed rgba(128,128,128,0.3)",
            borderRadius: 10,
          }}
        >
          <p
            style={{
              fontSize: "1rem",
              color: "var(--substrate-fg)",
              opacity: 0.6,
              marginBottom: "1rem",
            }}
          >
            No projects yet.
          </p>
          <Link
            href="/projects/new"
            style={{
              color: "var(--substrate-accent, #2563eb)",
              fontWeight: 600,
              textDecoration: "underline",
            }}
          >
            Create your first project
          </Link>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {projects.map((project) => (
            <li
              key={project.id}
              style={{
                border: "1px solid rgba(128,128,128,0.18)",
                borderRadius: 9,
                padding: "1.125rem 1.25rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "1rem",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.625rem",
                    flexWrap: "wrap",
                    marginBottom: "0.3rem",
                  }}
                >
                  <span style={{ fontWeight: 650, fontSize: "1.0625rem" }}>
                    {project.name}
                  </span>
                  <StatusBadge status={project.status} />
                </div>
                {project.description && (
                  <p
                    style={{
                      fontSize: "0.875rem",
                      opacity: 0.65,
                      margin: 0,
                      marginTop: "0.25rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {project.description}
                  </p>
                )}
                <p
                  style={{
                    fontSize: "0.75rem",
                    opacity: 0.45,
                    margin: "0.4rem 0 0",
                  }}
                >
                  Created{" "}
                  {new Date(project.created_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>

              <div style={{ flexShrink: 0 }}>
                {project.status !== "active" && (
                  <Link
                    href={`/projects/${project.id}/activate`}
                    style={{
                      display: "inline-block",
                      padding: "0.4rem 0.875rem",
                      border: "1.5px solid var(--substrate-accent, #2563eb)",
                      borderRadius: 6,
                      color: "var(--substrate-accent, #2563eb)",
                      textDecoration: "none",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                    }}
                  >
                    Activate
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
