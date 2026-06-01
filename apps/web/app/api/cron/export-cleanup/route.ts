/**
 * GET /api/cron/export-cleanup — purge spec draft exports older than 48 h.
 *
 * Satisfies the regulatory_risk data_privacy_exposure requirement: signed
 * export URLs and their associated file data are scrubbed on expiry. The
 * export record is retained (purged_at timestamp set, file_data cleared)
 * so audit trails remain intact.
 *
 * Schedule: every hour (configure in vercel.json).
 * Auth: Bearer CRON_SECRET when set; unguarded in dev (safe — only reads
 * and soft-deletes already-expired rows).
 */

import { NextResponse } from "next/server";
import { purgeExpiredExports } from "@/lib/specdraft/export-generator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // pg + raw SQL — not edge-compatible
export const maxDuration = 60;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev: unguarded
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  let result: { purged: number; ids: string[] };
  try {
    result = await purgeExpiredExports();
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error).message).slice(0, 500) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    purged: result.purged,
    ids: result.ids,
    ran_at: new Date().toISOString(),
  });
}
