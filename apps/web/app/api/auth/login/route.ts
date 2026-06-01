/**
 * POST /api/auth/login — substrate shim for @nexus/identity-and-access.
 *
 * Sprint substrate-auth-routes-001 (2026-05-21).
 *
 * Pre-fix: this route didn't exist. Auth-protected features (e.g., Verifolio
 * F1-007 /reports) redirect to /api/auth/login on missing session → 404.
 * Post-fix: lego handler runs with a substrate-provided HandlerContext.
 *
 * Request body: { email: string, password: string }
 * Response: { session_token, expires_at, user: { id, email } } on 200,
 *           plain-text error on 4xx/5xx.
 */

import { NextResponse } from "next/server";
import { handleLogin } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // pg + raw SQL — not edge-compatible

export async function POST(request: Request): Promise<NextResponse> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  const result = await handleLogin({
    body: {
      email: body.email ?? "",
      password: body.password ?? "",
    },
    ctx: { db: buildDb(), events: buildEventBus() },
  });

  const responseInit: ResponseInit = { status: result.status };
  if (result.headers) responseInit.headers = result.headers;

  if (typeof result.body === "string") {
    return new NextResponse(result.body, responseInit);
  }
  return NextResponse.json(result.body, responseInit);
}
