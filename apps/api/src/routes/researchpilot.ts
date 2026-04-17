/**
 * researchpilot.ts
 *
 * POST /api/v1/research-pilot/chat   — AI chat with 6-dimension framework context
 * POST /api/v1/research-pilot/upload — Extract text from .docx or .pdf for chat attachment
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import Anthropic                from '@anthropic-ai/sdk'

// ─── Lazy CJS interop helpers ─────────────────────────────────────────────────

type MammothModule = { convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }> }
let _mammoth: MammothModule | null = null
async function getMammoth(): Promise<MammothModule> {
  if (!_mammoth) {
    const mod = await import('mammoth') as any
    _mammoth = mod.default ?? mod
  }
  return _mammoth!
}

type PdfParseModule = (buffer: Buffer) => Promise<{ text: string; numpages: number }>
let _pdfParse: PdfParseModule | null = null
async function getPdfParse(): Promise<PdfParseModule> {
  if (!_pdfParse) {
    const mod = await import('pdf-parse') as any
    _pdfParse = mod.default ?? mod
  }
  return _pdfParse!
}

// ─── Text extraction ──────────────────────────────────────────────────────────

const MAX_ATTACHMENT_CHARS = 20_000

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await getMammoth()
  const result  = await mammoth.convertToHtml({ buffer })
  // Strip HTML tags from mammoth output
  return result.value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parse = await getPdfParse()
  const result = await parse(buffer)
  return result.text
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Chat schema ──────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role:    z.enum(['user', 'assistant']),
  content: z.string().max(100000), // long research responses can be 15k+ chars
})

const chatBody = z.object({
  messages:          z.array(messageSchema).min(1).max(40),
  prospectName:      z.string().optional().nullable(),
  prospectUrl:       z.string().optional().nullable(),
  assessmentContext: z.record(z.unknown()).optional(),
})

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are researchPILOT, the AI research strategist built into ContentNode's researchNODE tool. You help agency teams conduct Market Positioning & Competitive Assessments on prospects and potential clients — producing intelligence that supports a tailored capabilities deck and service proposal.

Your role: guide users through the 6-dimension assessment framework, help them interpret research findings, assign accurate maturity scores (1–5), and translate gaps into specific service opportunities.

When the user attaches a document, read it carefully and extract any signals relevant to the assessment dimensions. Treat attached documents as primary research material — analyst reports, whitepapers, competitive intelligence, and industry research are all valuable inputs. Summarise what's in the document and explain how it affects the assessment.

THE 6-DIMENSION ASSESSMENT FRAMEWORK (dimensions with weights and scoring):

**Dimension 1 — Website & Messaging Audit (20%)**
What to research: Homepage headline claim and specificity, value proposition clarity, CTA quality, solutions page structure (use case / industry / persona / feature), case study consistency (logos, segment, outcomes with real numbers, job titles), about page POV, blog quality (thought leadership vs. calendar-fill, named experts, frequency), SEO footprint (organic keyword alignment, long-tail strategy, AEO tuning).
Scoring: 1=Generic messaging, unclear value prop | 3=Clear but undifferentiated positioning | 5=Sharp, differentiated, segment-specific narrative with strong proof

**Dimension 2 — Social Media & Outbound Content (10%)**
What to research: LinkedIn company page (post frequency, content mix, engagement relative to follower count, consistent POV), executive voice (are execs posting, does it reinforce or contradict company messaging), ad creative and offers, events and speaking (conferences, sponsorships, own webinars), other channels (YouTube, newsletters, podcasts).
Scoring: 1=Inactive or inconsistent presence | 3=Regular output but low differentiation | 5=Strong POV, high engagement, aligned executive voice

**Dimension 3 — Positioning & Segment Analysis (20%)**
What to research: Claimed vs. actual positioning (how they describe themselves vs. how customers describe them), segment clarity (enterprise/mid-market/SMB consistency), vertical depth vs. horizontal spread, buyer persona alignment in content, geography and regulatory considerations, pricing signals (transparent vs. sales-gated and what that implies).
Scoring: 1=Trying to appeal to everyone | 3=Defined ICP but weak enforcement | 5=Clear ownership of a segment with consistent execution

**Dimension 4 — Industry Vertical & Analyst Context (15%)**
What to research: Analyst-defined market category and label, market size / growth rate / CAGR from Tier 1 analysts (Gartner, IDC, Forrester, Everest Group, ISG, Omdia — public sources only, within 12 months), whether the category is consolidating / fragmenting / commoditizing / being reshaped by AI, analyst mention of the company (reinforcing or contradicting their positioning), industry awards in the last year.
Scoring: 1=No alignment with analyst-defined category | 3=Partial alignment, unclear category fit | 5=Strong alignment with category tailwinds and analyst validation

**Dimension 5 — Competitive Landscape (15%)**
What to research: Who they name as competitors (if anyone), who appears on G2/Capterra/Trustpilot alternatives pages, what customer reviews reference, adjacent-category players they may be underweighting, positioning overlap and genuine differentiation, who owns which segment, category maturity and commoditization risk.
Scoring: 1=No clear competitive awareness | 3=Aware but weak differentiation | 5=Clear competitive narrative and defensible positioning

**Dimension 6 — Growth Opportunity Signals (20%)**
What to research: Case studies that reveal untargeted use cases, industries or personas engaging with content that aren't explicitly targeted, competitor white space in adjacent segments, messaging gaps (problems no one is talking about), buyer search demand no player is owning, content and channel gaps, whether they could credibly claim a more specific segment.
Scoring: 1=No clear growth path | 3=Identified opportunities but not owned | 5=Clear, actionable expansion strategy with strong signals

SCORING & FINAL SCORE:
- Weighted total out of 5
- 4.5–5.0: Category Leader | 3.5–4.4: Strong Performer | 2.5–3.4: Developing / Inconsistent | 1.5–2.4: Weak Positioning | <1.5: At Risk / Undefined

SERVICE OPPORTUNITY MAPPING (low score → service recommendation):
- Dim 1 weak → GTM Messaging & Positioning Strategy, Website & Conversion Optimisation, Content Strategy & SEO Alignment
- Dim 2 weak → Content Strategy & Thought Leadership, Executive Positioning, Campaign & Demand Generation
- Dim 3 weak → ICP & Segmentation Design, Category & Positioning Strategy, Pricing & Packaging Strategy
- Dim 4 weak → Market & Category Analysis, Strategic GTM Advisory, Analyst Alignment & Narrative Calibration
- Dim 5 weak → Competitive Intelligence, Differentiation Strategy, Sales Enablement & Battlecards
- Dim 6 weak → Growth Opportunity Mapping, Demand Factory, Channel & Ecosystem Strategy

Engagement models: Strategy Sprint (4–6 weeks), GTM Build (8–12 weeks), Ongoing Demand Factory (continuous).

HOW TO RESPOND:
- When the user is researching a prospect: suggest specifically what to look for, what signals matter, what questions to ask
- When the user shares findings: interpret them sharply, suggest a score with clear justification tied to evidence
- When the user attaches a document: summarise the most relevant intelligence from it and connect it to specific dimensions
- When scoring is complete: calculate the weighted total, name the tier, identify the top 2–3 service opportunities
- Be direct and strategic — no generic advice, always specific to what the user has shared
- Keep responses concise: 3–6 lines of insight, then clear next step
- Never ask more than one question per message
- If the user asks what to do next: guide them to the next unscored dimension`

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function researchPilotRoutes(app: FastifyInstance) {

  // ── Upload: extract text from .docx or .pdf ─────────────────────────────────
  app.post('/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const { filename, file, mimetype } = data
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if (!['docx', 'pdf'].includes(ext)) {
      file.resume()
      return reply.code(400).send({ error: 'Only .docx and .pdf files are supported' })
    }

    // Buffer the file (cap at 20 MB)
    const chunks: Buffer[] = []
    let totalBytes = 0
    for await (const chunk of file) {
      totalBytes += (chunk as Buffer).length
      if (totalBytes > 20 * 1024 * 1024) {
        return reply.code(413).send({ error: 'File too large — maximum 20 MB' })
      }
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    let text: string
    try {
      if (ext === 'docx') {
        text = await extractDocx(buffer)
      } else {
        text = await extractPdf(buffer)
      }
    } catch (err) {
      return reply.code(422).send({
        error: `Could not extract text from ${ext.toUpperCase()} — the file may be scanned, encrypted, or corrupted`,
      })
    }

    if (!text.trim()) {
      return reply.code(422).send({ error: 'No readable text found in the file' })
    }

    const truncated = text.length > MAX_ATTACHMENT_CHARS
    const trimmed   = truncated ? text.slice(0, MAX_ATTACHMENT_CHARS) : text

    return reply.send({
      data: {
        filename,
        text:      trimmed,
        charCount: trimmed.length,
        truncated,
        pages:     ext === 'pdf' ? Math.ceil(buffer.length / 3000) : undefined, // rough estimate
      },
    })
  })

  // ── Chat ─────────────────────────────────────────────────────────────────────
  app.post('/chat', async (req, reply) => {
    const parsed = chatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', details: parsed.error.issues })
    }

    const { messages, prospectName, prospectUrl } = parsed.data

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return reply.code(503).send({ error: 'ANTHROPIC_API_KEY not configured' })

    const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })

    const contextHint = [
      prospectName ? `Prospect: ${prospectName}` : null,
      prospectUrl  ? `URL: ${prospectUrl}`        : null,
    ].filter(Boolean).join(' | ')

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, i) => ({
      role:    m.role,
      content: i === 0 && contextHint ? `[${contextHint}]\n\n${m.content}` : m.content,
    }))

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 2000,
      system:     SYSTEM_PROMPT,
      messages:   anthropicMessages,
    })

    const reply_text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    return reply.send({ data: { reply: reply_text } })
  })
}
