/**
 * apps/web/lib/specdraft/export-generator.ts
 *
 * Server-side PDF/DOCX export generator for spec draft projects.
 * Injects the required liability_assessor watermark on every page.
 * Exports are stored in spec_exports with a 48-hour TTL per
 * regulatory_risk data_privacy_exposure requirements.
 *
 * Gated behind isProjectApprovedForExport() (review-gate predicate).
 * Signed download tokens issued via HMAC-SHA256.
 */

import { createHmac } from "crypto";
import { buildDb } from "@/lib/db";
import { buildEventBus } from "@/lib/events";

// ── types ──

export type ExportFormat = "pdf" | "docx";

export interface ProjectSection {
  title: string;
  content: string;
}

export interface ExportRequest {
  projectId: string;
  userId: string;
  format: ExportFormat;
  projectTitle: string;
  projectDescription?: string;
  sections: ProjectSection[];
}

export interface ExportRecord {
  id: string;
  projectId: string;
  userId: string;
  format: ExportFormat;
  fileData: string; // base64-encoded file bytes
  fileSizeBytes: number;
  watermarkApplied: boolean;
  signedToken: string;
  createdAt: Date;
  expiresAt: Date;
}

// ── constants ──

/** Non-removable watermark required by liability_assessor mandate. */
const WATERMARK_TEXT = "DRAFT — requires licensed professional review";

/** Signed URL TTL per regulatory_risk data_privacy_exposure requirements. */
const EXPORT_TTL_HOURS = 48;

// ── schema init ──

async function ensureSchema(): Promise<void> {
  const db = buildDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS spec_projects (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      title         TEXT        NOT NULL,
      description   TEXT,
      owner_user_id UUID        NOT NULL,
      review_status TEXT        NOT NULL DEFAULT 'pending',
      reviewed_by   UUID,
      reviewed_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS spec_exports (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id       UUID        NOT NULL,
      user_id          UUID        NOT NULL,
      format           TEXT        NOT NULL,
      file_data        TEXT        NOT NULL DEFAULT '',
      file_size_bytes  INTEGER     NOT NULL DEFAULT 0,
      watermark_applied BOOLEAN    NOT NULL DEFAULT TRUE,
      signed_token     TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
      purged_at        TIMESTAMPTZ
    )
  `);
}

// ── review-gate predicate ──

export async function isProjectApprovedForExport(projectId: string): Promise<boolean> {
  const db = buildDb();
  try {
    await ensureSchema();
    const rows = await db.query<{ review_status: string }>(
      "SELECT review_status FROM spec_projects WHERE id = $1::uuid LIMIT 1",
      projectId,
    );
    if (rows.length === 0) return false;
    return rows[0].review_status === "approved";
  } catch {
    return false;
  }
}

// ── signed token helpers ──

function generateSignedToken(exportId: string, expiresAt: Date): string {
  const secret =
    process.env.EXPORT_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "dev-export-secret-changeme";
  const payload = `${exportId}:${expiresAt.getTime()}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifySignedToken(
  token: string,
): { exportId: string; expiresAt: Date } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    // Format: exportId:expiresAtMs:hmacSig
    const colonIdx = decoded.lastIndexOf(":");
    if (colonIdx === -1) return null;
    const sig = decoded.slice(colonIdx + 1);
    const rest = decoded.slice(0, colonIdx);
    const midIdx = rest.lastIndexOf(":");
    if (midIdx === -1) return null;
    const exportId = rest.slice(0, midIdx);
    const expiresAtMs = rest.slice(midIdx + 1);
    const expiresAt = new Date(Number(expiresAtMs));
    if (expiresAt < new Date()) return null; // already expired

    const secret =
      process.env.EXPORT_SECRET ??
      process.env.NEXTAUTH_SECRET ??
      "dev-export-secret-changeme";
    const expectedSig = createHmac("sha256", secret)
      .update(`${exportId}:${expiresAtMs}`)
      .digest("hex");
    if (sig !== expectedSig) return null;
    return { exportId, expiresAt };
  } catch {
    return null;
  }
}

