# ContentNode.ai — Claude Code Context

## What this project is
A multi-tenant SaaS platform for node-based content workflow automation.
Full spec is in docs/contentnode-spec-v4.md

## Critical architectural rules — follow these in every file you touch
1. Every database query on tenant data MUST include agency_id as a filter.
   This is enforced by Prisma middleware. Never bypass it.
2. Connectivity mode (online/offline) is set at workflow creation and locked
   after first run. Never allow it to change after that point.
3. BullMQ handles all workflow execution. No synchronous AI calls from API routes.
4. All AI provider calls go through packages/ai/src/provider.ts — never call
   Anthropic/OpenAI/etc. directly from feature code.
5. AuditLog entries are append-only. Never update or delete them.

## Tech stack
- Frontend: React + React Flow + Zustand + TailwindCSS + shadcn/ui
- API: Node.js + Fastify + Prisma
- Database: PostgreSQL with RLS + pgvector
- Queue: Redis + BullMQ
- Auth: Clerk (agency) + custom magic link (client portal)
- Storage: Cloudflare R2 (or local filesystem in dev)
- Default AI: Anthropic Claude claude-sonnet-4-5

## Monorepo structure
- apps/web — React frontend
- apps/api — Fastify API
- packages/database — Prisma schema and migrations
- packages/ai — unified AI provider abstraction
- packages/shared — shared types
- workers/workflow — BullMQ workers

