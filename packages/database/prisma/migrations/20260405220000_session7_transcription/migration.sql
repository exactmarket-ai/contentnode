-- Session 7: Transcription system — extend schema for speaker assignment and quote extraction

-- ── TranscriptSession: link to workflow run/node and track target nodes ──────
ALTER TABLE "transcript_sessions"
  ADD COLUMN "workflow_run_id" TEXT,
  ADD COLUMN "node_id"         TEXT,
  ADD COLUMN "target_node_ids" JSONB NOT NULL DEFAULT '[]';

-- ── TranscriptSegment: add speaker assignment fields and audio clip key ──────
ALTER TABLE "transcript_segments"
  ADD COLUMN "speaker_name"          TEXT,
  ADD COLUMN "stakeholder_id"        TEXT,
  ADD COLUMN "is_agency_participant" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "audio_clip_key"        TEXT;

-- ── Feedback: make decision nullable, add transcript quote fields ────────────
ALTER TABLE "feedbacks"
  ALTER COLUMN "decision" DROP NOT NULL,
  ADD COLUMN "transcript_session_id" TEXT,
  ADD COLUMN "transcript_segment_id" TEXT,
  ADD COLUMN "quote_text"            TEXT,
  ADD COLUMN "category"              TEXT;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX "transcript_segments_session_id_speaker_idx"
  ON "transcript_segments"("session_id", "speaker");

CREATE INDEX "feedbacks_transcript_session_id_idx"
  ON "feedbacks"("transcript_session_id")
  WHERE "transcript_session_id" IS NOT NULL;
