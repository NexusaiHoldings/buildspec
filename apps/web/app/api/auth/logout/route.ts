/**
 * POST /api/auth/logout — substrate shim for @nexus/identity-and-access.
 *
 * Sprint substrate-auth-routes-001 (2026-05-21).
 *
 * Headers: Authorization: Bearer <session_token>
 * Response: 204 on success.
 */

import { NextResponse } from "next/server";
import { handleLogout } from "@nexus/identity-and-access";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const result = await handleLogout({
    authorizationHeader: request.headers.get("authorization"),
    ctx: { db: buildDb(), events: buildEventBus() },
  });

  const responseInit: ResponseInit = { status: result.status };
  if (result.headers) responseInit.headers = result.headers;

  if (typeof result.body === "string") {
    return new NextResponse(result.body, responseInit);
  }
  return NextResponse.json(result.body, responseInit);
}
