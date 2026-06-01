import { Pool } from "pg";

export type ReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "changes_requested";

export interface SectionReviewRecord {
  id: string;
  section_id: string;
  reviewer_id: string;
  status: ReviewStatus;
  notes: string | null;
  reviewed_at: string;
}

export interface ExportReadinessResult {
  ready: boolean;
  totalSections: number;
  approvedSections: number;
  pendingSections: string[];
  rejectedSections: string[];
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not configured");
    }
    _pool = new Pool({ connectionString, max: 10 });
  }
  return _pool;
}

export async function getSectionReviewStatus(
  sectionId: string
): Promise<ReviewStatus> {
  const pool = getPool();
  const result = await pool.query<{ review_status: ReviewStatus }>(
    "SELECT review_status FROM spec_sections WHERE id = $1",
    [sectionId]
  );
  return result.rows[0]?.review_status ?? "pending";
}

export async function approveSection(
  sectionId: string,
  reviewerId: string,
  notes?: string
): Promise<SectionReviewRecord> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reviewResult = await client.query<SectionReviewRecord>(
      `INSERT INTO spec_section_reviews
         (id, section_id, reviewer_id, status, notes, reviewed_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'approved', $3, NOW())
       ON CONFLICT (section_id) DO UPDATE SET
         reviewer_id = EXCLUDED.reviewer_id,
         status      = EXCLUDED.status,
         notes       = EXCLUDED.notes,
         reviewed_at = EXCLUDED.reviewed_at
       RETURNING *`,
      [sectionId, reviewerId, notes ?? null]
    );
    await client.query(
      "UPDATE spec_sections SET review_status = 'approved', updated_at = NOW() WHERE id = $1",
      [sectionId]
    );
    await client.query("COMMIT");
    return reviewResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectSection(
  sectionId: string,
  reviewerId: string,
  reason: string
): Promise<SectionReviewRecord> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reviewResult = await client.query<SectionReviewRecord>(
      `INSERT INTO spec_section_reviews
         (id, section_id, reviewer_id, status, notes, reviewed_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'rejected', $3, NOW())
       ON CONFLICT (section_id) DO UPDATE SET
         reviewer_id = EXCLUDED.reviewer_id,
         status      = EXCLUDED.status,
         notes       = EXCLUDED.notes,
         reviewed_at = EXCLUDED.reviewed_at
       RETURNING *`,
      [sectionId, reviewerId, reason]
    );
    await client.query(
      "UPDATE spec_sections SET review_status = 'rejected', updated_at = NOW() WHERE id = $1",
      [sectionId]
    );
    await client.query("COMMIT");
    return reviewResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function requestChanges(
  sectionId: string,
  reviewerId: string,
  notes: string
): Promise<SectionReviewRecord> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reviewResult = await client.query<SectionReviewRecord>(
      `INSERT INTO spec_section_reviews
         (id, section_id, reviewer_id, status, notes, reviewed_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'changes_requested', $3, NOW())
       ON CONFLICT (section_id) DO UPDATE SET
         reviewer_id = EXCLUDED.reviewer_id,
         status      = EXCLUDED.status,
         notes       = EXCLUDED.notes,
         reviewed_at = EXCLUDED.reviewed_at
       RETURNING *`,
      [sectionId, reviewerId, notes]
    );
    await client.query(
      "UPDATE spec_sections SET review_status = 'changes_requested', updated_at = NOW() WHERE id = $1",
      [sectionId]
    );
    await client.query("COMMIT");
    return reviewResult.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function validateExportReadiness(
  specId: string
): Promise<ExportReadinessResult> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    title: string;
    review_status: ReviewStatus;
  }>(
    `SELECT id, title, review_status
     FROM spec_sections
     WHERE spec_id = $1
       AND included_in_export = true
     ORDER BY sort_order ASC`,
    [specId]
  );

  const rows = result.rows;
  const totalSections = rows.length;
  const approvedSections = rows.filter(
    (row) => row.review_status === "approved"
  ).length;
  const pendingSections = rows
    .filter((row) => !["approved", "rejected"].includes(row.review_status))
    .map((row) => row.id);
  const rejectedSections = rows
    .filter((row) => row.review_status === "rejected")
    .map((row) => row.id);

  return {
    ready: totalSections > 0 && approvedSections === totalSections,
    totalSections,
    approvedSections,
    pendingSections,
    rejectedSections,
  };
}

export async function updateSectionReviewStatus(
  sectionId: string,
  status: ReviewStatus,
  reviewerId: string,
  notes?: string
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE spec_sections SET review_status = $1, updated_at = NOW() WHERE id = $2",
      [status, sectionId]
    );
    await client.query(
      `INSERT INTO spec_section_reviews
         (id, section_id, reviewer_id, status, notes, reviewed_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      [sectionId, reviewerId, status, notes ?? null]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getSpecReviewSummary(
  specId: string
): Promise<Array<{ sectionId: string; title: string; status: ReviewStatus }>> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    title: string;
    review_status: ReviewStatus;
  }>(
    `SELECT id, title, review_status
     FROM spec_sections
     WHERE spec_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [specId]
  );
  return result.rows.map((row) => ({
    sectionId: row.id,
    title: row.title,
    status: row.review_status,
  }));
}
