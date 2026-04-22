# ContentNode PILOT Specification

---

## What a PILOT is

Most AI interactions produce an answer. A PILOT's job is different: **guide the user to find the best answer themselves**.

A PILOT is a thinking partner. It asks sharp questions, surfaces tradeoffs, presents options, and helps users explore what they actually need — rather than skipping straight to a recommendation. The user should feel ownership of the outcome. The PILOT just helped them think it through clearly.

**A PILOT is not:**
- A form assistant ("fill in field 1, then field 2")
- A configuration wizard ("here is your setup")
- A Q&A bot ("here is the answer to your question")

**A PILOT is:**
- A guide that presents 2–3 directions and asks which resonates
- A thinking partner that surfaces contradictions, tradeoffs, and overlooked angles
- A Socratic questioner that helps users clarify their own thinking
- A session that ends when the user has arrived at their own answer — not when the AI has outputted one

---

## Core behavioral rules — apply to every PILOT

These rules govern every PILOT regardless of type, surface, or domain:

1. **One question per turn.** Never stack questions. Ask the one that matters most right now. Wait for the answer before moving forward.

2. **Always present options, never prescribe.** When a user states a goal or problem, respond with 2–3 directions they could go — each with a clear tradeoff — rather than jumping to a single recommendation.

3. **Paths are the primary interaction model.** Every assistant turn should end with 2–4 quick-reply paths. These aren't navigation shortcuts — they ARE how the user guides the conversation. A user should rarely need to type from scratch.

4. **Short responses.** 3–5 lines of conversational text + one sharp question + paths. Never write a wall of text. If something needs explaining, ask a question first so the explanation is relevant.

5. **Never ask for information you already have.** Reference context from the brain, prior answers, or injected data. Only ask for what's genuinely unknown.

6. **Surface the uncomfortable question.** The question the user is hoping you won't ask is usually the most important one. A PILOT earns trust by asking it respectfully.

7. **The user arrives at the answer.** A PILOT does not deliver a conclusion — it asks questions until the user can state the conclusion themselves. The final output (a program config, a synthesis, a strategy doc) should feel like the user's own thinking, articulated clearly.

---

## Two PILOT archetypes

### Modal PILOT
A full-screen overlay modal. Used when the goal is to produce a **structured output** (a program config, a strategic synthesis, a framework section) through guided conversation. The session has a clear arc: orient → explore → narrow → confirm → output.

**Current instances:** productPILOT · gtmPILOT · programsPILOT · demandPILOT · researchPILOT · taskPILOT

### Panel PILOT
A collapsible panel anchored to a working surface (e.g. the canvas). Stays open alongside the user's work. Acts as a live co-pilot — context-aware, able to apply changes directly. Sessions are open-ended, not arc-driven.

**Current instances:** nodePILOT

---

## Modal PILOT — session arc

Every Modal PILOT session should follow this arc:

**Orient** (turn 1–2): Understand what the user is actually trying to achieve. Don't assume the stated goal is the real goal. Ask what success looks like, or what problem they're solving.

**Explore** (middle turns): Present options, surface tradeoffs, ask one sharp question per turn. Go to the underexplored angles. Challenge assumptions. Reference what you already know from context before asking for it.

**Narrow** (late turns): The conversation has revealed what the right answer is. Confirm understanding before committing. "Based on what you've told me, it sounds like X — does that feel right?"

**Output** (final turn): The user has confirmed. Produce the structured output block. This signals the session is complete.

---

## Modal PILOT — UI standard

| Property | Value |
|---|---|
| Overlay | `fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90` |
| Panel | `flex flex-col w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden` |
| Height | `style={{ height: '80vh' }}` |
| Header | `px-4 py-3 border-b border-border` |
| Avatar | `h-7 w-7 rounded-full` in brand color, `h-4 w-4 text-white` icon |
| PILOT name | `text-xs font-bold tracking-wide` in brand color |
| Subtitle | `text-[10px] text-muted-foreground` |
| Close button | `h-7 w-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground` |
| Messages area | `flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0` |
| User bubble | `rounded-xl px-3 py-2 text-[12px] leading-relaxed text-white rounded-tr-sm` + brand color bg |
| Assistant bubble | `rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-zinc-100 text-foreground rounded-tl-sm` |
| Assistant avatar | `h-6 w-6 rounded-full mt-0.5` in brand color, `h-3.5 w-3.5 text-white` icon |
| Loading dots | Three `h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce` at 0/150/300ms, in `bg-zinc-100 rounded-xl px-3 py-2` |
| Path buttons | `rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium hover:border-purple-400 hover:bg-purple-50 hover:text-purple-900 transition-colors` |
| Input | `resize-none rounded-xl border border-border bg-white px-3 py-2 text-[12px] min-h-[34px] max-h-[80px]` with `--tw-ring-color: brand-color` |
| Send button | `h-9 w-9 rounded-xl text-white disabled:opacity-40` in brand color |

**Behavior rules:**
- Opening greeting is hardcoded on mount — no API round-trip to show the first message
- Opening paths render immediately with the greeting
- Path buttons only render on the **last** assistant message
- Clicking a path submits it as a user message
- `sendMessage(overrideText?)` handles both typed input and path button clicks
- Auto-focus textarea on mount: `setTimeout(() => inputRef.current?.focus(), 80)`
- Scroll: `lastMsgRef.scrollIntoView({ block: 'start', behavior: 'smooth' })` on every message change
- Overlay: `bg-black/90` — never lower, never `backdrop-blur`
- Panel: `bg-white` — always solid, never transparent

