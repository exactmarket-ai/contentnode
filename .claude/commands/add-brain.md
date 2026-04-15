# /add-brain — Add a Brain Component to an Entity

A "brain" in ContentNode is a persistent intelligence layer attached to an entity (client, campaign, workflow, etc.). It lets users feed documents and URLs into Claude, which extracts structured context that AI nodes draw from at run time.

The user invoking this command will pass a target entity, e.g.:
`/add-brain campaign` or `/add-brain client-vertical`

## What a Brain Consists Of

### 1. Storage (DB)
A brain needs one or two tables:
- **Attachments table** — one row per uploaded file or URL. Stores: `storageKey`, `filename`, `mimeType`, `sizeBytes`, `extractionStatus` (pending|processing|ready|failed), `extractedText` (raw text Claude parsed), `summary` (Claude's 3-5 sentence interpretation of the file's contribution), `summaryStatus`.
- **Profile/context table** — one row per entity. Stores: `extractionStatus`, `extractedJson` (Claude-structured output), `editedJson` (user overrides), `sourceText` (combined raw text used for extraction, capped at 500KB).

If a brain is simple (just free-text context, no structured JSON), a single `context Text` column on the parent entity is enough (e.g. Campaign brain).

### 2. API Endpoints (apps/api/src/routes/)
Add to the entity's route file:

```
GET    /:id/brain/attachments          — list attachments (status, summary preview)
POST   /:id/brain/attachments          — upload file (multipart)
POST   /:id/brain/attachments/from-url — add URL source (enqueues scrape job)
GET    /:id/brain/attachments/:aid/text — full extracted text
PATCH  /:id/brain/attachments/:aid     — update summary (user edit)
DELETE /:id/brain/attachments/:aid     — remove file
GET    /:id/brain                      — get current context/extracted JSON
PATCH  /:id/brain                      — save user-edited context
```

Accepted file types: pdf, docx, txt, md, csv, json, html (and optionally mp4, mp3, wav for audio transcription).

Upload handler: stream to `UPLOAD_DIR` (or R2), create DB record, enqueue `brain-attachment-process` BullMQ job.

URL handler: create DB record with `sourceUrl`, enqueue same job.

### 3. Worker Job (workers/workflow/src/)
Create `<entity>BrainExtraction.ts`. The job does:

**Step A — Text extraction** (per attachment):
- PDF → `pdf2json`
- DOCX → `mammoth`
- TXT/MD/CSV/JSON/HTML → Buffer → UTF-8
- URL → fetch page HTML, strip tags with regex, trim to 10KB per page
- Audio/video → AssemblyAI transcription

**Step B — File summary** (per attachment, after text extraction):
```
callModel({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', maxTokens: 512 },
  `You are reviewing a document uploaded to a ${entityType} brain.
   Write a concise 3-5 sentence interpretation of what this document contributes.
   Extracted text (first 20KB): ${text.slice(0, 20000)}`)
```
Store result in `summary`, set `summaryStatus: ready`.

**Step C — Full context extraction** (after summary, combines all ready attachments):
```
callModel({ provider: 'anthropic', model: 'claude-sonnet-4-6', maxTokens: 8192, temperature: 0.1 },
  systemPrompt,
  combinedText.slice(0, 50000))
```
Store structured JSON in `extractedJson`. For simple text-only brains, store the result as plain text in `context`.

Register the queue in `workers/workflow/src/index.ts`.

### 4. Frontend UI (apps/web/src/)

The brain panel is a collapsible section (like the Brief panel in CampaignsTab) with three zones:

**Zone A — Add sources:**
- URL input with "Fetch" button → POST `.../from-url`
- Drag-drop file upload zone → POST `.../attachments` (multipart)
- Show accepted file types as hint text

**Zone B — Attachment list:**
Each row shows: filename/URL, extraction status badge (pending/processing/ready/failed), summary (editable inline via PATCH), "View raw" link.
- While `extractionStatus === 'processing'`: show spinner
- On `ready`: show green badge + collapsed summary (expand on click)
- User can edit the summary directly (blur saves via PATCH)

**Zone C — Extracted context (editable):**
After all attachments are ready, show the combined extracted context in a `<textarea>` (or `BriefMarkdown` renderer with edit toggle). User edits save via PATCH `/:id/brain` with `{ context: editedText }`.
Show a "Re-extract" button that re-runs the full extraction job.

**Polling**: poll `GET /:id/brain/attachments` every 4 seconds while any attachment has `extractionStatus !== 'ready'`. Stop when all ready or failed.

### 5. Node Executor Integration (workers/workflow/src/executors/)
When a node type draws from this brain, its executor:
1. Fetches the entity's brain context from DB
2. Formats it as readable text prepended to the node's prompt
3. Appends the top N attachment summaries (most recent first)

Output format:
```
--- [ENTITY TYPE] BRAIN CONTEXT ---
[context/extracted JSON as readable key-value pairs]
--- DOCUMENT SUMMARIES ---
[1. filename — summary]
[2. filename — summary]
---
```

## Existing Brain Implementations to Reference

| Brain | Entity | Key files |
|-------|--------|-----------|
| Client Brand Brain | Client + Vertical | `apps/api/src/routes/clients.ts` (lines ~2591-3042), `workers/workflow/src/brandExtraction.ts`, `apps/web/src/pages/ClientBrandingTab.tsx` |
| Client DG Brain | Client | `packages/database/prisma/schema.prisma` (ClientDemandGenBase), `apps/api/src/routes/clients.ts` (DG endpoints) |
| GTM Framework Brain | Client + Vertical | `apps/api/src/routes/clients.ts` (GTM endpoints), `workers/workflow/src/executors/gtmFramework.ts` |

## What Changes Per Instance

When implementing a new brain, substitute:
- `<Entity>` → the entity name (Campaign, Workspace, etc.)
- `<entity>` → lowercase version for variable names
- `<entityId>` → the FK column name (e.g. `campaign_id`)
- Queue name → `<entity>-brain-process`
- Table names → `<entity>_brain_attachments`, `<entity>_brain_context`
- System prompt → tailored to what the entity is and what Claude should extract

## Arguments

When this command is invoked, the user will specify the target entity and any scope constraints. Ask clarifying questions if the entity isn't clear. Then implement the full stack in this order:
1. DB migration (schema + migration SQL)
2. API routes
3. Worker job (register queue + processor)
4. Frontend panel component
5. (Optional) Executor integration if a workflow node should draw from this brain