// ── active export query ──

export async function getActiveExports(projectId: string): Promise<ExportRecord[]> {
  const db = buildDb();
  try {
    await ensureSchema();
    const rows = await db.query<{
      id: string;
      project_id: string;
      user_id: string;
      format: string;
      file_data: string;
      file_size_bytes: number;
      watermark_applied: boolean;
      signed_token: string | null;
      created_at: string;
      expires_at: string;
    }>(
      `SELECT id, project_id, user_id, format, file_data, file_size_bytes,
              watermark_applied, signed_token, created_at, expires_at
       FROM spec_exports
       WHERE project_id = $1::uuid
         AND expires_at > NOW()
         AND purged_at IS NULL
       ORDER BY created_at DESC`,
      projectId,
    );
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      format: row.format as ExportFormat,
      fileData: row.file_data,
      fileSizeBytes: row.file_size_bytes,
      watermarkApplied: row.watermark_applied,
      signedToken: row.signed_token ?? "",
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    }));
  } catch {
    return [];
  }
}

// ── PDF generation ──

async function generatePdfBuffer(request: ExportRequest): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PDFDocument, rgb, degrees, StandardFonts } = eval(
    "require",
  )("pdf-lib") as typeof import("pdf-lib");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 612;
  const PAGE_H = 792;

  /** Draw header + footer + diagonal watermark on a page. */
  function applyWatermark(page: ReturnType<typeof doc.addPage>): void {
    const w = PAGE_W;
    const h = PAGE_H;
    // Diagonal watermark (background)
    page.drawText(WATERMARK_TEXT, {
      x: 60,
      y: h / 2 - 10,
      size: 13,
      font,
      color: rgb(0.72, 0.12, 0.12),
      rotate: degrees(38),
      opacity: 0.22,
    });
    // Header watermark
    page.drawText(WATERMARK_TEXT, {
      x: 50,
      y: h - 22,
      size: 8,
      font,
      color: rgb(0.72, 0.12, 0.12),
      opacity: 0.9,
    });
    // Footer watermark
    page.drawText(WATERMARK_TEXT, {
      x: 50,
      y: 12,
      size: 8,
      font,
      color: rgb(0.72, 0.12, 0.12),
      opacity: 0.9,
    });
    // Separator lines
    page.drawLine({
      start: { x: 50, y: h - 30 },
      end: { x: w - 50, y: h - 30 },
      thickness: 0.5,
      color: rgb(0.72, 0.12, 0.12),
      opacity: 0.6,
    });
    page.drawLine({
      start: { x: 50, y: 25 },
      end: { x: w - 50, y: 25 },
      thickness: 0.5,
      color: rgb(0.72, 0.12, 0.12),
      opacity: 0.6,
    });
  }

  // Title page
  const titlePage = doc.addPage([PAGE_W, PAGE_H]);
  applyWatermark(titlePage);
  titlePage.drawText(request.projectTitle.slice(0, 80), {
    x: 70,
    y: PAGE_H - 110,
    size: 22,
    font: boldFont,
    color: rgb(0.08, 0.08, 0.08),
  });
  if (request.projectDescription) {
    titlePage.drawText(request.projectDescription.slice(0, 200), {
      x: 70,
      y: PAGE_H - 150,
      size: 11,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  titlePage.drawText(
    `Generated: ${new Date().toUTCString()}`,
    {
      x: 70,
      y: PAGE_H - 180,
      size: 9,
      font,
      color: rgb(0.5, 0.5, 0.5),
    },
  );

  // One page per section
  for (const section of request.sections) {
    const pg = doc.addPage([PAGE_W, PAGE_H]);
    applyWatermark(pg);
    pg.drawText(section.title.slice(0, 80), {
      x: 70,
      y: PAGE_H - 80,
      size: 15,
      font: boldFont,
      color: rgb(0.08, 0.08, 0.08),
    });
    // Draw content lines (manual wrap at ~90 chars)
    const content = section.content.slice(0, 3000);
    const chars = 90;
    const lineH = 14;
    let yPos = PAGE_H - 110;
    let offset = 0;
    while (offset < content.length && yPos > 40) {
      const line = content.slice(offset, offset + chars);
      pg.drawText(line, {
        x: 70,
        y: yPos,
        size: 10,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      offset += chars;
      yPos -= lineH;
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ── DOCX generation ──

async function generateDocxBuffer(request: ExportRequest): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Header,
    Footer,
    HeadingLevel,
    AlignmentType,
  } = eval("require")("docx") as typeof import("docx");

  const watermarkRun = new TextRun({
    text: WATERMARK_TEXT,
    color: "CC2222",
    size: 18,
    bold: true,
  });
  const watermarkPara = new Paragraph({
    children: [watermarkRun],
    alignment: AlignmentType.CENTER,
  });

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      children: [
        new TextRun({ text: request.projectTitle, bold: true, size: 40 }),
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 300 },
    }),
  ];

  if (request.projectDescription) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: request.projectDescription, size: 22, italics: true }),
        ],
        spacing: { after: 200 },
      }),
    );
  }

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toUTCString()}`,
          size: 16,
          color: "888888",
        }),
      ],
      spacing: { after: 400 },
    }),
  );

  for (const section of request.sections) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: section.title, bold: true, size: 28 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 160 },
      }),
      new Paragraph({
        children: [new TextRun({ text: section.content, size: 22 })],
        spacing: { after: 200 },
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        headers: { default: new Header({ children: [watermarkPara] }) },
        footers: { default: new Footer({ children: [watermarkPara] }) },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ── main export entry point ──

export async function generateExport(request: ExportRequest): Promise<ExportRecord> {
  await ensureSchema();

  // Gate: only approved projects may be exported
  const approved = await isProjectApprovedForExport(request.projectId);
  if (!approved) {
    throw new Error(
      "Export blocked: project has not been approved for export via the review gate.",
    );
  }

  // Generate binary content with watermark
  const fileBuffer =
    request.format === "pdf"
      ? await generatePdfBuffer(request)
      : await generateDocxBuffer(request);

  const fileData = fileBuffer.toString("base64");
  const expiresAt = new Date(
    Date.now() + EXPORT_TTL_HOURS * 60 * 60 * 1000,
  );

  const db = buildDb();

  // Insert record (signed_token filled after we know the id)
  const rows = await db.query<{
    id: string;
    created_at: string;
    expires_at: string;
  }>(
    `INSERT INTO spec_exports
       (project_id, user_id, format, file_data, file_size_bytes,
        watermark_applied, signed_token, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, TRUE, '', $6)
     RETURNING id, created_at, expires_at`,
    request.projectId,
    request.userId,
    request.format,
    fileData,
    fileBuffer.length,
    expiresAt.toISOString(),
  );

  const exportId = rows[0].id;
  const signedToken = generateSignedToken(exportId, expiresAt);

  await db.execute(
    "UPDATE spec_exports SET signed_token = $1 WHERE id = $2::uuid",
    signedToken,
    exportId,
  );

  const events = buildEventBus();
  await events.publish("spec.export_generated", {
    export_id: exportId,
    project_id: request.projectId,
    user_id: request.userId,
    format: request.format,
  });

  return {
    id: exportId,
    projectId: request.projectId,
    userId: request.userId,
    format: request.format,
    fileData,
    fileSizeBytes: fileBuffer.length,
    watermarkApplied: true,
    signedToken,
    createdAt: new Date(rows[0].created_at),
    expiresAt,
  };
}

// ── cron cleanup helper ──

export async function purgeExpiredExports(): Promise<{ purged: number; ids: string[] }> {
  const db = buildDb();
  try {
    await ensureSchema();
    const rows = await db.query<{ id: string }>(
      `UPDATE spec_exports
       SET purged_at = NOW(), file_data = ''
       WHERE expires_at < NOW()
         AND purged_at IS NULL
       RETURNING id`,
    );
    return { purged: rows.length, ids: rows.map((row) => row.id) };
  } catch {
    return { purged: 0, ids: [] };
  }
}
