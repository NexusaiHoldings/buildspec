/**
 * SpecDraft project-billing — server-side project CRUD + Stripe activation.
 *
 * Per-project billing model: one-time activation fee ($200–$800) charged via
 * Stripe Checkout before RAG indexing begins. Enforces the usage-based revenue
 * model described in the ceo_briefing MVP requirement.
 *
 * All SQL uses parameterized queries ($1, $2, …). All IDs are UUID.
 * DB pool uses eval("require")("pg") to bypass webpack bundling — same
 * pattern as apps/web/lib/db.ts.
 */

import { randomUUID } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool;
  const { Pool: PgPool } = eval("require")("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

export interface ProjectRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly activated_at: Date | null;
  readonly stripe_charge_id: string | null;
  readonly activation_amount_cents: number | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface CheckoutResult {
  readonly success: boolean;
  readonly checkoutUrl?: string;
  readonly error?: string;
}

export interface ActivationResult {
  readonly success: boolean;
  readonly error?: string;
  readonly chargeId?: string;
  readonly amountCents?: number;
}

/** Fetch a single project owned by the given user. Returns null if not found. */
export async function getProject(
  projectId: string,
  userId: string,
): Promise<ProjectRow | null> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT * FROM specdraft_projects WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1",
    [projectId, userId],
  );
  const rows = res.rows as ProjectRow[];
  return rows[0] ?? null;
}

/** List all projects for a user, newest first. */
export async function listProjects(userId: string): Promise<ProjectRow[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT * FROM specdraft_projects WHERE user_id = $1::uuid ORDER BY created_at DESC",
    [userId],
  );
  return res.rows as ProjectRow[];
}

/** Create a new project in 'pending' status. Returns the created row. */
export async function createProject(
  userId: string,
  name: string,
  description: string,
): Promise<ProjectRow> {
  const pool = getPool();
  const id = randomUUID();
  const res = await pool.query(
    `INSERT INTO specdraft_projects (id, user_id, name, description, status)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'pending')
     RETURNING *`,
    [id, userId, name, description],
  );
  return (res.rows as ProjectRow[])[0];
}

/**
 * Create a Stripe Checkout session (mode=payment) for project activation.
 *
 * Looks up or creates a Stripe customer for the user, then creates a
 * one-time payment session. Returns the hosted Checkout URL on success.
 */
export async function createActivationCheckout(
  projectId: string,
  userId: string,
  amountCents: number,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!secretKey) {
    return { success: false, error: "Stripe not configured" };
  }

  const project = await getProject(projectId, userId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }
  if (project.status === "active") {
    return { success: false, error: "Project is already activated" };
  }

  // Look up or create a Stripe customer for this user.
  const stripeCustomerId = await ensureStripeCustomer(userId, secretKey);
  if (!stripeCustomerId) {
    return { success: false, error: "Failed to create Stripe customer" };
  }

  // Create a one-time payment Checkout session.
  const params = new URLSearchParams({
    mode: "payment",
    customer: stripeCustomerId,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": `SpecDraft Activation: ${project.name}`,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "metadata[project_id]": projectId,
    "metadata[user_id]": userId,
  });

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const errBody = await stripeRes.json().catch(() => ({})) as {
      error?: { message?: string };
    };
    const msg = errBody.error?.message ?? "Stripe checkout creation failed";
    return { success: false, error: msg };
  }

  const session = await stripeRes.json() as { id: string; url: string };
  if (!session.url) {
    return { success: false, error: "Invalid Stripe response — missing URL" };
  }

  return { success: true, checkoutUrl: session.url };
}

/**
 * Verify a completed Stripe Checkout session and mark the project active.
 *
 * Called when Stripe redirects back with ?session_id=cs_xxx. Fetches the
 * session from Stripe to confirm payment_status === "paid" before writing
 * to the DB.
 */
export async function verifyAndActivateProject(
  projectId: string,
  userId: string,
  stripeSessionId: string,
): Promise<ActivationResult> {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!secretKey) {
    return { success: false, error: "Stripe not configured" };
  }

  // Fetch the Checkout session from Stripe to verify payment status.
  const stripeRes = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(stripeSessionId)}`,
    {
      headers: { Authorization: `Bearer ${secretKey}` },
    },
  );

  if (!stripeRes.ok) {
    return { success: false, error: "Could not verify Stripe session" };
  }

  const session = await stripeRes.json() as {
    payment_status: string;
    amount_total: number;
    metadata?: { project_id?: string; user_id?: string };
    payment_intent?: string;
  };

  if (session.payment_status !== "paid") {
    return {
      success: false,
      error: `Payment not complete (status: ${session.payment_status})`,
    };
  }

  // Guard: metadata must match to prevent session-ID swapping attacks.
  if (
    session.metadata?.project_id !== projectId ||
    session.metadata?.user_id !== userId
  ) {
    return { success: false, error: "Session metadata mismatch" };
  }

  const chargeId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : stripeSessionId;

  const pool = getPool();
  await pool.query(
    `UPDATE specdraft_projects
     SET status = 'active',
         activated_at = NOW(),
         stripe_charge_id = $3,
         activation_amount_cents = $4,
         updated_at = NOW()
     WHERE id = $1::uuid AND user_id = $2::uuid AND status != 'active'`,
    [projectId, userId, chargeId, session.amount_total ?? 0],
  );

  return {
    success: true,
    chargeId,
    amountCents: session.amount_total ?? 0,
  };
}

/** Ensure a billing_customers row exists; return the stripe_customer_id. */
async function ensureStripeCustomer(
  userId: string,
  secretKey: string,
): Promise<string | null> {
  const pool = getPool();

  const existing = await pool.query(
    "SELECT stripe_customer_id FROM billing_customers WHERE user_id = $1::uuid LIMIT 1",
    [userId],
  );
  const rows = existing.rows as { stripe_customer_id: string }[];
  if (rows.length > 0) {
    return rows[0].stripe_customer_id;
  }

  // No customer yet — create one in Stripe.
  const userRows = await pool.query(
    "SELECT email FROM users WHERE id = $1::uuid LIMIT 1",
    [userId],
  );
  const email =
    ((userRows.rows as { email?: string }[])[0]?.email) ?? "";

  const createParams = new URLSearchParams({
    email,
    "metadata[user_id]": userId,
  });

  const stripeRes = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: createParams.toString(),
  });

  if (!stripeRes.ok) return null;

  const customer = await stripeRes.json() as { id: string };
  if (!customer.id) return null;

  const customerId = randomUUID();
  await pool.query(
    `INSERT INTO billing_customers (id, user_id, stripe_customer_id, email)
     VALUES ($1::uuid, $2::uuid, $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [customerId, userId, customer.id, email],
  );

  return customer.id;
}
