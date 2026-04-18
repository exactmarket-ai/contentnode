-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "workflow_run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_workflow_run_id_idx" ON "comments"("workflow_run_id");

-- CreateIndex
CREATE INDEX "comments_agency_id_idx" ON "comments"("agency_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
