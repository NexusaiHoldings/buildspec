/**
 * SpecDraft AI — company-specific database schema.
 *
 * Exports SPECDRAFT_SCHEMA_DDL consumed by packages/db/migrate.ts at build time.
 * All tables use CREATE TABLE IF NOT EXISTS (idempotent — safe to re-run).
 *
 * Domain entities: projects, spec sections, RFI items, RAG chunks, export records.
 * All PKs are UUID. No CHECK constraints on free-form text columns.
 *
 * IMPORTANT: All 5 tables are combined into a single DDL constant so the
 * migrate runner executes them in the correct FK dependency order:
 * specdraft_projects must exist before the tables that reference it.
 * The migrate script iterates exported *_DDL constants in alphabetical order,
 * so separate exports would run EXPORT_RECORDS before PROJECTS (E < P).
 */

export const SPECDRAFT_SCHEMA_DDL = `
-- 1. Projects — the top-level workspace unit. Billing activation gate lives here.
CREATE TABLE IF NOT EXISTS specdraft_projects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,
  name                     TEXT NOT NULL,
  description              TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending',
  activated_at             TIMESTAMPTZ,
  stripe_charge_id         TEXT,
  activation_amount_cents  INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specdraft_projects_user_id_idx
  ON specdraft_projects (user_id);

CREATE INDEX IF NOT EXISTS specdraft_projects_status_idx
  ON specdraft_projects (status);

-- 2. Spec sections — CSI division / section versioning within a project.
CREATE TABLE IF NOT EXISTS specdraft_spec_sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES specdraft_projects(id) ON DELETE CASCADE,
  division    TEXT NOT NULL,
  section_num TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specdraft_spec_sections_project_id_idx
  ON specdraft_spec_sections (project_id);

-- 3. RFI items — request-for-information corpus tied to a project.
CREATE TABLE IF NOT EXISTS specdraft_rfi_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES specdraft_projects(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT,
  source_doc  TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specdraft_rfi_items_project_id_idx
  ON specdraft_rfi_items (project_id);

-- 4. RAG chunks — indexed document segments for retrieval-augmented generation.
CREATE TABLE IF NOT EXISTS specdraft_rag_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES specdraft_projects(id) ON DELETE CASCADE,
  source_doc   TEXT NOT NULL,
  chunk_index  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  embedding_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specdraft_rag_chunks_project_id_idx
  ON specdraft_rag_chunks (project_id);

-- 5. Export records — PDF/DOCX generation history with mandatory human sign-off.
CREATE TABLE IF NOT EXISTS specdraft_export_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES specdraft_projects(id) ON DELETE CASCADE,
  export_format TEXT NOT NULL,
  file_url      TEXT,
  approved_by   UUID,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS specdraft_export_records_project_id_idx
  ON specdraft_export_records (project_id);
`;
