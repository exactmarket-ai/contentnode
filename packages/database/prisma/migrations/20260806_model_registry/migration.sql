-- Model Registry: global (non-tenant) table of named AI model roles
-- Each row defines a named role and the provider/model assigned to it.
-- The registry is global — no agencyId column — so it is not subject to RLS.

CREATE TABLE IF NOT EXISTS model_registry (
  id           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  role_key     TEXT        NOT NULL,
  display_name TEXT        NOT NULL,
  description  TEXT,
  provider     TEXT        NOT NULL DEFAULT 'anthropic',
  model        TEXT        NOT NULL DEFAULT 'claude-sonnet-4-5',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_id TEXT,

  CONSTRAINT model_registry_pkey PRIMARY KEY (id),
  CONSTRAINT model_registry_role_key_key UNIQUE (role_key)
);

-- Seed the six default registry roles.
-- ON CONFLICT DO NOTHING so re-running the migration is safe.

INSERT INTO model_registry (role_key, display_name, description, provider, model)
VALUES
  (
    'generation_primary',
    'Primary Generation',
    'Output nodes, Logic nodes when no node-level override is set',
    'anthropic',
    'claude-sonnet-4-5'
  ),
  (
    'generation_fast',
    'Fast Generation',
    'Scoring, review evaluation, tasks where speed matters more than depth',
    'anthropic',
    'claude-haiku-4-5-20251001'
  ),
  (
    'humanizer',
    'Humanizer',
    'Humanizer node sentence rewriting',
    'anthropic',
    'claude-sonnet-4-5'
  ),
  (
    'research_synthesis',
    'Research & Synthesis',
    'Web scrape synthesis, review mining, audience signal processing',
    'anthropic',
    'claude-sonnet-4-5'
  ),
  (
    'brain_processing',
    'Brain Processing',
    'Client brain signal extraction, preference inference, pattern detection',
    'anthropic',
    'claude-sonnet-4-6'
  ),
  (
    'scoring_review',
    'Scoring & Review',
    'SEO Review node, GEO Review node, Detection scoring',
    'anthropic',
    'claude-haiku-4-5-20251001'
  )
ON CONFLICT (role_key) DO NOTHING;
