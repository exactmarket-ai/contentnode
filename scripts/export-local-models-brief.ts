/**
 * One-off script — exports the ContentNode local/hosted model inventory
 * as a structured DOCX to ~/Downloads.
 *
 * Usage: pnpm tsx scripts/export-local-models-brief.ts
 */

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  ShadingType, HeightRule, convertInchesToTwip,
} from 'docx'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── Colors ────────────────────────────────────────────────────────────────────
const PRI  = '1A1A2E'   // dark navy
const SEC  = '16213E'   // mid navy
const ACC  = '0F3460'   // accent blue
const LINK = '3358FF'
const BODY = '1A1A1A'
const MUTED = '6B7280'
const HEAD_FONT = 'Arial'
const BODY_FONT = 'Arial'

// ── Helpers ───────────────────────────────────────────────────────────────────
function heading1(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 480, after: 120 },
    children: [new TextRun({ text, bold: true, size: 36, font: HEAD_FONT, color: PRI })],
  })
}

function heading2(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 80 },
    children: [new TextRun({ text, bold: true, size: 26, font: HEAD_FONT, color: ACC })],
  })
}

function heading3(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    children: [new TextRun({ text, bold: true, size: 22, font: HEAD_FONT, color: SEC })],
  })
}

function body(text: string, opts: { bold?: boolean; italic?: boolean; color?: string; spaceAfter?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: opts.spaceAfter ?? 120 },
    children: [new TextRun({
      text,
      size: 20,
      font: BODY_FONT,
      bold: opts.bold,
      italics: opts.italic,
      color: opts.color ?? BODY,
    })],
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
    children: [new TextRun({ text: `• ${text}`, size: 20, font: BODY_FONT, color: BODY })],
  })
}

function hRule(): Paragraph {
  return new Paragraph({
    spacing: { before: 160, after: 0 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB', space: 1 } },
    children: [],
  })
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: 80 }, children: [] })
}

function labelRow(label: string, value: string): TableRow {
  return new TableRow({
    height: { value: convertInchesToTwip(0.32), rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        width: { size: 22, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, fill: 'F3F4F6' },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
        },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: HEAD_FONT, color: SEC })] })],
      }),
      new TableCell({
        width: { size: 78, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
        },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, font: BODY_FONT, color: BODY })] })],
      }),
    ],
  })
}

function twoColTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([l, v]) => labelRow(l, v)),
  })
}

function gridTable(headers: string[], rows: string[][]): Table {
  const colCount = headers.length
  const colPct = Math.floor(100 / colCount)
  const makeCell = (text: string, isHeader: boolean): TableCell =>
    new TableCell({
      width: { size: colPct, type: WidthType.PERCENTAGE },
      shading: isHeader ? { type: ShadingType.SOLID, fill: PRI } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 1, color: isHeader ? PRI : 'E5E7EB' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: isHeader ? PRI : 'E5E7EB' },
        left:   { style: BorderStyle.SINGLE, size: 1, color: isHeader ? PRI : 'E5E7EB' },
        right:  { style: BorderStyle.SINGLE, size: 1, color: isHeader ? PRI : 'E5E7EB' },
      },
      children: [new Paragraph({ children: [
        new TextRun({ text, bold: isHeader, size: 18, font: isHeader ? HEAD_FONT : BODY_FONT, color: isHeader ? 'FFFFFF' : BODY }),
      ]})],
    })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map(h => makeCell(h, true)) }),
      ...rows.map(row => new TableRow({ children: row.map(c => makeCell(c, false)) })),
    ],
  })
}