## What has been built
- Session 1 complete: monorepo + database foundation
  - pnpm workspaces (apps/*, packages/*, workers/*)
  - packages/database: Prisma schema (15 tables), AsyncLocalStorage middleware,
    3 migrations (pgvector extension, schema, RLS policies), seed data
- Session 2 complete: Fastify API foundation
  - apps/api: Fastify 4 + TypeScript, @fastify/cors, @fastify/helmet, @fastify/multipart
  - Auth plugin: Clerk JWT verification via verifyToken(), seeds AsyncLocalStorage with
    agency_id via agencyStorage.enterWith() so Prisma middleware picks it up
  - requireRole() helper for route-level RBAC
  - 7 route plugins (stub): /api/v1/workflows, /clients, /nodes, /runs,
    /feedback, /transcriptions, /insights
  - /health endpoint: checks Postgres + Redis, returns 200/503
  - apps/api/src/services/audit.ts: append-only AuditLog service (log + list only)
  - Start with: pnpm dev (from repo root)
  - Env vars: see apps/api/.env.example

## What has been built (continued)
- Session 3 complete: workflow execution engine
  - packages/ai: callModel(config, prompt) abstraction for Anthropic + Ollama
    - api_key_ref resolves from env vars; keys never logged or exposed
    - Ollama base URL configurable via OLLAMA_BASE_URL (default: localhost:11434)
  - packages/database: auditService moved here (shared by API + workers)
  - workers/workflow: BullMQ worker entry point (pnpm dev:worker)
    - 4 queues: workflow-runs, node-execution, transcription, asset-generation
    - WorkflowRunner: loads graph, topological sort, parallel wave execution,
      real-time per-node status updates in WorkflowRun.output JSON,
      token usage recorded to UsageRecord, audit logs on start/node/end
    - NodeExecutors: SourceNodeExecutor, LogicNodeExecutor, OutputNodeExecutor
  - apps/api: POST /api/v1/runs (create + enqueue), GET /api/v1/runs/:id (poll),
    GET /api/v1/runs (list), POST /api/v1/runs/:id/cancel
    - Per-node statuses and partial outputs returned in GET /:id response
  - Env vars needed in workers/workflow: DATABASE_URL, REDIS_URL,
    ANTHROPIC_API_KEY (or named ref), OLLAMA_BASE_URL (optional)

## What has been built (continued)
- Session 4 complete: workflow canvas (apps/web)
  - Vite + React 18 + TypeScript, TailwindCSS v3, shadcn/ui (dark theme)
  - Clerk auth: ClerkProvider wraps app; if VITE_CLERK_PUBLISHABLE_KEY is unset,
    editor renders without auth (local dev)
  - WorkflowStore (Zustand): nodes[], edges[], viewport, activeWorkflow metadata
    (id, name, connectivity_mode, default_model_config), selectedNodeId, runStatus,
    nodeRunStatuses for per-node status display during runs
  - Node palette (260px left sidebar): 12 node types across 3 categories
    (source/logic/output), searchable, drag-to-canvas
  - Canvas (ReactFlow): custom SourceNode/LogicNode/OutputNode with per-category
    color coding (green/blue/purple), run status badges, grid background,
    MiniMap, Controls, drag-and-drop drop handler
  - Config panel (320px right panel): opens on node selection, shows type-specific
    forms (text input, API fetch, web scrape, AI generate with model override,
    transform, condition, webhook, email, file export, display)
  - Top bar: editable workflow name, connectivity badge, provider+model picker,
    Save and Run buttons with run state feedback
  - Start with: pnpm dev:web (http://localhost:5173)
  - Env vars: see apps/web/.env.example

## What has been built (continued)
- Session 5 complete: rich config panels + workflow creation modal
  - DocumentSourceConfig (file-upload subtype): document type selector (10 types),
    drag-and-drop upload zone, multi-file list with remove buttons, text paste area.
    Calls POST /api/v1/documents; falls back to local ID if auth not available.
  - AiGenerateConfig (ai-generate subtype): task type selector (Expand/Summarize/Rewrite/
    Compress/Generate Variations/Generate Headlines/Extract Claims), prompt, model override
    (provider + model dropdowns + temperature slider), additional instructions textarea.
  - ContentOutputConfig (content-output subtype): output type selector (Blog Post/Email/
    Ad Copy/LinkedIn Post/Video Script/Landing Page/Custom), target word count range,
    type-specific format options (tone, toggles, platform, section count, etc.).
  - PALETTE_NODES: added "Content Output" (output/content-output) node.
  - WorkflowCreationModal: shown on every fresh canvas load. Fields: workflow name,
    connectivity mode toggle (Online/Offline card buttons), default provider + model.
    Offline mode also shows a persistent floating OFFLINE badge on the canvas.
  - POST /api/v1/documents: accepts multipart upload, validates extension (pdf/docx/txt/
    md/csv/json/html), streams file to UPLOAD_DIR (default: ./uploads), returns
    { id, filename, storageKey, sizeBytes }. Skips DB record (clientId required in
    schema); future session can wire that up.

## What has been built (continued)
- Session 6 complete: detection-humanization loop
  - HumanizerConfig panel: mode selector (8 presets + Custom), 8 style sliders (0-100),
    model override (same checkbox/provider/model pattern as AI Generate node),
    "Targeted rewriting only" toggle (default on, description explains it).
    Selecting a mode applies preset slider values automatically.
  - DetectionConfig panel: service selector (GPTZero/Originality.ai/Copyleaks/Sapling/Local),
    threshold slider (0-100, default 20), max retries field, API key env-var reference.
    After a run: shows score badge (green/amber/red), false positive warning banner,
    and list of flagged sentences.
  - ConditionalBranchConfig panel: condition type (detection_score/word_count/retry_count),
    operator (above/below), value input, pass/fail port labels (shown on node card),
    fallback humanizer selector (dropdown of humanizer nodes in the workflow).
  - LogicNode.tsx: added port configs for detection (1 in, pass/fail out) and
    conditional-branch (1 in, pass/fail out). Detection node card shows score badge
    post-run. Conditional-branch card shows dynamic port labels from config.
  - WorkflowStore: added 3 new PALETTE_NODES (humanizer, detection, conditional-branch)
    each with subtype in defaultConfig so executor registry can dispatch.
    onConnect now stores sourceHandle as edge label for pass/fail routing.
  - DetectionNodeExecutor: calls GPTZero API (or Originality.ai/Sapling/local fallback),
    parses response into overall_score and flagged_sentences array.
  - HumanizerNodeExecutor: builds prompt from mode + 8 slider values. When
    targeted_rewrite is on and flagged_sentences exists in input, rewrites only those
    sentences and preserves the rest exactly.
  - ConditionalBranchNodeExecutor: evaluates detection_score / word_count / retry_count
    against threshold; returns routePath ('pass'|'fail') used by runner for edge routing.
  - WorkflowRunner: getExecutor() now dispatches by "type:subtype" key falling back to
    "type". findDetectionLoops() detects Detection→Branch→Humanizer→Detection cycles.
    Loop-managed nodes (branch, humanizer) are excluded from wave execution and handled
    inline. Runner tracks retry count, detects no-improvement (false positive warning
    after 3 non-improving passes), and stores detectionState in RunOutput.
    Edge routing: edges from conditional-branch nodes are filtered by label matching
    routePath so downstream nodes receive input only from their matched path.
  - NodeRunStatus: added warning field (propagated from false-positive detection).

## Current session
- Session 6 done. Ready for Session 7.
