/**
 * SpecDraft — Project Activation page (/projects/[id]/activate).
 *
 * Two-phase flow:
 *   1. GET /projects/[id]/activate          → show activation form + price.
 *   2. Server action → createActivationCheckout → redirect to Stripe.
 *   3. GET /projects/[id]/activate?session_id=cs_xxx → verify + activate.
 *
 * Enforces the $200–$800 per-project billing gate before RAG indexing starts.
 * Uses @nexus/billing-and-subscriptions customer records (billing_customers)
 * so the Stripe customer is consistent across legos.
 */

import type { JSX } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { handleSession } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";
import {
  getProject,
  createActivationCheckout,
  verifyAndActivateProject,
} from "@/lib/specdraft/project-billing";
import type { ProjectRow } from "@/lib/specdraft/project-billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Default activation price — $200 in cents. Configurable via env. */
const DEFAULT_ACTIVATION_CENTS = 20_000;

function activationAmountCents(): number {
  const raw = process.env.SPECDRAFT_ACTIVATION_CENTS;
  if (!raw) return DEFAULT_ACTIVATION_CENTS;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 20_000 || parsed > 80_000) {
    return DEFAULT_ACTIVATION_CENTS;
  }
  return parsed;
}

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
  params: { id: string };
  searchParams?: { session_id?: string; cancelled?: string; error?: string };
}

function AlreadyActiveView({ project }: { project: ProjectRow }): JSX.Element {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: "3rem auto",
        padding: "0 1.25rem",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          background: "#d1fae5",
          border: "1.5px solid #6ee7b7",
          borderRadius: 10,
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✓</div>
        <h2
          style={{ fontSize: "1.25rem", fontWeight: 700, color: "#065f46", margin: 0 }}
        >
          Project Activated
        </h2>
        <p style={{ color: "#047857", marginTop: "0.5rem", marginBottom: "1.25rem" }}>
          <strong>{project.name}</strong> is active. RAG indexing may now begin.
        </p>
        <a
          href="/projects"
          style={{
            display: "inline-block",
            padding: "0.5rem 1.25rem",
            background: "#059669",
            color: "#fff",
            borderRadius: 7,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: "0.9rem",
          }}
        >
          Back to Projects
        </a>
      </div>
    </div>
  );
}

export default async function ActivatePage({
  params,
  searchParams,
}: PageProps): Promise<JSX.Element> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const project = await getProject(params.id, session.user_id).catch(() => null);

  if (!project) {
    return (
      <div
        style={{
          maxWidth: 480,
          margin: "3rem auto",
          padding: "0 1.25rem",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Project Not Found</h2>
        <p style={{ opacity: 0.65, marginTop: "0.5rem" }}>
          This project does not exist or you do not have access.
        </p>
        <a
          href="/projects"
          style={{
            display: "inline-block",
            marginTop: "1rem",
            color: "var(--substrate-accent, #2563eb)",
          }}
        >
          ← Back to Projects
        </a>
      </div>
    );
  }

  // Phase 3: Stripe redirected back with ?session_id=cs_xxx
  if (searchParams?.session_id) {
    const result = await verifyAndActivateProject(
      params.id,
      session.user_id,
      searchParams.session_id,
    );

    if (result.success) {
      // Re-fetch to get updated status for the success view.
      const activated = await getProject(params.id, session.user_id).catch(
        () => project,
      );
      return <AlreadyActiveView project={activated ?? project} />;
    }

    // Payment failed or already processed — fall through to form with error.
  }

  // Already active — show success.
  if (project.status === "active") {
    return <AlreadyActiveView project={project} />;
  }

  // Inline server action — creates a Stripe Checkout session and redirects.
  const projectId = params.id;

  async function startCheckout(_formData: FormData): Promise<never> {
    "use server";

    const cookieStore = cookies();
    const token = cookieStore.get("session_token")?.value;
    if (!token) redirect("/login");

    const authResult = await handleSession({
      authorizationHeader: `Bearer ${token}`,
      ctx: { db: buildDb(), events: buildEventBus() },
    });
    if (authResult.status !== 200 || typeof authResult.body !== "object") {
      redirect("/login");
    }
    const sess = authResult.body as { user_id: string };

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    const amountCents = activationAmountCents();

    const result = await createActivationCheckout(
      projectId,
      sess.user_id,
      amountCents,
      `${baseUrl}/projects/${projectId}/activate?session_id={CHECKOUT_SESSION_ID}`,
      `${baseUrl}/projects/${projectId}/activate?cancelled=1`,
    );

    if (!result.success || !result.checkoutUrl) {
      redirect(
        `/projects/${projectId}/activate?error=${encodeURIComponent(
          result.error ?? "checkout-failed",
        )}`,
      );
    }

    redirect(result.checkoutUrl);
  }

  const displayAmount = (activationAmountCents() / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });

  let errorMessage: string | null = null;
  if (searchParams?.cancelled) {
    errorMessage = "Payment was cancelled. Try again when ready.";
  } else if (searchParams?.error) {
    errorMessage = decodeURIComponent(searchParams.error).replace(/-/g, " ");
  } else if (searchParams?.session_id) {
    errorMessage = "Payment verification failed. Contact support if charged.";
  }

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
          Activate Project
        </h1>
        <p style={{ fontSize: "0.9rem", opacity: 0.6, margin: 0 }}>
          A one-time activation fee unlocks RAG indexing and AI spec drafting for
          this project.
        </p>
      </div>

      {/* Project summary card */}
      <div
        style={{
          border: "1px solid rgba(128,128,128,0.2)",
          borderRadius: 9,
          padding: "1.125rem 1.25rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{ fontWeight: 650, fontSize: "1.0625rem", marginBottom: "0.25rem" }}
        >
          {project.name}
        </div>
        {project.description && (
          <p style={{ fontSize: "0.875rem", opacity: 0.65, margin: "0 0 0.5rem" }}>
            {project.description}
          </p>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "0.75rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid rgba(128,128,128,0.15)",
          }}
        >
          <span style={{ fontSize: "0.875rem", opacity: 0.7 }}>
            Activation fee
          </span>
          <span style={{ fontWeight: 700, fontSize: "1.125rem" }}>
            {displayAmount}
          </span>
        </div>
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

      <form action={startCheckout}>
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "0.75rem",
            background: "var(--substrate-accent, #2563eb)",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            fontSize: "1rem",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Pay {displayAmount} and Activate →
        </button>
      </form>

      <p
        style={{
          fontSize: "0.8rem",
          opacity: 0.5,
          textAlign: "center",
          marginTop: "0.875rem",
        }}
      >
        Secure payment via Stripe. You will be redirected to complete checkout.
      </p>
    </div>
  );
}
