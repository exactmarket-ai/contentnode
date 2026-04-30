import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})

const statements = [
  // company_brief column on research table (previously run — kept idempotent)
  `ALTER TABLE "client_framework_research" ADD COLUMN IF NOT EXISTS "company_brief" TEXT`,

  // primary_brief_id on client_frameworks (from 20260430_client_briefs migration)
  `ALTER TABLE "client_frameworks" ADD COLUMN IF NOT EXISTS "primary_brief_id" TEXT`,

  // client_briefs table (from 20260430_client_briefs migration)
  `CREATE TABLE IF NOT EXISTS "client_briefs" (
    "id"                TEXT NOT NULL,
    "agency_id"         TEXT NOT NULL,
    "client_id"         TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "type"              TEXT NOT NULL DEFAULT 'company',
    "status"            TEXT NOT NULL DEFAULT 'draft',
    "source"            TEXT NOT NULL DEFAULT 'pasted',
    "content"           TEXT,
    "extracted_data"    JSONB,
    "raw_input"         TEXT,
    "storage_key"       TEXT,
    "filename"          TEXT,
    "vertical_ids"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "extraction_status" TEXT NOT NULL DEFAULT 'none',
    "error_message"     TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_briefs_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE INDEX IF NOT EXISTS "client_briefs_agency_id_client_id_idx"
    ON "client_briefs"("agency_id", "client_id")`,

  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'client_briefs_agency_id_fkey'
    ) THEN
      ALTER TABLE "client_briefs"
        ADD CONSTRAINT "client_briefs_agency_id_fkey"
        FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,

  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'client_briefs_client_id_fkey'
    ) THEN
      ALTER TABLE "client_briefs"
        ADD CONSTRAINT "client_briefs_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
]

try {
  for (const sql of statements) {
    const preview = sql.replace(/\s+/g, ' ').trim().slice(0, 80)
    console.log('Running:', preview)
    await prisma.$executeRawUnsafe(sql)
    console.log('  ✓ done')
  }
  console.log('\nAll statements applied.')
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
