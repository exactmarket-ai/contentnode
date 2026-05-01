/**
 * Generates the ContentNode GTM Framework as a DOCX and saves it to ~/Downloads.
 * Run: pnpm tsx scripts/generate-contentnode-gtm.ts
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, TableBorders, Header, Footer, PageNumber,
} from 'docx'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIMARY   = '1B1F3B'
const SECONDARY = '4A90D9'

const none    = { style: BorderStyle.NONE,   size: 0, color: 'auto' } as const
const divider = { style: BorderStyle.SINGLE, size: 1, color: 'e2e8f0' } as const

function styledTable(headers: string[], rows: string[][], widths?: number[]): Table {
  const pcts = widths ?? headers.map(() => Math.floor(100 / headers.length))
  const cellMargins = { top: 100, bottom: 100, left: 120, right: 120 }
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        width: { size: pcts[i], type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: PRIMARY, fill: PRIMARY },
        borders: { top: none, bottom: none, left: none, right: none },
        margins: cellMargins,
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, size: 19, color: 'FFFFFF' })],
          spacing: { before: 0, after: 0 },
        })],
      })
    ),
  })
  const dataRows = rows.map((cells, ri) =>
    new TableRow({
      children: cells.map((cell, i) =>
        new TableCell({
          width: { size: pcts[i] ?? pcts[pcts.length - 1], type: WidthType.PERCENTAGE },
          shading: ri % 2 === 1
            ? { type: ShadingType.SOLID, color: 'f8fafc', fill: 'f8fafc' }
            : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
          borders: { top: none, bottom: divider, left: none, right: none },
          margins: cellMargins,
          children: [new Paragraph({
            children: [new TextRun({ text: cell ?? '', size: 19, color: '1e293b' })],
            spacing: { before: 0, after: 0, line: 276 },
          })],
        })
      ),
    })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
    borders: new TableBorders({ top: none, bottom: none, left: none, right: none, insideH: divider, insideV: none } as any) as any,
  })
}

function sh(num: string, title: string, usedIn: string, addPageBreak: boolean): (Paragraph | Table)[] {
  const items: (Paragraph | Table)[] = []
  if (addPageBreak) items.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 } }))
  items.push(new Paragraph({
    children: [new TextRun({ text: `${num}  ${title}`, bold: true, size: 28, color: PRIMARY })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: usedIn ? 60 : 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'e2e8f0' } },
  }))
  if (usedIn) {
    items.push(new Paragraph({
      children: [new TextRun({ text: `Used in: ${usedIn}`, italics: true, size: 17, color: 'a0aec0' })],
      spacing: { after: 140 },
    }))
  }
  return items
}

function area(label: string, value: string): Paragraph[] {
  if (!value?.trim()) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, color: '374151' })], spacing: { after: 48 } }),
    new Paragraph({ children: [new TextRun({ text: value.trim(), size: 20, color: '1e293b' })], spacing: { after: 140, line: 276 } }),
  ]
}

function field(label: string, value: string): Paragraph[] {
  if (!value?.trim()) return []
  return [new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20, color: '374151' }),
      new TextRun({ text: value.trim(), size: 20, color: '1e293b' }),
    ],
    spacing: { after: 100, line: 276 },
  })]
}

function subh(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: '1e293b' })],
    spacing: { before: 180, after: 72 },
  })
}

function sp(): Paragraph { return new Paragraph({ spacing: { after: 140 } }) }

function bullets(label: string, items: string[]): Paragraph[] {
  const filled = items.filter(Boolean)
  if (!filled.length) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
    ...filled.map((item) => new Paragraph({
      children: [new TextRun({ text: item, size: 20 })],
      bullet: { level: 0 },
      spacing: { after: 40 },
    })),
    sp(),
  ]
}

// ── Build document ────────────────────────────────────────────────────────────

const CLIENT   = 'ContentNode'
const VERTICAL = 'AI-Native Demand Generation Agencies'
const dateStr  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

const children: (Paragraph | Table)[] = []

// ── Cover page ───────────────────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing: { after: 400 } }),
  new Paragraph({
    children: [new TextRun({ text: 'GTM FRAMEWORK', bold: true, size: 72, color: PRIMARY })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }),
  new Paragraph({
    children: [new TextRun({ text: CLIENT, bold: true, size: 36, color: '111111' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
  }),
  new Paragraph({
    children: [new TextRun({ text: `Confidential: For Internal ${CLIENT} Use Only`, size: 18, color: '94a3b8', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: VERTICAL, size: 28, color: '94a3b8' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }),
  new Paragraph({
    children: [new TextRun({ text: dateStr, size: 20, color: '94a3b8' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
  }),
  new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: PRIMARY } }, spacing: { after: 0 } }),
)

// ── §01 Vertical Overview ────────────────────────────────────────────────────
children.push(...sh('01', 'Vertical Overview', '', true))
children.push(...area('Positioning Statement',
  `ContentNode is the background AI intelligence engine for demand-generation agencies — the system that learns your clients, runs your content workflows, and delivers brand-accurate output at scale. It sits behind Monday.com and Box, invisible to clients, running the intelligence and production layer that turns what agencies know into content that sounds like it was written by someone who actually knows the client.`
))
children.push(...area('Tagline Options',
  `1. "Your content team, systematized."\n2. "AI that already knows your clients."\n3. "The intelligence layer behind your agency."\n4. "Content workflows that get smarter over time."`
))
children.push(...area('How to Use This Document',
  `This GTM Framework defines the positioning, messaging, buyer profiles, and campaign architecture for ContentNode. Use it as the brief for every demand gen asset — campaigns, email sequences, LinkedIn content, web pages, and outreach. Every section has a "Used in" note indicating which asset types it feeds.`
))
children.push(...area(`What ${CLIENT} Is NOT`,
  `ContentNode is not a writing tool. It is not a chatbot, a blank page with AI, or a prompt library. It is not a project management app. It is not a CMS or publishing platform. It is not a replacement for creative strategy. It is the system that takes what agencies already know and automates the production of content grounded in that knowledge.`
))

// ── §02 Customer Definition + Profile ───────────────────────────────────────
children.push(...sh('02', 'Customer Definition + Profile', '', true))
children.push(...field('Industry', 'Marketing services, demand-generation agencies, content agencies, in-house demand gen teams'))
children.push(...field('Company Size', '5–50 person agencies; in-house teams of 3–10'))
children.push(...field('Geography', 'North America (primary), UK, Australia'))
children.push(...field('IT Posture', 'SaaS-first, cloud-native, comfortable with API integrations and webhook-based workflows'))
children.push(...field('Compliance Status', 'Low regulatory burden; SOC 2 awareness growing among mid-market buyers'))
children.push(...field('Contract Profile', 'Month-to-month SaaS entry, annual plans preferred for committed clients'))

children.push(new Paragraph({ children: [new TextRun({ text: 'Buyer Table', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(styledTable(
  ['Segment', 'Primary Buyer', 'Core Pain', 'Entry Point'],
  [
    ['Scaling Agency (5–20 people)', 'Founder / CEO', 'Hit the ceiling on output; AI tools used ad hoc; every client feels like a new project', 'LinkedIn / podcast'],
    ['Enterprise Agency (20–50 people)', 'Head of Content / VP / COO', 'Inconsistent quality across account teams; institutional knowledge loss; client churn', 'Referral / conference'],
    ['In-House Demand Gen Team', 'VP Marketing / Demand Gen Manager', 'Headcount constraints; board pressure on pipeline; need agency-level volume internally', 'Outreach / paid social'],
    ['Solo Consultant (3+ clients)', 'Owner', 'Context-switching overhead; no system to store what works per client', 'LinkedIn / community'],
  ],
  [22, 22, 34, 22],
))
children.push(sp())
children.push(...area('Secondary Targets',
  `SaaS companies building internal content teams that need agency-level output without agency headcount. Fractional CMOs managing content for multiple clients simultaneously.`
))

// ── §03 Market Pressures + Stats ─────────────────────────────────────────────
children.push(...sh('03', 'Market Pressures + Statistics', 'Brochure · eBook · Deck · Web Page · BDR Email 1', true))
children.push(...area('Market Pressure Narrative',
  `Agencies face a structural squeeze on three fronts simultaneously. First, client demand for content volume is rising faster than headcount can scale — clients expect weekly LinkedIn posts, monthly long-form, ongoing email sequences, and quarterly campaigns. Second, AI tools are commoditizing basic writing, which means the agencies that survive aren't the ones writing faster — they're the ones who have figured out how to systematize the intelligence layer: what they know about each client's market, brand, and buyers. Third, AI detection is becoming a client concern. Enterprise clients run AI checkers. Content that reads like a generic AI prompt gets flagged, rejected, or damages the agency relationship.\n\nThe agencies that win in this environment are the ones that solve the intelligence problem — building systems where what they learn about each client compounds over time, and where that knowledge feeds every piece of content automatically, without manual briefing.`
))

children.push(new Paragraph({ children: [new TextRun({ text: 'Stats', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(styledTable(
  ['Stat', 'Context', 'Source', 'Year'],
  [
    ['73% of B2B buyers expect personalized content experiences', 'Demand for volume creates simultaneous pressure for quality', 'Forrester', '2024'],
    ['Average agency writer spends 40% of time on research and reformatting', 'Time is the margin killer — production overhead, not creative work', 'Hinge Research', '2023'],
    ['AI writing adoption is at 67% in marketing, but 82% say output still needs heavy editing', 'AI tools accelerate production but don\'t solve the intelligence gap', 'Content Marketing Institute', '2024'],
    ['Content production costs have risen 28% while billable rates have stayed flat', 'Margin compression is the defining agency challenge of this decade', 'Agency Management Institute', '2023'],
    ['Senior strategist replacement cost: 6–9 months of salary in lost productivity', 'Institutional knowledge loss is a direct revenue risk', 'SHRM', '2023'],
  ],
  [38, 34, 18, 10],
))
children.push(sp())
children.push(...area('Additional Context',
  `The AI adoption wave has split agencies into two camps. The first uses AI as a word processor — faster typing, same briefing overhead, same inconsistency problems. The second is building AI into their intelligence infrastructure — learning what works per client, per buyer, per channel, and encoding that into repeatable workflows. ContentNode is the platform built for the second camp. The gap between these two camps is widening. Agencies that haven't built the intelligence layer by end of 2025 will find themselves competing on price rather than quality.`
))

// ── §04 Core Challenges ──────────────────────────────────────────────────────
children.push(...sh('04', 'Core Challenges', 'Brochure · eBook · Deck · Web Page · BDR Emails', true))

children.push(subh('Challenge 1: Brand Voice Inconsistency Across Clients'))
children.push(...area('Why It Exists', `Writers context-switch between 10+ clients. AI tools have no memory of what's been approved, what's been rejected, or what makes each client's voice distinct. Every generation requires re-briefing the model from scratch.`))
children.push(...area('Consequence', `Clients receive content that sounds generic — technically correct but not theirs. Revision cycles increase. Senior strategists spend time on QA instead of strategy. Client satisfaction and retention erode.`))
children.push(...area(`${CLIENT} Solution`, `The Client Brain stores every approved piece, preference signal, Box edit, and stakeholder feedback for each client. Every generation is grounded in that client's specific voice, tone, and historical preferences — automatically, without re-briefing.`))

children.push(subh('Challenge 2: Manual Handoff Between Research and Production'))
children.push(...area('Why It Exists', `Strategy lives in Google Docs, briefs in emails, research in Notion, assets in Box. The connection between intelligence and output is a human copy-paste operation — lossy and time-consuming.`))
children.push(...area('Consequence', `Strategy never fully reaches the asset. Junior writers drop nuance. Senior time gets consumed by QA and corrections. The research investment doesn't translate into content quality.`))
children.push(...area(`${CLIENT} Solution`, `ContentNode workflows connect research nodes directly to generation nodes. The GTM Framework, brand profiles, and live market research feed every campaign automatically. No brief required — the system already has the context.`))

children.push(subh('Challenge 3: AI Detection and Platform Risk'))
children.push(...area('Why It Exists', `Content published from standard AI tools gets flagged by enterprise clients running AI checkers, penalized by LinkedIn's algorithm, and rejected by SEO platforms detecting synthetic content.`))
children.push(...area('Consequence', `Agencies lose client trust when AI content is identified. Some clients restrict or ban AI use. The agency's perceived value drops if content quality is questioned.`))
children.push(...area(`${CLIENT} Solution`, `ContentNode's detection-humanization loop runs content through configurable AI detectors (GPTZero, Originality.ai, Copyleaks) and rewrites only the flagged sentences — targeted rewriting, not full regeneration. Content clears detection thresholds before delivery.`))

children.push(subh('Challenge 4: No Institutional Memory'))
children.push(...area('Why It Exists', `When a senior strategist changes accounts or leaves, all the accumulated context about each client — what works, what's been tried, what the buyer responds to — leaves with them. There's no system of record for client intelligence.`))
children.push(...area('Consequence', `New team members start from zero. Clients feel like they're being re-briefed constantly. The agency's compound advantage from client tenure never materializes.`))
children.push(...area(`${CLIENT} Solution`, `ContentNode is the institutional memory. Every preference signal, approved asset, feedback record, and Box edit is stored and surfaced automatically. Client intelligence survives team changes and compounds over time.`))

// ── §05 Solutions + Service Stack ────────────────────────────────────────────
children.push(...sh('05', 'Solutions + Service Stack', 'Brochure · eBook · Cheat Sheet · Deck · Web Page · Video Script', true))

children.push(subh('Pillar 1: Client Intelligence'))
children.push(...area('Value Proposition', `Every client gets a dedicated intelligence layer that learns from content performance, stakeholder feedback, document edits, and GTM data. Over time, ContentNode knows more about what works for each client than any individual writer does.`))
children.push(...area('Key Services', `Client Brain (preference profiles, approved content, brand signals), GTM Framework (18-section strategic intake), Stakeholder Preference Profiles (per-person taste signals), Box Edit Signal Processing (learns from real client edits), Pattern Intelligence (Insights from aggregated feedback)`))
children.push(...field('Relevant To', 'Agency owners, senior strategists, account managers'))

children.push(subh('Pillar 2: Workflow Automation'))
children.push(...area('Value Proposition', `Build reusable content workflows that connect research, generation, humanization, quality checking, and delivery into a single automated pipeline. Run once, run reliably, at scale across all clients.`))
children.push(...area('Key Services', `Workflow Canvas (node-based editor), AI Generate (Claude + OpenAI + Ollama), Humanizer (8 style modes + detection loop), Detection Node (configurable AI checker integration), Campaign Layer (multi-workflow parallel execution), BullMQ execution engine (async, reliable background processing)`))
children.push(...field('Relevant To', 'Head of Content, operations leads, production teams'))

children.push(subh('Pillar 3: Demand Gen Intelligence'))
children.push(...area('Value Proposition', `Research nodes pull live market signals — competitor reviews, Reddit discussions, SEO intent data, audience language — directly into content workflows. Strategy is grounded in current market reality, not stale briefs.`))
children.push(...area('Key Services', `Deep Web Scrape (BFS crawler with synthesis), Review Miner (Trustpilot, G2, Capterra), SEO Intent Tool (keyword expansion + funnel mapping), Audience Signal Scraper (Reddit public API + comment depth)`))
children.push(...field('Relevant To', 'Strategists, demand gen leads, research-first agencies'))

children.push(subh('Pillar 4: Platform Integration + Delivery'))
children.push(...area('Value Proposition', `ContentNode runs invisibly behind existing Monday.com and Box workflows. Clients never interact with it. PM processes don't change. The AI operates in the background, delivering finished assets into the existing delivery structure.`))
children.push(...area('Key Services', `Monday.com OAuth + Webhook Integration (status-triggered workflows, subitem routing), Box File Delivery (DOCX to client folders, filename conventions), Monday URL Writeback (asset links back to board items), Assignee Portal (magic link access for Monday assignees)`))
children.push(...field('Relevant To', 'Agency owners, project managers, operations'))

children.push(new Paragraph({ children: [new TextRun({ text: 'Service Stack', bold: true, size: 20 })], spacing: { before: 120, after: 60 } }))
children.push(styledTable(
  ['Service / Feature', 'What It Delivers', 'Priority'],
  [
    ['Workflow Canvas', 'Drag-and-drop node editor for building and running content pipelines', 'Core'],
    ['Client Brain', 'Per-client intelligence store: preference profiles, brand signals, approved content, GTM data', 'Core'],
    ['AI Generate Node', 'Multi-provider AI generation (Claude, GPT-4o, Ollama) with per-node model override', 'Core'],
    ['Humanizer Node', '8 style presets + 8 sliders; detection-aware targeted rewriting', 'Core'],
    ['Detection Node', 'GPTZero / Originality.ai / Copyleaks integration with threshold configuration', 'Core'],
    ['GTM Framework', '18-section strategic intake with AI drafting, DOCX export, and PILOT chat', 'Core'],
    ['Monday.com Integration', 'OAuth, webhooks, subitem routing, status writeback, URL writeback', 'Core'],
    ['Box Integration', 'DOCX delivery, folder creation, file tracking, edit signal feedback loop', 'Core'],
    ['Campaign Layer', 'Groups workflows under shared goal/timeline; parallel execution; brief generation', 'Advanced'],
    ['Research Nodes', 'Deep Web Scrape, Review Miner, SEO Intent, Audience Signal Scraper', 'Advanced'],
    ['productPILOT', 'Guided AI-facilitated strategic intake PILOT for new client verticals', 'Advanced'],
    ['Programs Layer', 'Standing content programs with content packs and research linking', 'Advanced'],
  ],
  [30, 55, 15],
))
children.push(sp())

// ── §06 Why ContentNode ──────────────────────────────────────────────────────
children.push(...sh('06', `Why ${CLIENT}`, 'Brochure · Cheat Sheet · Deck · Web Page · BDR Emails', true))

children.push(subh('1. Built for Multi-Client Agencies, Not Solo Creators'))
children.push(...area('Position', `ContentNode is the only AI content platform architected from the ground up for agencies managing multiple clients simultaneously. Hard data isolation between clients is enforced at the database layer — not just in the UI. Client intelligence is per-client, persistent, and compounds over time. Every tool not built for this use case requires workarounds that don't scale.`))

children.push(subh('2. The Intelligence Layer, Not Another Writing Tool'))
children.push(...area('Position', `Jasper, Copy.ai, and ChatGPT give agencies a blank page with AI. ContentNode gives agencies a system that already knows their clients — their GTM framework, brand voice, historical feedback, stakeholder preferences, and market position. The difference is the difference between starting from scratch every time and running from a compounding knowledge base.`))

children.push(subh('3. Workflows, Not Prompts'))
children.push(...area('Position', `Other tools require a skilled prompt engineer to reliably get quality output. ContentNode encodes that expertise into reusable workflows that any team member can run. The strategic intelligence is in the system, not in one person's head.`))

children.push(subh('4. Invisible to Clients — No Disruption to Existing Workflows'))
children.push(...area('Position', `ContentNode sits behind Monday.com and Box. Clients never interact with it. Their PM experience doesn't change. Assets arrive in Box the same way they always did. This is the architecture that allows AI adoption without client permission or awareness.`))

children.push(subh('5. Compounding Intelligence'))
children.push(...area('Position', `Every approved asset, every stakeholder edit, every Box revision, every feedback signal makes ContentNode more accurate for that client. The platform learns what works — and that intelligence belongs to the agency, not shared with any other organization. The longer it runs, the wider the quality gap versus teams starting from scratch.`))

// ── §07 Segments + Buyer Profiles ────────────────────────────────────────────
children.push(...sh('07', 'Segments + Buyer Profiles', 'Cheat Sheet · BDR Emails · Deck speaker notes', true))

children.push(subh('Segment 1: The Scaling Agency (5–20 people)'))
children.push(...field('Primary Buyer Titles', 'Founder, CEO, Head of Content, Senior Strategist'))
children.push(...area('What Is Different', `This agency has hit the ceiling on what their current team can produce. They're using AI tools ad hoc — different people using different prompts, no shared system, inconsistent results. Every client engagement feels like building from zero. They know they need a system but haven't found one that fits an agency model.`))
children.push(...area('Key Pressures', `Margins shrinking as content volume demands increase. Talent hard to hire and retain. Clients demanding more content without budget increases. Senior time consumed by QA and fixing AI output rather than strategy.`))
children.push(...field('Lead Hook', `"What if your existing team could handle 3x the client load without adding headcount?"`))

children.push(subh('Segment 2: The Enterprise Agency (20–50 people)'))
children.push(...field('Primary Buyer Titles', 'VP Content, Director of Demand Gen, Head of Operations, COO'))
children.push(...area('What Is Different', `They have process problems, not talent problems. Multiple account teams with inconsistent quality standards. Institutional knowledge living in individual heads. Senior strategists spending time on QA that should be systematized. They need infrastructure, not tools.`))
children.push(...area('Key Pressures', `Inconsistent quality across account teams creating client satisfaction variance. Client churn from content that misses brand voice. Institutional knowledge loss when team members change. Board-level pressure on margin improvement.`))
children.push(...field('Lead Hook', `"One system of record for everything your agency knows about your clients."`))

children.push(subh('Segment 3: In-House Demand Gen Team'))
children.push(...field('Primary Buyer Titles', 'VP Marketing, Demand Gen Manager, Content Marketing Manager, CMO'))
children.push(...area('What Is Different', `A 3–8 person in-house team expected to produce agency-level volume with internal resources. No dedicated AI strategy. Using ChatGPT individually but no shared workflows or intelligence. Every campaign brief starts from scratch.`))
children.push(...area('Key Pressures', `Headcount constraints with growing pipeline targets. Pressure to justify content ROI to board. Inconsistent brand voice across team members. Difficulty scaling programs without proportional headcount.`))
children.push(...field('Lead Hook', `"Agency-level content output without agency overhead."`))

// ── §08 Messaging Framework ──────────────────────────────────────────────────
children.push(...sh('08', 'Messaging Framework', 'All 8 assets', true))
children.push(...area('Problems',
  `Agencies and in-house demand gen teams are stuck in a gap between AI's promise and its reality. Generic tools produce generic output. Every generation requires re-briefing the model on who the client is, what they care about, and what's been approved. The content reads like AI. Clients notice. Detection tools flag it. Revision cycles eat the time savings. And when a strategist changes accounts or leaves, the institutional knowledge — everything learned about what makes each client unique — disappears with them. The fundamental problem isn't access to AI. It's that most AI tools have no memory, no structure, and no understanding of multi-client agency work.`
))
children.push(...area('Solution',
  `ContentNode is the background AI intelligence engine that already knows your clients. It stores every piece of intelligence built about each client's market, brand, buyers, and preferences. It runs content workflows that go from live market research to finished, humanized, detection-cleared deliverable — without manual handoffs. And it integrates behind Monday.com and Box so clients never see it and your PM process never changes.`
))
children.push(...area('Outcomes',
  `Agencies using ContentNode produce significantly more content per strategist without adding headcount. Content passes AI detection checks as part of the production workflow, not as an afterthought. Client brand voice is consistent across every asset because the system stores what consistency looks like for each client. Institutional knowledge survives team changes because it lives in the platform, not in individual heads. And as the system learns from feedback and edits, quality improves automatically over time.`
))

children.push(new Paragraph({ children: [new TextRun({ text: 'Value Proposition Table', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(styledTable(
  ['Pillar', 'Meaning', 'Proof Point', 'Citation'],
  [
    ['Client Intelligence', 'ContentNode learns what works for each client — voice, preferences, market position — and applies it to every generation automatically', 'Client Brain stores signals from Box edits, stakeholder feedback, and content performance', 'Architecture: PostgreSQL + pgvector + BullMQ signal pipeline'],
    ['Production Speed', 'Workflows automate research-to-delivery in one pipeline — no re-briefing, no manual handoff', 'Teams go from market research to finished deliverable in a single workflow run', 'Node-based execution engine'],
    ['Content Quality', 'Detection-humanization loop ensures content reads human, not AI-generated', 'Targeted sentence-level rewriting based on detection scores below configured threshold', 'GPTZero / Originality.ai / Copyleaks integration'],
    ['Zero Disruption', 'Runs invisibly behind existing Monday.com and Box workflows', 'No change to client-facing processes — ContentNode is the background layer', 'Monday OAuth + Box API integration'],
  ],
  [18, 35, 32, 15],
))
children.push(sp())

// ── §09 Proof Points + Case Studies ──────────────────────────────────────────
children.push(...sh('09', 'Proof Points + Case Studies', 'Brochure · BDR Emails · Web Page · Video Script · eBook', true))
children.push(new Paragraph({ children: [new TextRun({ text: 'Proof Points', bold: true, size: 20 })], spacing: { after: 40 } }))
const ppList = [
  `ContentNode runs on a production-grade BullMQ execution engine with four queues — workflows run reliably in the background, not in the browser, regardless of job duration.`,
  `The Client Brain stores signals from Box file edits, stakeholder feedback, and content approvals — building per-client preference profiles that get more accurate over time.`,
  `ContentNode's detection-humanization loop is configurable by threshold, retry count, and service provider — agencies set the floor, the system handles the loop automatically.`,
  `Every AI provider call routes through a single abstraction layer with per-client API key references — no shared credentials, no cross-client data flow.`,
  `The Monday.com integration handles parent items, subitems, and custom column types via GraphQL — supporting complex agency board structures without workarounds.`,
  `Row-Level Security is enforced at the PostgreSQL layer — not in application code — making cross-client data access architecturally impossible.`,
]
ppList.forEach((pp) => {
  children.push(new Paragraph({ children: [new TextRun({ text: pp, size: 20 })], bullet: { level: 0 }, spacing: { after: 40 } }))
})
children.push(sp())

children.push(subh('Case Study Template (fill with real client data)'))
children.push(...field('Client Profile', '[Agency name, size, # of clients managed]'))
children.push(...area('Situation', '[The content production or quality problem they were experiencing before ContentNode]'))
children.push(...area('ContentNode Engagement', '[Which features were deployed and how the workflow was configured]'))
children.push(...area('Outcomes', '[Specific metrics: time saved, output volume increase, revision cycle reduction, client retention improvement]'))
children.push(...area('30-Second Version', '[One paragraph summary for use in BDR emails and LinkedIn posts]'))
children.push(...field('Headline Stat', '[The single most compelling number from the engagement]'))

// ── §10 Objection Handling ────────────────────────────────────────────────────
children.push(...sh('10', 'Objection Handling', 'Cheat Sheet · BDR Emails · Deck speaker notes', true))

const objections = [
  {
    obj: '"We already use ChatGPT / Claude / Jasper."',
    response: `Those are blank pages with AI. ContentNode is a system built on top of those same models that already knows your clients. You're not prompting from scratch — you're running pre-built workflows grounded in each client's GTM framework, brand voice, and approval history. It's the difference between a chat window and a production engine.`,
    followUp: `Ask: "How much time do you spend re-briefing the AI on each client before getting usable output?" The answer reveals the problem ContentNode solves.`,
  },
  {
    obj: '"Our clients don\'t want us using AI."',
    response: `ContentNode sits in the background — your clients never interact with it, and the output arrives through Box as normal. The humanization layer is specifically designed to produce content that passes AI detection checks. Your clients see the same delivery workflow. Nothing changes on their end.`,
    followUp: `Show the detection-humanization flow and post-processing scores. Ask if they'd be open to a blind test on output quality.`,
  },
  {
    obj: '"We have a Monday.com / Box workflow we can\'t disrupt."',
    response: `ContentNode is built to integrate behind Monday and Box, not replace them. Workflows trigger from Monday status changes, assets land in Box, and Monday status updates automatically on completion. Your clients see no change and your PM process stays intact.`,
    followUp: `Demo the Monday webhook → ContentNode → Box delivery flow with a real board structure.`,
  },
  {
    obj: '"How is this different from Jasper or Copy.ai?"',
    response: `Those tools help individual writers write faster. ContentNode helps agencies systematize what they know. Client Brain, GTM Framework, multi-client workflow management, Monday and Box integration, detection-humanization loop — none of that exists in any writing tool. We're in a different category.`,
    followUp: `Ask: "Does Jasper store what's been approved and rejected for each client? Does it integrate with your PM tool?" The answer closes the objection.`,
  },
  {
    obj: '"What about data security? Where does our client data go?"',
    response: `ContentNode is multi-tenant SaaS with hard data isolation enforced at the PostgreSQL layer using Row-Level Security. Every query is agency-scoped. AI provider calls route through your own Anthropic and OpenAI API keys — ContentNode never holds them. SOC 2 Type I audit is in progress. We can provide architecture documentation for security reviews.`,
    followUp: `Offer a security one-pager and architecture diagram for enterprise procurement reviews.`,
  },
]

objections.forEach((o, i) => {
  children.push(subh(`Objection ${i + 1}`))
  children.push(...field('Objection', o.obj))
  children.push(...area('Response', o.response))
  children.push(...area('Follow-Up', o.followUp))
})

// ── §11 Brand Voice Examples ──────────────────────────────────────────────────
children.push(...sh('11', 'Brand Voice Examples', 'All 8 assets — tonal guardrail', true))
children.push(...field('Tone Target', 'Direct, intelligent, practical. Speaks to operators who\'ve seen AI hype and want specifics. Never over-promises. Uses concrete mechanisms.'))
children.push(...field('Vocabulary Level', 'Professional without being corporate. Avoids jargon unless the audience lives in it. No buzzwords without substance behind them.'))
children.push(...field('Sentence Style', 'Short to medium sentences. Active voice. Lead with the problem or the implication, then the solution. Don\'t bury the point.'))
children.push(...field('What to Avoid', 'Hype language ("revolutionary," "game-changing," "10x"). Vague claims without proof. Passive voice. UK spelling. Anything that sounds like a press release.'))

children.push(...bullets('Good Examples', [
  `"ContentNode doesn't write for you — it learns what works for your clients and builds that into every workflow."`,
  `"Every agency knows what good content looks like for their clients. ContentNode is the system that stores that knowledge and applies it automatically."`,
  `"Your clients don't know ContentNode exists. That's the point."`,
  `"The agencies that win aren't writing faster. They're knowing more."`,
  `"When a strategist leaves, their client knowledge usually leaves with them. ContentNode fixes that."`,
]))

children.push(new Paragraph({ children: [new TextRun({ text: 'Bad Examples', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(styledTable(
  ['Bad Example', 'Why Wrong'],
  [
    ['"Revolutionize your content strategy with AI-powered intelligence"', 'Over-promised, vague, indistinguishable from 100 other AI tools'],
    ['"Leverage our cutting-edge NLP capabilities to optimise your workflows"', 'UK spelling ("optimise"), jargon-heavy, no buyer benefit stated'],
    ['"ContentNode utilizes advanced algorithms to enhance content production"', 'Passive, meaningless, no specificity — says nothing about what it actually does'],
    ['"10x your output with the power of AI"', 'Unsubstantiated claim, sounds like ChatGPT wrapper marketing'],
  ],
  [50, 50],
))
children.push(sp())

// ── §12 Competitive Differentiation ──────────────────────────────────────────
children.push(...sh('12', 'Competitive Differentiation', 'Cheat Sheet · BDR Emails · Deck', true))
children.push(styledTable(
  ['Competitor Type', 'Their Positioning', `${CLIENT} Counter`, 'When It Comes Up'],
  [
    ['AI Writing Tools (Jasper, Copy.ai, Writesonic)', '"AI makes content creation faster for individuals"', 'ContentNode manages 50+ clients simultaneously with per-client intelligence. Writing speed is a solved problem — the bottleneck is knowing the client. We solve that.', 'Prospect says "we already use [tool]"'],
    ['ChatGPT / Claude (direct use)', '"Unlimited AI for any task"', 'A chat window has no memory of your clients, no workflow structure, no delivery integration. ContentNode turns those same models into a production system that compounds over time.', 'Prospect questions why they need ContentNode when they have Claude'],
    ['Agency Operations Platforms (ClickUp, Teamwork)', '"Manage your entire agency in one place"', 'ContentNode doesn\'t touch PM — it runs in the background behind Monday and Box. We\'re the intelligence layer, not another dashboard to log into.', 'Prospect mentions their existing PM stack'],
    ['AI Research Tools (Crayon, Klue, Semrush)', '"AI-powered market intelligence and competitive research"', 'ContentNode includes research nodes (Review Miner, SEO Intent, Audience Signals) but converts research directly into client-specific content — automatically, not as reports you then have to brief from.', 'Prospect mentions research or competitive intelligence tools'],
    ['Content Intelligence Platforms (Contently, Percolate)', '"Enterprise content operations at scale"', 'ContentNode is purpose-built for the agency model — multi-client, Monday + Box native, with per-client AI workflows. Enterprise content platforms assume a single brand, not 20 simultaneous clients with different voices.', 'Enterprise or mid-market agency evaluating formal content ops platforms'],
  ],
  [20, 24, 36, 20],
))
children.push(sp())

// ── §13 Customer Quotes + Testimonials ───────────────────────────────────────
children.push(...sh('13', 'Customer Quotes + Testimonials', 'eBook · Brochure · Deck · Web Page', true))
children.push(new Paragraph({
  children: [new TextRun({ text: 'NOTE: The following are placeholder structures. Replace with real customer quotes before publishing any asset.', italics: true, size: 18, color: 'dc2626' })],
  spacing: { after: 160 },
}))

const quotePlaceholders = [
  { context: 'Time savings / output volume', use: 'BDR Email 1, Web Page hero, Deck' },
  { context: 'Client voice consistency across accounts', use: 'Brochure, eBook, LinkedIn' },
  { context: 'Monday + Box integration ease of adoption', use: 'Integration one-pager, BDR Email 2' },
  { context: 'Detection / humanization quality', use: 'Email 3, Cheat Sheet, Demo script' },
]
quotePlaceholders.forEach((q, i) => {
  children.push(subh(`Quote ${i + 1} — [${q.context}]`))
  children.push(new Paragraph({
    children: [new TextRun({ text: `"[Real customer quote about ${q.context.toLowerCase()}]"`, italics: true, size: 20 })],
    spacing: { after: 60 },
  }))
  children.push(...field('Attribution', '[Name, Title, Company]'))
  children.push(...field('Context', q.context))
  children.push(...field('Best Used In', q.use))
  children.push(...field('Approved', '☐ Yes  ☐ No — obtain written approval before use'))
})

// ── §14 Campaign Themes + Asset Mapping ──────────────────────────────────────
children.push(...sh('14', 'Campaign Themes + Asset Mapping', 'Campaign planning', true))
children.push(styledTable(
  ['Theme', 'Target Audience', 'Primary Assets', 'Key Message'],
  [
    ['"The Intelligence Engine"', 'Agency owners, heads of content', 'Thought leadership articles, LinkedIn series, email nurture sequence 1', '"The agencies that win aren\'t writing faster — they\'re knowing more."'],
    ['"AI That Already Knows Your Clients"', 'Senior strategists, demand gen leads', 'Demo video, case studies, web page hero, BDR outreach', '"Every generation grounded in client intelligence — not a blank page."'],
    ['"Behind Monday + Box"', 'Operations-focused buyers, agency COOs', 'Integration demo video, technical one-pager, BDR email 2', '"Your PM process stays the same. ContentNode runs in the background."'],
    ['"The Revision Loop Ends Here"', 'Anyone burned by AI detection issues', 'LinkedIn explainer series, email 3, detection-humanization feature page', '"Content that clears AI detection checks. Automatically."'],
    ['"When Your Best Strategist Leaves"', 'Agency owners concerned with team dependency', 'Blog post, LinkedIn, nurture email 4', '"The Client Brain stores what your team knows about each client — permanently."'],
  ],
  [22, 24, 30, 24],
))
children.push(sp())

// ── §15 FAQs ──────────────────────────────────────────────────────────────────
children.push(...sh('15', 'Frequently Asked Questions', 'eBook · BDR Email sequence · Cheat Sheet', true))

const faqs = [
  {
    q: 'What AI models does ContentNode use?',
    a: `ContentNode routes through Anthropic Claude (primary; claude-sonnet-4-6 for intelligence tasks, claude-haiku-4-5 for fast low-stakes tasks), OpenAI GPT models, or Ollama for local/private models. Agencies use their own API keys — ContentNode never holds provider credentials directly.`,
    use: 'Technical eBook, FAQ page, security questionnaire',
  },
  {
    q: 'Does ContentNode replace our writers?',
    a: `No. ContentNode systematizes the intelligence your writers have built about each client and automates the production pipeline, so your team spends time on strategy and creative direction rather than first drafts and reformatting. Most agencies find their output volume increases significantly with the same headcount.`,
    use: 'All prospect-facing assets',
  },
  {
    q: 'How does the Monday.com integration work?',
    a: `ContentNode connects via Monday.com OAuth and webhook subscriptions. Status changes on Monday board items trigger ContentNode workflows automatically. Finished assets are delivered to Box, and the Monday item status and file URL are updated without manual intervention. The integration supports both parent items and subitems.`,
    use: 'Integration page, BDR email 2, demo script',
  },
  {
    q: 'How is client data kept separate between agencies?',
    a: `ContentNode enforces data isolation at the PostgreSQL layer using Row-Level Security policies. Every database query is scoped to the authenticated agency and client — there is no application-level filter that can be bypassed. Cross-agency data access is architecturally impossible, not just access-controlled.`,
    use: 'Security questionnaire, enterprise sales, FAQ page',
  },
  {
    q: 'What does the humanization loop actually do?',
    a: `After AI generation, content is submitted to your configured detection service (GPTZero, Originality.ai, or Copyleaks). If the score exceeds your configured threshold, ContentNode identifies which specific sentences were flagged and rewrites only those sentences — preserving approved language and minimizing unnecessary changes. The loop retries until the score clears or the max retry count is reached.`,
    use: 'Feature explainer, demo, Cheat Sheet, email 3',
  },
  {
    q: 'How long does it take to set up a new client?',
    a: `Filling a GTM Framework with the guided productPILOT intake takes 1–2 hours with a senior strategist. Workflows for that client can run the same day. The system starts learning from the first run — intelligence compounds with every approval, feedback, and Box edit from that point forward.`,
    use: 'Onboarding materials, FAQ page, sales conversations',
  },
  {
    q: 'Can we use ContentNode without Monday.com or Box?',
    a: `Yes. Monday and Box integrations are optional. ContentNode runs workflows, manages deliverables, and stores client intelligence independently. The integrations are for agencies that want to run ContentNode invisibly behind their existing PM and file delivery stack.`,
    use: 'FAQ page, sales qualification',
  },
]

faqs.forEach((faq, i) => {
  children.push(new Paragraph({
    children: [new TextRun({ text: `Q${i + 1}: ${faq.q}`, bold: true, size: 20 })],
    spacing: { before: 120, after: 40 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: `A: ${faq.a}`, size: 20 })],
    spacing: { after: 40 },
  }))
  children.push(...field('Best Addressed In', faq.use))
})

// ── §16 Content Funnel Mapping ────────────────────────────────────────────────
children.push(...sh('16', 'Content Funnel Mapping', 'All 8 assets — sequencing and CTA alignment', true))
children.push(styledTable(
  ['Stage', 'Assets', 'Primary CTA', 'Buyer State'],
  [
    ['Awareness (TOFU)', 'LinkedIn thought leadership series, blog posts ("The Intelligence Engine"), podcast appearances, Reddit / community participation', '"Learn how top agencies systematize client intelligence" → Blog / LinkedIn follow', 'Skeptical; problem-aware but solution-unaware; high AI hype fatigue'],
    ['Consideration (MOFU)', 'Case studies, integration explainer videos, "How ContentNode Works" demo, comparison content vs. writing tools', '"See how ContentNode works in your workflow" → Demo request / Trial signup', 'Actively evaluating; comparing options; needs to see the workflow before committing'],
    ['Decision (BOFU)', 'Live demo, ROI calculator, onboarding walkthrough, free trial with first workflow built', '"Start your first client workflow today" → Trial / Paid', 'Ready to commit; needs proof of fit and confidence in onboarding'],
    ['Retention / Expansion', 'Feature update emails, best practice guides ("Getting More From the Client Brain"), QBR templates, new integration announcements', '"Add a new client vertical" → Expansion', 'Active customer; looking for more value from existing investment'],
  ],
  [18, 36, 28, 18],
))
children.push(sp())
children.push(...area('CTA Sequencing',
  `Top of funnel: "Read the article" or "Follow for more" — no friction, no form.\nMiddle of funnel: "Book a demo" or "Start free trial" — single clear CTA per asset.\nBottom of funnel: "Start onboarding" or "Talk to us about your workflow" — high-intent, low-friction.\nPost-sale: "Add a new client vertical" or "Explore [new feature]" — expansion-focused.\n\nAll assets in the email nurture sequence should respect the buyer's stage. Don't send a case study in email 1. Don't send thought leadership in email 4.`
))

// ── §17 Regulatory + Compliance ───────────────────────────────────────────────
children.push(...sh('17', 'Regulatory + Compliance', 'Brochure · eBook · Deck · Cheat Sheet · BDR Email 3', true))
children.push(styledTable(
  ['Requirement', `${CLIENT} Capability`, 'Scope', 'Sales Note'],
  [
    ['GDPR / CCPA data privacy', 'Per-agency Row-Level Security at the PostgreSQL layer. No cross-agency data access. Agency is data controller; ContentNode acts as data processor.', 'All client data stored in ContentNode', 'Ensure DPA is in place with agencies operating in EU or California. Available on request.'],
    ['SOC 2 Type I (in progress)', 'Pursuing formal audit. Current controls: API token encryption at rest, access logging, PII-free log policy, role-based access control.', 'Platform-wide', 'Available as documentation for enterprise security reviews. Type II timeline TBD.'],
    ['AI Model Data Handling', 'AI provider calls route through agency-owned API keys. ContentNode does not store API keys in plaintext. Data handling governed by Anthropic and OpenAI enterprise terms.', 'All AI Generate, Humanizer, and research nodes', 'Direct prospects to Anthropic and OpenAI enterprise agreements for data processing terms.'],
    ['Multi-tenant data isolation', 'Enforced at database layer — not application layer. PostgreSQL RLS policies are applied on every query. Cannot be bypassed by application code.', 'All client and agency data', 'This is a technical architecture point worth calling out specifically in enterprise security conversations.'],
  ],
  [22, 35, 22, 21],
))
children.push(sp())
children.push(...area('Regulatory Sales Note',
  `ContentNode is not built for regulated industries (healthcare, financial services, government contracting) as a primary use case. For agencies serving clients in regulated sectors, the key point is that ContentNode generates draft content that is reviewed and approved by the agency before delivery — it is a production tool, not an autonomous publisher. The agency maintains editorial control and accountability. This framing resolves most objections from compliance-cautious buyers.`
))

// ── §18 CTAs + Next Steps ─────────────────────────────────────────────────────
children.push(...sh('18', 'CTAs + Next Steps', 'All 8 assets', true))

children.push(new Paragraph({ children: [new TextRun({ text: 'CTAs', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(styledTable(
  ['CTA Name', 'Description', 'Target Audience / Trigger', 'Asset Context'],
  [
    ['"Book a Demo"', '30-minute live walkthrough of ContentNode with a workflow built around the prospect\'s actual client type', 'Agency owners and heads of content at mid-funnel evaluation stage', 'Demo video CTA, one-pager, LinkedIn ads, BDR email 2'],
    ['"Start Free Trial"', '14-day full-access trial with one client setup included and first workflow running', 'Hands-on evaluators who want to self-serve before talking to sales', 'Website hero, BDR email 3, LinkedIn, retargeting'],
    ['"See the Monday Integration"', 'Short product video: Monday status change → ContentNode workflow → Box delivery → Monday URL writeback', 'Ops-focused buyers who need to see the workflow before they\'ll engage', 'LinkedIn, BDR email 2, Monday integration page'],
    ['"Download the GTM Framework Template"', 'Free blank GTM Framework template — lead magnet for agencies not yet ready to buy but in the right profile', 'Top of funnel, awareness stage, ICP-fit agencies', 'Blog CTA, LinkedIn, newsletter, SEO landing page'],
    ['"Talk to an Agency Strategist"', 'High-touch entry point for enterprise deals — talk to someone who has set up ContentNode for an agency like yours', 'Enterprise agencies (20+ people) or high-complexity workflows', 'Enterprise page, ABM outreach, conference follow-up'],
  ],
  [18, 34, 28, 20],
))
children.push(sp())

children.push(new Paragraph({ children: [new TextRun({ text: 'Campaign Themes (Quick Reference)', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(styledTable(
  ['Campaign Name', 'Description'],
  [
    ['"The Intelligence Engine"', 'Thought leadership campaign positioning ContentNode as the system behind agency AI — the intelligence infrastructure, not another writing accelerator'],
    ['"AI That Already Knows Your Clients"', 'Product-led campaign demonstrating Client Brain, GTM Framework, and preference profile capabilities through specific feature walkthroughs'],
    ['"Behind Monday + Box"', 'Integration-focused campaign for ops-minded buyers who need to see the workflow integration before they\'ll evaluate seriously'],
    ['"The Revision Loop Ends Here"', 'Pain-point campaign targeting agencies burned by AI detection issues or high revision cycles from AI-generated content'],
  ],
  [30, 70],
))
children.push(sp())

children.push(new Paragraph({ children: [new TextRun({ text: 'Document Control', bold: true, size: 20 })], spacing: { after: 60 } }))
children.push(...field('Vertical Owner', 'ContentNode — Internal Strategy'))
children.push(...field('Document Version', 'v1.0 — AI-Generated Draft (review and approve before publishing)'))
children.push(...field('Last Updated', dateStr))
children.push(...field('Next Review Date', 'July 27, 2026'))

// ── Assemble document ─────────────────────────────────────────────────────────

const footerChildren: TextRun[] = [
  new TextRun({ text: 'Confidential', size: 16, color: '94a3b8' }),
  new TextRun({ text: '\t', size: 16 }),
  new TextRun({ text: 'ContentNode AI', size: 16, color: '94a3b8' }),
  new TextRun({ text: '\t', size: 16 }),
  new TextRun({ text: 'Page ', size: 16, color: '94a3b8' }),
  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94a3b8' }),
  new TextRun({ text: ' of ', size: 16, color: '94a3b8' }),
  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '94a3b8' }),
]

const doc = new Document({
  styles: {
    paragraphStyles: [
      {
        id: 'Normal',
        name: 'Normal',
        run: { font: { name: 'Calibri' }, size: 21, color: '1e293b' },
        paragraph: { spacing: { line: 276, after: 100 } },
      },
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        run: { bold: true, size: 28, color: PRIMARY, font: { name: 'Calibri' } },
        paragraph: { spacing: { before: 280, after: 140 } },
      },
    ],
  },
  sections: [
    {
      properties: { titlePage: true },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [new TextRun({ text: `Confidential: For Internal ${CLIENT} Use Only`, size: 16, color: '94a3b8', italics: true })],
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `${CLIENT} | ${VERTICAL}`, size: 18, color: '94a3b8' }),
                new TextRun({ text: '\t', size: 18 }),
                new TextRun({ text: 'GTM Framework', size: 18, color: '94a3b8' }),
              ],
              alignment: AlignmentType.LEFT,
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' } },
            }),
          ],
        }),
        first: new Header({ children: [new Paragraph({ children: [] })] }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: footerChildren,
              alignment: AlignmentType.LEFT,
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' } },
              tabStops: [
                { type: 'center', position: 4320 },
                { type: 'right', position: 8640 },
              ],
            }),
          ],
        }),
        first: new Footer({ children: [new Paragraph({ children: [] })] }),
      },
      children,
    },
  ],
})

async function main() {
  const buffer = await Packer.toBuffer(doc)
  const today = new Date().toISOString().slice(0, 10)
  const filename = `GTM-Framework-ContentNode-${today}.docx`
  const dest = path.join(os.homedir(), 'Downloads', filename)
  fs.writeFileSync(dest, buffer)
  console.log(`✓ Saved to: ${dest}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