// ── Document ──────────────────────────────────────────────────────────────────
const children = [

  // ── Cover ──
  new Paragraph({
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text: 'ContentNode — Local & Hosted Model Inventory', bold: true, size: 52, font: HEAD_FONT, color: PRI })],
  }),
  body('Infrastructure assessment: training posture, model sizes, goals, and context requirements.', { italic: true, color: MUTED }),
  body(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, { color: MUTED }),
  hRule(),

  // ── Section 1: Models ──
  heading1('1. Models — Training Approach'),
  body(
    'ContentNode is a pure inference platform. We do not train models from scratch and do not fine-tune any of the models listed below. ' +
    'All capabilities are delivered by calling pre-trained model endpoints — either cloud APIs or self-hosted inference servers running locally.'
  ),
  body('The three categories are:'),
  bullet('Cloud APIs — Anthropic, OpenAI, ElevenLabs, Runway, Kling, Luma, Ideogram. We send requests and receive completions/generations.'),
  bullet('Self-hosted inference (local GPU machine) — Ollama, ComfyUI, CogVideoX, Wan2.1, SadTalker, Kokoro TTS, faster-whisper, music server. These run on hardware we control; no training pipeline involved.'),
  bullet('Third-party humanizers — Undetectable.ai, BypassGPT. These are API services; we pass text and receive rewritten output.'),
  spacer(),

  heading2('1.1 LLM / Text'),
  gridTable(
    ['Model', 'Provider', 'Status', 'Env var'],
    [
      ['claude-sonnet-4-6', 'Anthropic', 'Running (primary)', 'ANTHROPIC_API_KEY'],
      ['claude-haiku-4-5', 'Anthropic', 'Running (fast tasks)', 'ANTHROPIC_API_KEY'],
      ['gpt-4o / gpt-4.1 / o3', 'OpenAI', 'Running', 'OPENAI_API_KEY'],
      ['Any Ollama model', 'Local (self-hosted)', 'Wired — unverified prod', 'OLLAMA_BASE_URL'],
    ]
  ),
  spacer(),

  heading2('1.2 Transcription'),
  gridTable(
    ['Model', 'Provider', 'Status', 'Env var'],
    [
      ['gpt-4o-transcribe', 'OpenAI API', 'Running (primary)', 'OPENAI_API_KEY'],
      ['whisper-1', 'OpenAI API', 'Running (fallback)', 'OPENAI_API_KEY'],
      ['faster-whisper (large-v3)', 'Local GPU', 'Planned — not yet wired', 'WHISPER_LOCAL_URL (reserved)'],
    ]
  ),
  spacer(),

  heading2('1.3 Voice / TTS'),
  gridTable(
    ['Model', 'Provider', 'Status', 'Env var'],
    [
      ['Kokoro', 'Local GPU', 'Wired', 'TTS_BASE_URL (default localhost:8880)'],
      ['ElevenLabs', 'Cloud API', 'Running', 'ELEVENLABS_API_KEY'],
    ]
  ),
  spacer(),

  heading2('1.4 Image Generation'),
  gridTable(
    ['Model', 'Provider', 'Status', 'Env var'],
    [
      ['DALL-E 3', 'OpenAI API', 'Running', 'OPENAI_API_KEY'],
      ['gpt-image-2', 'OpenAI API', 'Running (limited access pending)', 'OPENAI_API_KEY'],
      ['Ideogram v3', 'Cloud API', 'Broken in prod — under investigation', 'IDEOGRAM_API_KEY'],
      ['ComfyUI', 'Local GPU', 'Wired', 'COMFYUI_BASE_URL (default localhost:8188)'],
      ['AUTOMATIC1111 (SD)', 'Local GPU', 'Wired', 'A1111_BASE_URL (default localhost:7860)'],
    ]
  ),
  spacer(),

  heading2('1.5 Video Generation'),
  gridTable(
    ['Model', 'Provider', 'Status', 'Env var'],
    [
      ['Runway Gen-4', 'Cloud API', 'Running', 'RUNWAY_API_KEY'],
      ['Kling', 'Cloud API', 'Running', 'KLING_API_KEY'],
      ['Luma Dream Machine', 'Cloud API', 'Running', 'LUMA_API_KEY'],
      ['ComfyUI (video workflows)', 'Local GPU', 'Wired', 'COMFYUI_BASE_URL'],
      ['CogVideoX', 'Local GPU', 'Wired', 'COGVIDEOX_BASE_URL (default localhost:7870)'],
      ['Wan2.1', 'Local GPU', 'Wired', 'WAN_BASE_URL (default localhost:7880)'],
    ]
  ),
  spacer(),

  heading2('1.6 Character Animation & Music'),
  gridTable(
    ['Model', 'Provider', 'Status', 'Env var'],
    [
      ['SadTalker', 'Local GPU', 'Wired', 'sadtalker_base_url (default localhost:7860)'],
      ['Music server (local)', 'Local GPU', 'Wired', 'MUSIC_BASE_URL (default localhost:8881)'],
      ['Cloud music providers', 'Cloud APIs', 'Running', 'Per-provider keys'],
    ]
  ),
  spacer(),

  heading2('1.7 Video Processing'),
  gridTable(
    ['Tool', 'Type', 'Status', 'Notes'],
    [
      ['ffmpeg', 'Local binary', 'Running', 'Composition, trim, audio replace, audiogram, resize'],
      ['Shotstack', 'Cloud API', 'Running', 'Cloud fallback for composition'],
      ['Local render path', 'Local ffmpeg', 'Shipped — unverified in prod', 'Needs manual prod verification'],
    ]
  ),
  spacer(),

  hRule(),

  // ── Section 2: Size ──
  heading1('2. Size — Expected Model Parameters'),
  body('We do not control parameter counts for cloud models — providers do not publish them. For local models we select based on what fits the GPU machine.'),
  spacer(),

  heading2('2.1 LLMs'),
  twoColTable([
    ['Claude Sonnet 4.6', '~70B (Anthropic does not publish exact count)'],
    ['Claude Haiku 4.5', '~7B (estimated — not published)'],
    ['GPT-4o / GPT-4.1', 'Unknown — OpenAI does not publish'],
    ['o3', 'Unknown — OpenAI does not publish'],
    ['Ollama (local)', 'User-configurable: 7B, 13B, 34B, or 70B depending on GPU VRAM'],
  ]),
  spacer(),

  heading2('2.2 Transcription'),
  twoColTable([
    ['whisper-1 (cloud)', '~1.5B (Whisper large equivalent)'],
    ['gpt-4o-transcribe', 'Unknown — based on GPT-4o architecture'],
    ['faster-whisper large-v3 (planned local)', '~1.5B'],
    ['faster-whisper medium (lighter option)', '~769M'],
  ]),
  spacer(),

  heading2('2.3 TTS'),
  twoColTable([
    ['Kokoro (local)', '~82M params — very lightweight, designed for CPU/edge inference'],
    ['ElevenLabs (cloud)', 'Proprietary — not published'],
  ]),
  spacer(),

  heading2('2.4 Image Models'),
  twoColTable([
    ['DALL-E 3 (cloud)', 'Proprietary — not published'],
    ['Ideogram v3 (cloud)', 'Proprietary — not published'],
    ['Stable Diffusion 1.5 (A1111/ComfyUI)', '~860M'],
    ['SDXL (A1111/ComfyUI)', '~3.5B'],
    ['Flux.1 (ComfyUI)', '~12B — state-of-the-art open image model'],
  ]),
  spacer(),

  heading2('2.5 Video Models'),
  twoColTable([
    ['Runway / Kling / Luma (cloud)', 'Proprietary — not published'],
    ['CogVideoX (local)', '~5B'],
    ['Wan2.1 (local)', '~14B'],
    ['SadTalker (local)', '~90M (face generation component)'],
  ]),
  spacer(),

  hRule(),

  // ── Section 3: Goals ──
  heading1('3. Goals — System Purpose and Use Cases'),
  body(
    'ContentNode is a production multi-tenant SaaS platform, not an experimentation environment. ' +
    'The system is built for marketing agencies running AI-assisted content workflows on behalf of their clients. ' +
    'Models are selected for production reliability and output quality — not for research or capability exploration.'
  ),
  spacer(),

  heading2('3.1 Primary Use Cases'),
  bullet('Content generation — brand-aware blog posts, email sequences, ad copy, landing pages, LinkedIn posts, video scripts, internal briefs, sales decks.'),
  bullet('AI humanization — rewriting AI-generated text to pass detection thresholds (GPTZero, Originality.ai, Copyleaks). Automated detect→rewrite loop with retry logic.'),
  bullet('Demand generation research — deep web scraping, review mining (Trustpilot/G2/Capterra), SEO intent mapping, Reddit audience signal extraction, competitive intelligence.'),
  bullet('GTM Framework generation — structured 18-section go-to-market documents with brand positioning, ICP, competitive landscape, SEO clusters, and BDR email sequences. Exported as DOCX and PPTX.'),
  bullet('Transcription — meeting and interview audio to structured text, with speaker diarization (planned). Feeds brand voice profiles and client brain.'),
  bullet('Voice generation — AI voiceover for video assets using Kokoro (local) or ElevenLabs (cloud).'),
  bullet('Image & video production — storyboard-to-video pipeline: scene parsing → image prompt building → frame generation (ComfyUI/cloud) → video composition (ffmpeg/Shotstack). Character animation via SadTalker.'),
  bullet('Pattern intelligence — detects repeating feedback signals across client stakeholder reviews; surfaces insights that auto-adjust humanizer config and brand voice over time.'),
  spacer(),

  heading2('3.2 What We Are Not Doing'),
  bullet('No training from scratch — we are not building foundation models.'),
  bullet('No supervised fine-tuning or LoRA/QLoRA adapters on any current model.'),
  bullet('No model evaluation research or benchmark comparisons.'),
  bullet('No prompt injection / red-team research.'),
  body('The local GPU machine\'s role is to run inference for latency-sensitive or cost-sensitive tasks (video generation, image generation, TTS, transcription) without sending data to third-party APIs — important for client data privacy and HIPAA-adjacent workflows.', { color: MUTED }),
  spacer(),

  hRule(),

  // ── Section 4: Context ──
  heading1('4. Context — Token Retention Requirements'),
  body('ContentNode workloads span a wide range of context sizes. The system does not require 1M-token contexts today, but several workflows routinely push into the 50k–100k range.'),
  spacer(),

  heading2('4.1 Primary Model Context Windows'),
  twoColTable([
    ['Claude Sonnet 4.6 (primary LLM)', '200k tokens — the effective ceiling for most workflows'],
    ['Claude Haiku 4.5 (fast tasks)', '200k tokens (matches Sonnet family)'],
    ['GPT-4o (secondary LLM)', '128k tokens'],
    ['GPT-4.1', '1M tokens — not currently used for long-context work'],
    ['Ollama (local, user-configured)', 'Model-dependent: 4k–128k typical'],
  ]),
  spacer(),

  heading2('4.2 Observed Context Usage by Workload'),
  gridTable(
    ['Workload', 'Typical Input Tokens', 'Why'],
    [
      ['Brand brief + persona prompting', '2k–8k', 'Client brain context injected into every generation call'],
      ['GTM Framework generation (18 sections)', '20k–60k', 'Full brand context + prior sections used as grounding'],
      ['Deep web scrape synthesis', '30k–80k', 'Raw scraped HTML from 20 pages fed into synthesis call'],
      ['Pattern intelligence / insight detection', '10k–40k', 'Last N feedback records + brand profile'],
      ['Campaign brief generation', '15k–50k', 'All client context + prior run outputs bundled'],
      ['Prompt suggestion from client brain', '5k–15k', 'Brand profiles + attachments + frameworks'],
      ['Humanizer (per chunk)', '1k–3k', 'Single 400-word chunk at a time (chunked pipeline)'],
    ]
  ),
  spacer(),

  heading2('4.3 Known Preferences and Constraints'),
  bullet('200k (Claude Sonnet) is the practical ceiling we plan around. Workflows are designed not to exceed this.'),
  bullet('Long contexts (50k+) are used for research synthesis and GTM generation — never for real-time user interactions.'),
  bullet('The humanizer pipeline deliberately chunks content into 400-word segments to stay within reliable inference windows and avoid degraded output quality at the end of long completions.'),
  bullet('No requirement identified yet for 1M-token contexts. If client brain data grows large enough (many attachments + signals), we may need to summarise or vector-search rather than pass in full.'),
  bullet('Ollama context window is user-configured per workflow node — default models typically set 4k–8k unless overridden in the Modelfile.'),
  spacer(),

  hRule(),
  spacer(),
  body('End of document. For questions contact the ContentNode engineering team.', { italic: true, color: MUTED }),
]

// ── Build and write ───────────────────────────────────────────────────────────
async function main() {
  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  })

  const buf = await Packer.toBuffer(doc)
  const outPath = path.join(os.homedir(), 'Downloads', 'contentnode-local-model-inventory.docx')
  fs.writeFileSync(outPath, buf)
  console.log(`✓ Saved: ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
