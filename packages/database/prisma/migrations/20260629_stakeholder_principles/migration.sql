-- StakeholderPrinciple: inferred underlying beliefs from surface-level edit signals

CREATE TABLE "stakeholder_principles" (
  "id"                TEXT          NOT NULL PRIMARY KEY,
  "agency_id"         TEXT          NOT NULL,
  "stakeholder_id"    TEXT          NOT NULL,
  "principle"         TEXT          NOT NULL,
  "explanation"       TEXT          NOT NULL,
  "confidence"        DOUBLE PRECISION NOT NULL,
  "observed_count"    INTEGER       NOT NULL DEFAULT 1,
  "supporting_signals" JSONB        NOT NULL DEFAULT '[]',
  "content_types"     JSONB         NOT NULL DEFAULT '[]',
  "status"            TEXT          NOT NULL DEFAULT 'active',
  "last_inferred_at"  TIMESTAMPTZ   NOT NULL,
  "created_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX ON "stakeholder_principles" ("agency_id");
CREATE INDEX ON "stakeholder_principles" ("stakeholder_id");
CREATE INDEX ON "stakeholder_principles" ("stakeholder_id", "status");

ALTER TABLE "stakeholder_preference_profiles"
  ADD COLUMN "last_principle_inferred_at" TIMESTAMPTZ;