**Success state:**
When the output block is produced, switch to an in-panel success view (no close/reopen cycle). Show a check icon, the result name, and a close button.

---

## Panel PILOT — UI standard

| Property | Value |
|---|---|
| Expanded | `relative flex shrink-0 flex-col border-t border-border bg-card` at `height: '70vh'` |
| Collapsed | `relative flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 cursor-pointer` at `height: 44` |
| Expand/collapse | Centered `w-12 h-3 rounded-b-sm border border-t-0 border-border bg-card` chevron handle |
| Avatar | `h-6 w-6 rounded-full bg-violet-600` |
| User bubble | `bg-violet-600 text-white rounded-tr-sm` |
| Assistant bubble | `bg-muted text-foreground rounded-tl-sm` (inherits dark theme) |
| Input | `bg-background` (dark) |

nodePILOT-specific capabilities: image attachment, node suggestion cards, HTML apply button, live workflow context injection.

---

## Brand colors

| PILOT | Brand color | Icon |
|---|---|---|
| nodePILOT | `bg-violet-600` / `text-violet-700` | `Compass` |
| productPILOT | `#a200ee` | `Zap` |
| gtmPILOT | `#a200ee` | `Zap` |
| programsPILOT | `#a200ee` | `Zap` |
| demandPILOT | `#a200ee` | `Zap` |
| researchPILOT | `#a200ee` | `Zap` |
| taskPILOT | `#a200ee` | `Zap` |

New Modal PILOTs default to `#a200ee` + `Zap` unless a distinct identity is required.

---

## API contract — Modal PILOT

**Request** `POST /api/v1/[noun]/pilot`
```json
{
  "messages": [{ "role": "user", "content": "..." }],
  "clientId": "...",
  "[contextId]": "..."
}
```
- `messages: z.array(messageSchema).min(0).max(60)` — `min(0)` required so opening turns work

**Response**
```json
{
  "message": "...",
  "paths": ["option 1", "option 2", "option 3"],
  "[output]": {}
}
```
- `message` — assistant reply, XML blocks stripped
- `paths` — 2–4 quick-reply options; omit when emitting a structured output block
- `[output]` — structured result (e.g. `program`, `synthesis`) when session completes

System prompt is passed via `{ ...MODEL_CONFIG, system_prompt: buildSystemPrompt(...) }`.

---

## LLM output format — Modal PILOT

Structured blocks appear at the end of the LLM response. The API strips them before returning `message`.

**`<PATHS>` block** — always include unless emitting an output block:
```
<PATHS>
["option A — 5-8 words specific to this moment", "option B — a challenge or pushback angle", "option C — an adjacent dimension they haven't considered"]
</PATHS>
```
- Each path is 5–8 words, specific to what was just discussed
- Path A: most natural next step
- Path B: a challenge, contradiction, or "what if we're wrong" angle
- Path C: an adjacent dimension worth exploring
- Never generic ("tell me more", "go deeper", "continue")

**Structured output block** — PILOT-specific, emitted once when user confirms:
- `<PROGRAM_CONFIG>` — programsPILOT
- `<SKILL_SYNTHESIS>` — productPILOT
- Others defined per PILOT

Never emit `<PATHS>` in the same response as a structured output block.

---

## API contract — Panel PILOT (nodePILOT)

**Request** `POST /api/v1/nodepilot/chat`
```json
{
  "messages": [{ "role": "user", "content": "...", "image": { "base64": "...", "mediaType": "image/jpeg" } }],
  "workflowContext": { "workflowName": "...", "clientId": "...", "nodes": [...], "htmlOutputs": [...] }
}
```

**Response**
```json
{
  "data": {
    "reply": "...",
    "suggestions": [{ "id": "...", "title": "...", "description": "...", "nodes": [...], "edges": [...] }]
  }
}
```

---

## Implementation checklist — new Modal PILOT

- [ ] `[Name]Pilot.tsx` in `apps/web/src/components/pilot/` (or inline if page-scoped)
- [ ] Hardcoded `OPENING_GREETING` — orients to purpose, ends with first guiding question
- [ ] Hardcoded `OPENING_PATHS` — 3–5 short directions the user might take
- [ ] `useState<PilotMessage[]>` initialized with opening greeting + paths
- [ ] `sendMessage(overrideText?)` with `useCallback`
- [ ] `inputRef` auto-focused on mount (80ms delay)
- [ ] `lastMsgRef.scrollIntoView({ block: 'start' })` on messages change
- [ ] Overlay `bg-black/90`, panel `bg-white`, no transparency anywhere
- [ ] API route `POST /api/v1/[noun]/pilot`
- [ ] Zod: `messages: z.array(messageSchema).min(0).max(60)`
- [ ] System prompt bakes in core behavioral rules (guide, don't answer; one question; always paths)
- [ ] `<PATHS>` instruction + parser in route handler
- [ ] Structured output block instruction + parser + DB write
- [ ] Response: `{ message, paths, [output] }`
