CREATE TABLE "kit_sessions" (
  "id"              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agency_id"       TEXT        NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "client_id"       TEXT        NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "vertical_id"     TEXT        NOT NULL REFERENCES "verticals"("id") ON DELETE CASCADE,
  -- 'full' | 'quick'
  "mode"            TEXT        NOT NULL DEFAULT 'full',
  -- 'intake' | 'asset_01' .. 'asset_08' | 'delivery' | 'complete'
  "status"          TEXT        NOT NULL DEFAULT 'intake',
  -- index 0-7 of current asset being generated (null = intake or delivery)
  "current_asset"   INTEGER,
  -- JSON array of approved asset indices
  "approved_assets" JSONB       NOT NULL DEFAULT '[]',
  -- JSON array of { role, content, ts } chat turns
  "chat_history"    JSONB       NOT NULL DEFAULT '[]',
  -- the mapped intake JSON snapshot taken at session start
  "intake_json"     JSONB,
  -- JSON map of assetIndex -> { filename, storageKey, generatedAt }
  "generated_files" JSONB       NOT NULL DEFAULT '{}',
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "kit_sessions_agency_id_idx"  ON "kit_sessions"("agency_id");
CREATE INDEX "kit_sessions_client_vertical" ON "kit_sessions"("client_id", "vertical_id");
