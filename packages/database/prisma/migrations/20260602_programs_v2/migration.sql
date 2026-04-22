-- Programs v2: add vertical support, brief, cadence, pilot phases, content packs, templates

-- AlterTable: programs — add new columns
ALTER TABLE "programs"
  ADD COLUMN "vertical_id"       TEXT,
  ADD COLUMN "template_id"       TEXT,
  ADD COLUMN "execution_model"   TEXT NOT NULL DEFAULT 'recurring',
  ADD COLUMN "pilot_phase"       TEXT NOT NULL DEFAULT 'setup',
  ADD COLUMN "brief"             TEXT,
  ADD COLUMN "brief_edited_at"   TIMESTAMP(3),
  ADD COLUMN "cadence"           TEXT,
  ADD COLUMN "cadence_cron_expr" TEXT,
  ADD COLUMN "pilot_messages"    JSONB,
  ADD COLUMN "next_run_at"       TIMESTAMP(3);

-- CreateTable: vertical_program_templates
CREATE TABLE "vertical_program_templates" (
    "id"             TEXT NOT NULL,
    "agency_id"      TEXT NOT NULL,
    "vertical_id"    TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "type"           TEXT NOT NULL,
    "execution_model" TEXT NOT NULL DEFAULT 'recurring',
    "brief"          TEXT,
    "content_config" JSONB NOT NULL DEFAULT '{}',
    "cadence"        TEXT,
    "template_items" JSONB NOT NULL DEFAULT '[]',
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vertical_program_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: program_content_packs
CREATE TABLE "program_content_packs" (
    "id"            TEXT NOT NULL,
    "agency_id"     TEXT NOT NULL,
    "client_id"     TEXT NOT NULL,
    "program_id"    TEXT NOT NULL,
    "cycle_label"   TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'draft',
    "review_status" TEXT NOT NULL DEFAULT 'none',
    "source_task_id" TEXT,
    "source_label"  TEXT,
    "assignee_id"   TEXT,
    "due_date"      TIMESTAMP(3),
    "notes"         TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_content_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: program_content_items
CREATE TABLE "program_content_items" (
    "id"             TEXT NOT NULL,
    "pack_id"        TEXT NOT NULL,
    "item_type"      TEXT NOT NULL,
    "label"          TEXT NOT NULL,
    "content"        TEXT NOT NULL,
    "edited_content" TEXT,
    "metadata"       JSONB NOT NULL DEFAULT '{}',
    "sort_order"     INTEGER NOT NULL DEFAULT 0,
    "is_template"    BOOLEAN NOT NULL DEFAULT false,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_content_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programs_vertical_id_idx"                     ON "programs"("vertical_id");
CREATE INDEX "vertical_program_templates_agency_id_idx"     ON "vertical_program_templates"("agency_id");
CREATE INDEX "vertical_program_templates_vertical_id_idx"   ON "vertical_program_templates"("vertical_id");
CREATE INDEX "program_content_packs_agency_id_idx"          ON "program_content_packs"("agency_id");
CREATE INDEX "program_content_packs_program_id_idx"         ON "program_content_packs"("program_id");
CREATE INDEX "program_content_packs_client_id_idx"          ON "program_content_packs"("client_id");
CREATE INDEX "program_content_items_pack_id_idx"            ON "program_content_items"("pack_id");

-- AddForeignKey
ALTER TABLE "programs"
  ADD CONSTRAINT "programs_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "programs"
  ADD CONSTRAINT "programs_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "vertical_program_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vertical_program_templates"
  ADD CONSTRAINT "vertical_program_templates_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vertical_program_templates"
  ADD CONSTRAINT "vertical_program_templates_vertical_id_fkey"
    FOREIGN KEY ("vertical_id") REFERENCES "verticals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_content_packs"
  ADD CONSTRAINT "program_content_packs_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_content_packs"
  ADD CONSTRAINT "program_content_packs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_content_packs"
  ADD CONSTRAINT "program_content_packs_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "program_content_items"
  ADD CONSTRAINT "program_content_items_pack_id_fkey"
    FOREIGN KEY ("pack_id") REFERENCES "program_content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
