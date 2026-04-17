-- AlterTable: add source column to prospect_assessments
ALTER TABLE "prospect_assessments" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
