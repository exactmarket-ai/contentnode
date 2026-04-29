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
6. Modal/dialog UI rule (non-negotiable — do not deviate):
   - Overlay div: `className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"`
   - Content box: `bg-white border border-border rounded-xl shadow-2xl`
   - NEVER use `bg-card`, `bg-background`, or any opacity suffix on modal content boxes
   - Reference: apps/web/src/components/modals/CampaignCreationModal.tsx
   - Inline list cards (non-modal): `bg-transparent border border-border`

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

## What has been built (continued)
- Session 8 complete: client feedback node + client portal
  - Schema migration: WorkflowRun gains trigger_type / reentry_from_node_id / parent_run_id;
    Feedback gains star_rating / tone_feedback / content_tags (JSON) / specific_changes (JSON).
    decision field now accepts 'approved_with_changes' in addition to existing values.
  - FeedbackNodeExecutor (output:client-feedback): refreshes magic link tokens for configured
    stakeholders, returns waitingFeedback: true. Runner handles this by setting run →
    'waiting_feedback' and storing pendingFeedbackNodeId in RunOutput.
    Both 'waiting_feedback' and 'awaiting_assignment' are treated as resume-eligible statuses.
  - Portal routes at /portal/* — excluded from Clerk auth via check in authPlugin preHandler:
    POST /portal/auth/send-link (agency-side: generate magic link for stakeholder)
    GET  /portal/auth/verify (validate token, return stakeholder + client info)
    GET  /portal/deliverables (list completed/waiting runs for stakeholder's client)
    GET  /portal/deliverables/:id (run detail + prior feedback + attached documents)
    POST /portal/deliverables/:id/feedback (submit feedback, auto-triggers child run if
      trigger_mode=auto and sentiment is in auto_trigger_on and retries < max_auto_retries)
    GET  /portal/feedback (all feedback history for this stakeholder)
  - Token auth: magic link token via Authorization: Bearer <token> or ?token= query param.
    resolveToken() validates uniqueness + expiry; all DB queries scoped via withAgency().
  - ClientFeedbackConfig panel (output/client-feedback subtype):
    source_type selector (portal/manual/transcription), trigger_mode toggle (auto/manual),
    auto-trigger sentiment checkboxes (needs_revision / rejected / etc.),
    default re-entry node dropdown, per-sentiment conditional re-entry rules,
    max_auto_retries field, stakeholder_ids textarea (portal mode),
    inline manual feedback form (sentiment + star rating + tone + content tags + comment).
  - New 'Client Feedback' palette node in workflowStore PALETTE_NODES (category: output).
  - Env vars used: PORTAL_BASE_URL (default: http://localhost:5173)

## What has been built (continued)
- Session 9 complete: pattern intelligence layer + insight nodes
  - Schema migration: Stakeholder gains `seniority` (owner/senior/member/junior);
    Insight gains `status` (pending/applied/confirmed/dismissed), `instanceCount`,
    `stakeholderIds`, `isCollective`, `evidenceQuotes`, `suggestedNodeType`,
    `suggestedConfigChange`, `connectedNodeId`, `baselineScore`,
    `postApplicationScore`, `appliedRunCount`, `dismissedUntilRun`, `appliedAt`.
  - BullMQ queue `pattern-detection`: triggered after every Feedback record is
    created (from both /api/v1/feedback and /portal/deliverables/:id/feedback).
  - Pattern detector (workers/workflow/src/patternDetector.ts): per-client,
    detects 5 pattern types (tone, forbidden_term, structure, length, claims).
    Individual threshold: 3+ instances from one stakeholder.
    Collective threshold: 2+ weighted instances across stakeholders.
    Confidence = (instance_count × seniority_weight) / total_runs. De-duplication
    against existing pending/applied insights. Creates Insight records.
  - Outcome tracking: trackInsightOutcomes() called after each completed run —
    records baseline_score from prior 5 runs, updates post_application_score and
    applied_run_count on all applied insights.
  - InsightNodeExecutor (output → insight): marks insight as 'applied' on first
    execution, passes input through to downstream node.
  - API: GET/PATCH /api/v1/insights with status/client/type filtering;
    GET /api/v1/insights/pending/count; full CRUD on feedback.
  - Frontend: NodePalette now has Nodes/Insights tabs. Insights tab shows
    InsightsSidebar (pending insights grouped by client, live-fetched, refreshable).
    InsightCard shows pattern type, confidence badge with attention indicator for
    confidence > 0.6, evidence quotes (collapsed by default), draggable.
    InsightNode canvas node (gold color, handles pass-through + config preview).
    InsightConfig panel shows config change preview and suggested connection.
    InsightConfirmationBanner: non-blocking overlay bottom-right after 3 runs with
    improvement. "Yes make it permanent" bakes config into connected node + removes
    insight node + sets status confirmed. "Not yet" dismisses for 2 runs then
    re-prompts.

## What has been built (continued)
- Session 11 complete: humanizer hardening + re-run feature + client page fixes
  - Content chunking: `processInChunks(content, chunkFn)` at sentence boundaries
    (MAX_CHUNK_WORDS=400) wired into all three humanizer providers (Undetectable,
    BypassGPT, StealthGPT). Chunks reassembled with single newlines.
  - StealthGPT removed from UI service selector — API consistently times out
    (3+ min/chunk at 400 words). Key retained in .env but service not offered.
  - BypassGPT integration: async submit/poll pattern.
    POST /generate `{ input, model_type: 'Enhanced' }` →
    poll GET /retrieval?task_id= until `data.finished && data.bypass_status === 'ok'`.
    Base URL: https://www.bypassgpt.ai/api/bypassgpt/v1. Key: BYPASSGPT_API_KEY.
    HUMANIZER_SERVICE=undetectable (default).
  - Re-run from here: POST /api/v1/runs/:id/rerun-from/:nodeId
    BFS from startNode finds all descendants. New run is created with upstream nodes
    pre-seeded as 'passed' in output. Runner's existing resume logic skips passed nodes.
    ConfigPanel: shows "Re-run from here" (passed nodes) or "Retry from here" (failed)
    after a run completes/fails. AI Generate shows output preview + Copy button post-run.
  - All client/stakeholder pages migrated from plain fetch() to apiFetch() for auth.
  - Workflow loading by ID: /workflows/:workflowId route in App.tsx. WorkflowEditor
    useEffect loads workflow from API when workflowId param is present; maps DB fields
    (positionX/positionY) → RF position.x/y; WorkflowCreationModal skipped for existing.
  - ClientDetailPage: "Stakeholder/contacts" renamed → "Contact/contacts" throughout UI.
    Safe access `wf._count?.runs ?? 0` prevents crash. Open button navigates to
    /workflows/:id. PATCH /workflows/:id response includes _count.
  - TopBar: poll timeout extended to 20 min (MAX_POLLS=600, POLL_INTERVAL_MS=2000).
    Save button wired to PATCH /api/v1/workflows/:id.
  - Usage panel: per-service word tracking for Undetectable.ai and BypassGPT (with
    limit bar); Claude shows word count only; StealthGPT row removed.

## What has been built (continued — recent sessions)
- Prompt Library tab on ClientDetailPage: per-client template management
  - Generate from Brain: BullMQ QUEUE_PROMPT_SUGGEST job → generatePromptSuggestions()
    uses client's brandProfiles/brandBuilders/brandAttachments/frameworks via Prisma,
    calls Claude Haiku, creates PromptTemplate records (source: 'ai'). Old AI prompts
    marked isStale before new ones created.
  - CRITICAL: generatePromptSuggestions() MUST be called inside withAgency() —
    clients table uses FORCE RLS, without agency context all rows return null silently.
  - Edit prompt = fork-as-new: clicking "Edit as new" opens NewTemplateModal pre-filled
    with the original's content. Saves as a new user-source template; original unchanged.
  - PromptPickerModal: in AI Generate node config, "Load from Library" opens picker.
    Fetches /api/v1/prompts (global) + /api/v1/prompts?clientId= (client-specific).
  - API: /api/v1/template-library for CRUD; /api/v1/prompts for picker (read-only alias)
- Detection node fix: env var name fallback bug
  - process.env[apiKeyRef] ?? apiKeyRef — when var unset, fell back to var NAME as key
  - Fix: /^[A-Z][A-Z0-9_]+$/.test(apiKeyRef) ? null : apiKeyRef — treats all-caps names
    as missing and falls back to local detection rather than sending invalid key to API
- Reviews flow: AssigneePicker in TopBar sets defaultAssigneeId on workflow.
  Run creation inherits assigneeId from workflow. Runner sets reviewStatus: 'pending'
  on completion. ReviewsTab in ClientDetailPage now shows Assignee column.
- Default AI model: claude-sonnet-4-5 (CLAUDE.md) / claude-haiku-4-5-20251001 (promptSuggester)

## What has been built (continued — Phase 3 Intelligence Tools)
- Phase 3 complete: 4 intelligence source nodes for demand gen research
  - **Deep Web Scrape** (`deep_web_scrape` executor):
    - Multi-page BFS crawler — fetches seed URL(s), extracts links, follows up to 20 pages
    - Link filtering by domain (stay-on-domain default) + optional regex pattern filter
    - 4 synthesis targets: General Summary / S7 External Intelligence / §12 Competitive / Raw
    - Uses native `fetch()` + regex HTML stripping + Claude for synthesis
  - **Review Miner** (`review_miner` executor):
    - Scrapes Trustpilot, G2, Capterra, or custom URLs for a company and its competitors
    - 5 synthesis types: Theme Analysis / Competitive Battlecard / Objection Map / Testimonials / Full
    - Note: Trustpilot works best (server-rendered HTML); G2/Capterra may be partial (JS-heavy)
    - Graceful degradation — reports which sources returned no data
  - **SEO Intent Tool** (`seo_intent` executor):
    - 3 data sources: Claude inference (no key), Google Autocomplete (free), DataForSEO (paid)
    - Expands seed keywords into 10–60 variations + classifies by intent
    - Funnel stage mapping: Awareness / Consideration / Decision
    - DataForSEO: basic auth via `login:password` credential env var ref
  - **Audience Signal Scraper** (`audience_signal` executor):
    - Reddit public JSON API (no API key required) — searches subreddits or global Reddit
    - Fetches top comments for each post (additional signal depth)
    - 5 analysis goals: Pain Points / Vocabulary Map / Objection Map / Question Map / Full
    - Filters by min upvotes; sorted by score
  - All 4 use `callModel()` for synthesis via `@contentnode/ai` provider
  - Config panels in `apps/web/src/components/layout/config/source/`
  - Registered in EXECUTOR_REGISTRY in `runner.ts`
  - 4 palette nodes in PALETTE_NODES (category: source)
  - 3 new workflow templates: Competitive Intelligence Pack, SEO Content Strategy,
    Market Signal Research Brief (all in `demand_gen` category)
  - `FieldGroup` now accepts optional `description` prop (backwards compatible)

## Architecture notes
- RLS enforcement: every worker job touching tenant data needs withAgency(agencyId, fn)
- Rate limiting: @fastify/rate-limit registered globally but opt-in (global: false).
  Add config: { rateLimit: { max: N, timeWindow: 'Xm' } } to each route that needs it.
- Dockerfiles (Dockerfile.api/worker/web): currently run as root — no USER directive.
  See TODO for fix.

## What has been built (continued — Phase 5 Campaign Layer)
- Campaign layer complete: groups workflows under a shared goal/timeline
  - **DB**: `Campaign` model (id, agencyId, clientId, name, goal, status, brief, startDate, endDate)
    `CampaignWorkflow` junction model (campaignId, workflowId, order, role)
    `WorkflowRun.campaignId` (optional FK — set when run is triggered from a campaign)
    Relations added to Agency, Client, Workflow models
  - **API** (`/api/v1/campaigns`): full CRUD, add/remove/reorder workflows per campaign
    `POST /:id/run` — creates WorkflowRun records + enqueues all in parallel on BullMQ
    `POST /:id/brief` — generates campaign brief using Claude with client DG/GTM context
    `GET /:id/bundle` — returns latest completed run output per workflow as structured bundle
    Campaign marked `active` on first run; workflow roles: lead_magnet, email_nurture, landing_page, outreach, ad_copy, blog, social, research, custom
  - **Frontend**: `CampaignsTab.tsx` on ClientDetailPage (tab: 'campaigns')
    `CampaignCreationModal.tsx` — name, goal (5 options), dates, workflow multi-select
    Campaign card: expandable, shows workflow list with run status dots + progress bar
    Actions: Run All (fires parallel), Generate Brief (Claude), View Outputs (bundle), Delete
    Empty state with first-campaign CTA

## Workflow rules — always follow these, every session
1. **Never push to main/production directly.** Always push to `staging` branch:
   `git push origin main:staging`. Only push to `main` when explicitly told to.
2. **Hold commits until asked.** Batch related fixes into one commit. Do not commit
   after every change — wait for the user to say push or commit.
3. **Staging first, always.** Verify on staging before touching production.
   If staging works and prod doesn't, it's a data/config problem — do not change code.
4. **Brain intelligence uses Sonnet, never Haiku.** Any AI call that feeds
   StakeholderPreferenceProfile, BrainAttachment, Insight generation, pattern detection,
   or style signal extraction must use `claude-sonnet-4-6`. Haiku is only for fast,
   low-stakes tasks (prompt suggestions, short labels).
5. **Do not touch working code to fix a data problem.** Diagnose first, ask if unsure.

## Protected files — verify before every push
Each entry below is a file that is easy to break silently and hard to catch without manual
verification. Before pushing any change to these files, complete the listed check.

| File | What breaks silently | Verification required before push |
|------|---------------------|-----------------------------------|
| `apps/web/src/lib/downloadDocx.ts` | Adjacent `Table` elements merge in Word with no paragraph between them. Cell padding inconsistency if `margins` is omitted from any `TableCell`. Instruction text / headings disappear if the surrounding `if` block condition changes. | Download the GTM Framework DOCX from the UI and open it. Confirm all 18 sections present, no tables merged, padding consistent. |

## Current session
- MVP running in production on Railway (API + worker) + Vercel (web).
- Security audit completed 2026-04-12. Two findings: Docker root user, axios CVE in sendgrid.
