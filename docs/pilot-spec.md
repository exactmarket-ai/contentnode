# ContentNode PILOT Specification

PILOTs are AI-guided conversational interfaces built into ContentNode. Every PILOT follows this spec so they are consistent in behavior, visual design, and API contract.

---

## Two PILOT archetypes

### Modal PILOT
A full-screen overlay modal that guides a user through a goal-driven setup or discovery session. Used when the user needs to produce a **structured output** (a program, a synthesis, a strategy document) before returning to the main UI.

**Current instances:** productPILOT · gtmPILOT · programsPILOT

### Panel PILOT
A collapsible panel anchored to a surface (e.g. the canvas bottom edge). Stays visible alongside the working surface and acts as a live co-pilot — aware of current state, able to apply changes directly. Dark-themed to match the canvas.

**Current instances:** nodePILOT

---

## Modal PILOT — UI standard

| Property | Value |
|---|---|
| Container | `fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90` |
| Panel | `flex flex-col w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden` |
| Height | `style={{ height: '80vh' }}` |
| Header height | `px-4 py-3` with `border-b border-border` |
| Avatar | `h-7 w-7 rounded-full` with PILOT brand color (see below), contains a `h-4 w-4 text-white` icon |
| PILOT name | `text-xs font-bold tracking-wide` in brand color |
| Subtitle | `text-[10px] text-muted-foreground` |
| Close button | `h-7 w-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground` |
| Messages area | `flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 min-h-0` |
| User bubble | `rounded-xl px-3 py-2 text-[12px] leading-relaxed text-white rounded-tr-sm` + brand color bg |
| Assistant bubble | `rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-zinc-100 text-foreground rounded-tl-sm` |
| Assistant avatar | `h-6 w-6 rounded-full mt-0.5` with brand color bg, `h-3.5 w-3.5 text-white` icon |
| Loading dots | Three `h-1.5 w-1.5 rounded-full bg-purple-500 animate-bounce` spans with 0/150/300ms delays, inside `bg-zinc-100 rounded-xl px-3 py-2` |
| Path buttons | `rounded-full border border-border bg-white px-3 py-1 text-[11px] font-medium text-foreground hover:border-purple-400 hover:bg-purple-50 hover:text-purple-900 transition-colors` |
| Input textarea | `flex-1 resize-none rounded-xl border border-border bg-white px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 min-h-[34px] max-h-[80px] overflow-y-auto` with `--tw-ring-color: brand-color` |
| Send button | `h-9 w-9 rounded-xl text-white disabled:opacity-40` with brand color bg |

**Behavior rules:**
- Greeting is hardcoded on mount — no API call for the opening message
- Opening paths appear as quick-reply buttons on the first assistant message
- Path buttons only render on the **last** assistant message
- Clicking a path button submits it as a user message (same as typing it)
- `sendMessage(overrideText?)` handles both typed input and path button clicks
- Auto-focus textarea `setTimeout(() => inputRef.current?.focus(), 80)` on mount
- Scroll: `lastMsgRef.scrollIntoView({ block: 'start', behavior: 'smooth' })` on every message change
- Overlay: `bg-black/90` — never lower opacity, never `backdrop-blur`
- Panel background: `bg-white` — always solid

**Success / output state:**
When the PILOT produces its structured output, switch to a success view inside the same modal (no close/reopen). Show a check icon, the result name/type, and a close button.

---

## Panel PILOT — UI standard

| Property | Value |
|---|---|
| Expanded panel | `relative flex shrink-0 flex-col border-t border-border bg-card` with `height: '70vh'` |
| Collapsed bar | `relative flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 cursor-pointer` with `height: 44` |
| Collapse/expand handle | Centered `w-12 h-3 rounded-b-sm border border-t-0 border-border bg-card` chevron bar |
| Avatar | `h-6 w-6 rounded-full bg-violet-600` with icon |
| User bubble | `bg-violet-600 text-white rounded-tr-sm` |
| Assistant bubble | `bg-muted text-foreground rounded-tl-sm` (inherits dark theme) |
| Loading dots | Same bounce pattern, `bg-muted` container |
| Input | `bg-background` (dark) |

**Special capabilities (nodePILOT):**
- Image attachment (for visual reference / style matching)
- Node suggestion cards with "Choose this" and "Add workflow" actions
- HTML apply button for html-page node output
- Workflow context injection (current nodes, client, HTML outputs)

---

## Brand colors per PILOT

| PILOT | Brand color | Icon |
|---|---|---|
| nodePILOT | `bg-violet-600` / `text-violet-700` | `Compass` |
| productPILOT | `#a200ee` | `Zap` |
| gtmPILOT | `#a200ee` | `Zap` |
| programsPILOT | `#a200ee` | `Zap` |

Future Modal PILOTs default to `#a200ee` + `Zap` unless a distinct identity is required.

---

## API contract — Modal PILOT

**Request** `POST /api/v1/[noun]/pilot`
```json
{
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "clientId": "...",
  "[contextId]": "..."
}
```
- `messages` array — validated with `z.array(messageSchema).min(0).max(60)`
- `min(0)` is required so the frontend can call with `[]` on any non-greeting turn

**Response**
```json
{
  "message": "...",
  "paths": ["option 1", "option 2", "option 3"],
  "[output]": { ... }
}
```
- `message` — the assistant reply, XML blocks stripped
- `paths` — 2–4 short quick-reply options (optional, omit when outputting structured data)
- `[output]` — the structured result (e.g. `program`, `synthesis`) when the session completes

---

## API contract — Panel PILOT

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

## LLM output format — Modal PILOT

The system prompt instructs the model to output structured blocks at the end of its response. The API strips these before returning `message`.

**`<PATHS>` block** — quick-reply suggestions (all Modal PILOTs):
```
<PATHS>
["option 1", "option 2", "option 3"]
</PATHS>
```
- 2–4 items, each under 50 characters
- Do NOT emit alongside a structured output block

**Structured output block** — PILOT-specific (e.g. `<PROGRAM_CONFIG>`, `<SYNTHESIS>`):
- Only emitted once, when user has confirmed the session is complete
- Triggers server-side record creation / brain write
- Never emitted at the same time as `<PATHS>`

---

## LLM output format — Panel PILOT

```
<NODEPILOT_SUGGESTIONS>
[{ "id": "...", "title": "...", "description": "...", "nodes": [...], "edges": [...] }]
</NODEPILOT_SUGGESTIONS>
```

---

## Implementation checklist for a new Modal PILOT

- [ ] Frontend: `[Name]Pilot.tsx` in `apps/web/src/components/pilot/`
- [ ] Hardcoded `OPENING_GREETING` constant (string with `\n\n`)
- [ ] Hardcoded `OPENING_PATHS` constant (string array)
- [ ] `useState<PilotMessage[]>` initialized with the opening greeting + paths
- [ ] `sendMessage(overrideText?)` with `useCallback`
- [ ] `inputRef` auto-focused on mount with 80ms delay
- [ ] `lastMsgRef.scrollIntoView({ block: 'start' })` on messages change
- [ ] Overlay `bg-black/90`, panel `bg-white`, never transparent
- [ ] API route `POST /api/v1/[noun]/pilot`
- [ ] Zod schema: `messages: z.array(messageSchema).min(0).max(60)`
- [ ] System prompt via `{ ...MODEL_CONFIG, system_prompt: buildSystemPrompt(...) }`
- [ ] `<PATHS>` block instruction + parser in route handler
- [ ] Structured output block instruction + parser + DB write
- [ ] Response: `{ message: cleanResponse, paths, [output] }`
