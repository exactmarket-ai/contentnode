-- Make stakeholder_id optional on feedbacks table
ALTER TABLE "feedbacks" ALTER COLUMN "stakeholder_id" DROP NOT NULL;
