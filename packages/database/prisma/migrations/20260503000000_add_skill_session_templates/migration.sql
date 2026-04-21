-- CreateTable
CREATE TABLE "skill_session_templates" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "skill_key" TEXT NOT NULL,
    "category_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "question_flow" JSONB NOT NULL,
    "created_by_user_id" TEXT,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_session_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_session_templates_agency_id_skill_key_idx" ON "skill_session_templates"("agency_id", "skill_key");

-- AddForeignKey
ALTER TABLE "skill_session_templates" ADD CONSTRAINT "skill_session_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
