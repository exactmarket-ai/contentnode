-- Add last_decay_at column to stakeholder_preference_profiles
ALTER TABLE "stakeholder_preference_profiles"
  ADD COLUMN "last_decay_at" TIMESTAMPTZ;

-- Migrate existing plain string arrays → WeightedSignal objects.
-- Only touches rows where the first element is a JSON string (old format).
-- Rows with empty arrays or already-migrated object arrays are untouched.

-- tone_signals
UPDATE "stakeholder_preference_profiles"
SET "tone_signals" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'signal',       elem.value,
        'confidence',   0.6,
        'observedCount', 1,
        'firstSeenAt',  to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'lastSeenAt',   to_char("updated_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("tone_signals") AS elem
)
WHERE jsonb_typeof("tone_signals") = 'array'
  AND jsonb_array_length("tone_signals") > 0
  AND jsonb_typeof("tone_signals"->0) = 'string';

-- structure_signals
UPDATE "stakeholder_preference_profiles"
SET "structure_signals" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'signal',       elem.value,
        'confidence',   0.6,
        'observedCount', 1,
        'firstSeenAt',  to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'lastSeenAt',   to_char("updated_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("structure_signals") AS elem
)
WHERE jsonb_typeof("structure_signals") = 'array'
  AND jsonb_array_length("structure_signals") > 0
  AND jsonb_typeof("structure_signals"->0) = 'string';

-- reject_patterns
UPDATE "stakeholder_preference_profiles"
SET "reject_patterns" = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'signal',       elem.value,
        'confidence',   0.6,
        'observedCount', 1,
        'firstSeenAt',  to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'lastSeenAt',   to_char("updated_at", 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("reject_patterns") AS elem
)
WHERE jsonb_typeof("reject_patterns") = 'array'
  AND jsonb_array_length("reject_patterns") > 0
  AND jsonb_typeof("reject_patterns"->0) = 'string';
