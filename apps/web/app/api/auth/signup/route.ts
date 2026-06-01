/**
 * POST /api/auth/signup — substrate shim for @nexus/identity-and-access.
 *
 * Sprint substrate-auth-routes-001 (2026-05-21).
 *
 * Request body: { email: string, password: string, ... }
 * Response: 201 with { user, session_token } on success.
 */

import { NextResponse } from "next/server";
import { handleSignup } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = await handleSignup({
    body: body as Parameters<typeof handleSignup>[0]["body"],
    ctx: { db: buildDb(), events: buildEventBus() },
  });

  const responseInit: ResponseInit = { status: result.status };
  if (result.headers) responseInit.headers = result.headers;

  if (typeof result.body === "string") {
    return new NextResponse(result.body, responseInit);
  }
  return NextResponse.json(result.body, responseInit);
}
