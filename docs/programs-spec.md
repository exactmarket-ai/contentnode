# ContentNode Program Marketing System — Spec

**Status:** In development  
**Date:** 2026-04-22

---

## What a Program Is

A Program is a standing marketing engagement — a defined strategy with a written brief, templates for every deliverable type, a configured cadence, and recurring content packs that flow into Pipeline for review.

Programs live within the vertical architecture: Agency → Vertical → Client. A program belongs to a client and optionally to a vertical. The vertical brain informs the strategy; the client brain grounds it. Agencies can define `VerticalProgramTemplate` records — reusable briefs and template sets at the vertical level — so new clients in that vertical start from the agency's proven framework rather than zero.

---

## Two-Phase PILOT Model

**Phase 1 — Think (Strategy)**  
One question at a time. Build understanding of goal, audience, message pillars, tone, competitive angle, content mix, cadence. Ends with a written program brief.

**Phase 2 — Build (Templates)**  
Walk through producing every deliverable template one by one. The PILOT proposes a draft, user approves or edits, item is recorded. Ends with a fully populated `ProgramContentPack` (isTemplate: true) containing all templates.

---

## Program Types (15)

### Content (Recurring)
- `thought_leadership` — perspective pieces + social
- `seo_content` — keyword-targeted blogs
- `newsletter` — full newsletter issue per cycle
- `social_media` — platform-specific post batches

### Outbound / Demand Gen (One-time: templates built once)
- `outbound_email_sequence` — 5-email cold sequence + voicemails + objection guide
- `linkedin_outreach_sequence` — connection + 4 follow-up messages
- `cold_calling_program` — opener, pitch, discovery questions, voicemails, objection handling, wrap-up

### Inbound / Nurture (One-time)
- `email_nurture_sequence` — full drip sequence (5–7 emails)
- `lead_magnet_program` — full document + landing page + delivery email
- `webinar_event_program` — invite sequence + post-event sequence + social posts

### ABM (One-time)
- `abm_program` — ICP profile template + personalised outreach templates + one-pager structure

### Retention (One-time)
- `customer_onboarding_program` — welcome + 3 milestone emails + checklist + FAQ
- `reengagement_program` — 3-email win-back + sunset email

### Partner (One-time)
- `partner_enablement_program` — welcome + co-marketing + co-sell + newsletter + press release templates

### Launch (One-time)
- `product_launch_program` — teaser + launch email + blog + press release + socials + sales one-pager + internal FAQ

---

## Execution Model

**Recurring programs** — trigger each cycle via linked ScheduledTask. Each cycle creates a new `ProgramContentPack` + `WorkflowRun` (surfaces in Pipeline).

**One-time programs** — PILOT session IS the execution. Completing Phase 2 creates the template pack. No further cycles. `executionModel = 'one_time'`.

---

## Vertical Architecture

- `Program.verticalId` (optional) — the vertical this program operates within
- `VerticalProgramTemplate` — agency-defined brief + template set at vertical level; cloned when creating a new program for a client in that vertical
- programsPILOT context builder pulls: Agency Brain → Vertical Brain → Client Brain (same stack as demandPILOT/gtmPILOT)

---

## Schema

See migration for full field list. Key additions:

**Program:** `verticalId`, `brief`, `cadence`, `cadenceCronExpr`, `executionModel`, `pilotPhase`, `pilotMessages`  
**New:** `ProgramContentPack`, `ProgramContentItem`, `VerticalProgramTemplate`

---

## productPILOT Phase 2 (parallel — implement after Programs)

After strategy synthesis, productPILOT enters Phase 2: produce the primary output document for the skill (product brief, GTM strategy doc, competitive battlecard, etc.) section by section. Saved as `ClientBrainAttachment` with `source = 'productpilot'`. Full skill→document mapping in implementation notes.
