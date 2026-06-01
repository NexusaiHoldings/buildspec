import { Pool } from "pg";

export interface SpecSection {
  id: string;
  spec_id: string;
  division_id: string;
  title: string;
  ai_draft_text: string;
  current_text: string;
  review_status: string;
  sort_order: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Redline {
  id: string;
  section_id: string;
  author_id: string;
  original_text: string;
  redlined_text: string;
  status: "pending" | "accepted" | "rejected";
  reviewer_id: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface DiffHunk {
  type: "equal" | "insert" | "delete";
  value: string;
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

export async function getSpecSection(
  sectionId: string
): Promise<SpecSection | null> {
  const pool = getPool();
  const result = await pool.query<SpecSection>(
    "SELECT * FROM spec_sections WHERE id = $1",
    [sectionId]
  );
  return result.rows[0] ?? null;
}

export async function getSpecSectionsByDivision(
  projectId: string,
  divisionId: string
): Promise<SpecSection[]> {
  const pool = getPool();
  const result = await pool.query<SpecSection>(
    `SELECT ss.*
     FROM spec_sections ss
     JOIN specs s ON s.id = ss.spec_id
     WHERE s.project_id = $1
       AND ss.division_id = $2
     ORDER BY ss.sort_order ASC, ss.created_at ASC`,
    [projectId, divisionId]
  );
  return result.rows;
}

export async function createRedline(
  sectionId: string,
  authorId: string,
  originalText: string,
  redlinedText: string
): Promise<Redline> {
  const pool = getPool();
  const result = await pool.query<Redline>(
    `INSERT INTO spec_redlines
       (id, section_id, author_id, original_text, redlined_text, status, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, 'pending', NOW())
     RETURNING *`,
    [sectionId, authorId, originalText, redlinedText]
  );
  return result.rows[0];
}

export async function getRedlines(sectionId: string): Promise<Redline[]> {
  const pool = getPool();
  const result = await pool.query<Redline>(
    `SELECT * FROM spec_redlines
     WHERE section_id = $1
     ORDER BY created_at DESC`,
    [sectionId]
  );
  return result.rows;
}

export async function applyRedlineDecision(
  redlineId: string,
  reviewerId: string,
  action: "accept" | "reject"
): Promise<Redline | null> {
  const pool = getPool();
  const newStatus = action === "accept" ? "accepted" : "rejected";
  const result = await pool.query<Redline>(
    `UPDATE spec_redlines
     SET status = $1, reviewer_id = $2, reviewed_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [newStatus, reviewerId, redlineId]
  );
  return result.rows[0] ?? null;
}

export async function updateSectionText(
  sectionId: string,
  newText: string
): Promise<SpecSection | null> {
  const pool = getPool();
  const result = await pool.query<SpecSection>(
    `UPDATE spec_sections
     SET current_text = $1,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newText, sectionId]
  );
  return result.rows[0] ?? null;
}

function mergeConsecutiveHunks(hunks: DiffHunk[]): DiffHunk[] {
  const merged: DiffHunk[] = [];
  for (const hunk of hunks) {
    const last = merged[merged.length - 1];
    if (last && last.type === hunk.type) {
      last.value += hunk.value;
    } else {
      merged.push({ type: hunk.type, value: hunk.value });
    }
  }
  return merged;
}

export function computeDiff(original: string, redlined: string): DiffHunk[] {
  const originalWords = original.split(/(\s+)/);
  const redlinedWords = redlined.split(/(\s+)/);

  const m = originalWords.length;
  const n = redlinedWords.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let row = 1; row <= m; row++) {
    for (let col = 1; col <= n; col++) {
      if (originalWords[row - 1] === redlinedWords[col - 1]) {
        lcs[row][col] = lcs[row - 1][col - 1] + 1;
      } else {
        lcs[row][col] = Math.max(lcs[row - 1][col], lcs[row][col - 1]);
      }
    }
  }

  const hunks: DiffHunk[] = [];
  let rowIdx = m;
  let colIdx = n;

  while (rowIdx > 0 || colIdx > 0) {
    if (
      rowIdx > 0 &&
      colIdx > 0 &&
      originalWords[rowIdx - 1] === redlinedWords[colIdx - 1]
    ) {
      hunks.unshift({ type: "equal", value: originalWords[rowIdx - 1] });
      rowIdx--;
      colIdx--;
    } else if (
      colIdx > 0 &&
      (rowIdx === 0 || lcs[rowIdx][colIdx - 1] >= lcs[rowIdx - 1][colIdx])
    ) {
      hunks.unshift({ type: "insert", value: redlinedWords[colIdx - 1] });
      colIdx--;
    } else {
      hunks.unshift({ type: "delete", value: originalWords[rowIdx - 1] });
      rowIdx--;
    }
  }

  return mergeConsecutiveHunks(hunks);
}
