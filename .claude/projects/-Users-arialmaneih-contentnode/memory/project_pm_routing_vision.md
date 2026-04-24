---
name: PM routing vision — file naming, folder structure, trigger form
description: Agreed design for how ContentNode organizes Box files, names them, and syncs to Monday. Covers naming convention, folder structure, trigger form, versioning, and approval flow.
type: project
---

## File naming convention

`{client}-{project}-{topic}-{doc_title}-{date}-v{n}.{ext}`

Example:
`NexusTek-CMMC-Healthcare-Compliance-Blog-Post-2026-04-24-v1.docx`
`NexusTek-CMMC-Healthcare-Compliance-LinkedIn-Post-2026-04-24-v1.docx`

- **client**: `client.name` from DB
- **project**: workflow's configured project (Monday group name)
- **topic**: entered at trigger time in the run trigger form — the one field that changes per run
- **doc_title**: output node's label (e.g. "Blog Post", "LinkedIn Post")
- **date**: run date `YYYY-MM-DD`
- **version**: `itemVersion` from WorkflowRun (starts at 1, increments per revision run)
- Each segment: spaces → hyphens, special chars stripped

**"final" is NOT appended by the worker.** It is only added when an explicit approval event fires:
- Monday status column flips to "Approved" / "Client Signed Off" → webhook → rename Box file
- Or ContentNode portal: client clicks Approve → hook onto existing `decision: 'approved'` feedback flow

## Folder structure

```
/NexusTek/                          ← client root (client.boxFolderId)
  /CMMC/                            ← project folder (workflow-level config, Monday group name)
    /Healthcare-Compliance-2026-04-24/   ← run folder (auto-created: topic + date)
      NexusTek-CMMC-Healthcare-Compliance-Blog-Post-2026-04-24-v1.docx
      NexusTek-CMMC-Healthcare-Compliance-LinkedIn-Post-2026-04-24-v1.docx
    /Zero-Trust-2026-05-01/
      ...
```

Files are self-contained — full name even inside the folder, so they're identifiable when forwarded or downloaded.

## Trigger form

When kicking off a run from ContentNode, user fills in one field: **Topic**.

That single input does three things:
1. Becomes `{topic}` segment in every filename for that run
2. Names the run folder: `{topic}-{date}`
3. Gets passed as context to AI nodes (what to write about)

Everything else (client, project, format, AI config) is pre-configured on the workflow. The topic is the only thing that changes week to week.

## Workflow-level PM config (set once, inherited by all runs)

- **Project**: Monday group dropdown (loaded live from client's board)
- **Run folder naming**: auto = `{topic}-{date}` (always, no config needed)
- **Monday status on delivery**: status label to set when files land (e.g. "Ready for Review")

## Node-level PM routing (per output node)

- **Monday URL column**: dropdown of link/text columns from the board (loaded live)
- Box subfolder per node is NOT needed — all outputs from a run go into the same run folder
- Status is workflow-level, not node-level

All dropdowns in the node config are populated live from Monday's actual board data (columns, status labels) and Box's actual folder structure — no free-text fields.

## Monday as destination, not source

ContentNode owns the trigger (manual, scheduled, campaign). Monday is where results surface for the PM.

Worker always creates a new Monday item in the configured group when a run completes:
- Item name = run folder name (`{topic}-{date}`)
- Writes each output node's Box URL to its configured column
- Sets status if configured

Monday webhook trigger is not the primary model. The Box feedback loop (FILE.NEW_VERSION → brain/humanizer signal) still works on top of this.

## Versioning

- Initial delivery: v1
- Each revision run (feedback → rework): v2, v3, etc.
- `itemVersion` on WorkflowRun is the source of truth for the version number
- "final" is an approval event, not a version number

**Why:** Calling something "final" on first delivery is wrong — it goes through agency review, client review, revisions. Only an explicit approval (Monday status or portal click) earns the "final" suffix.
