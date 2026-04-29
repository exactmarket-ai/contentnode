/**
 * Kit asset preview script — renders any kit asset to ~/Downloads without AI.
 *
 * Usage:
 *   pnpm tsx scripts/preview-brochure.ts                          # NexusTek brochure sample
 *   pnpm tsx scripts/preview-brochure.ts <content-file.txt>       # brochure with your content
 *   pnpm tsx scripts/preview-brochure.ts <content-file.txt> <index>  # specific asset (0-7)
 *
 * To get your content: click the "raw" button next to any asset in the Kit delivery screen.
 * Save the downloaded .txt file, then pass the path here.
 *
 * Asset indexes: 0=Brochure, 1=eBook, 2=Cheat Sheet, 3=BDR Emails,
 *                4=Customer Deck, 5=Video Script, 6=Web Page Copy, 7=Internal Brief
 */

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType,
  Footer, PageNumber,
  ShadingType, HeightRule, BorderStyle, SectionType,
  convertInchesToTwip,
} from 'docx'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── DocStyle ──────────────────────────────────────────────────────────────────

interface DocStyle {
  primaryColor: string
  secondaryColor: string
  headingFont: string
  bodyFont: string
  logoDataUrl: string | null
  agencyName: string
  footerText: string
  includeCoverPage: boolean
  includePageNumbers: boolean
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function hexNoHash(color: string): string {
  return color.replace('#', '').toUpperCase()
}

function lerpHex(c1: string, c2: string, t: number): string {
  const h = (s: string) => s.replace('#', '').toUpperCase()
  const rgb = (s: string): [number, number, number] => {
    const c = h(s); return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)]
  }
  const [r1,g1,b1] = rgb(c1); const [r2,g2,b2] = rgb(c2)
  return [r1*(1-t)+r2*t, g1*(1-t)+g2*t, b1*(1-t)+b2*t]
    .map(v => Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase()
}
function lighten(hex: string, amount: number): string {
  const c = hex.replace('#', '').toUpperCase()
  const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16)
  return [Math.min(255,Math.round(r+(255-r)*amount)), Math.min(255,Math.round(g+(255-g)*amount)), Math.min(255,Math.round(b+(255-b)*amount))]
    .map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase()
}
function tint(color: string, opacity: number): string {
  const c = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color
  const r = parseInt(c.slice(1, 3), 16)
  const g = parseInt(c.slice(3, 5), 16)
  const b = parseInt(c.slice(5, 7), 16)
  const rr = Math.round(255 * (1 - opacity) + r * opacity)
  const gg = Math.round(255 * (1 - opacity) + g * opacity)
  const bb = Math.round(255 * (1 - opacity) + b * opacity)
  return [rr, gg, bb].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ── Text helpers ──────────────────────────────────────────────────────────────

function sanitize(text: string): string {
  return text.replace(/&/g, 'and')
}

function parseInlineRuns(text: string, font: string, size: number, color: string): TextRun[] {
  return sanitize(text)
    .split(/\*\*/)
    .filter((_, i, arr) => !(i === arr.length - 1 && arr[arr.length - 1] === ''))
    .map((part, i) => new TextRun({ text: part, bold: i % 2 === 1, font, size, color }))
}

function buildHRule(primaryColor: string): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hexNoHash(primaryColor), space: 1 } },
    spacing: { after: 160 },
    children: [],
  })
}

function noBorder() { return { style: BorderStyle.NONE, size: 0, color: 'auto' } as const }

// ── Section builders (copied from kitDownload.ts, browser deps removed) ────────

function buildStyledTable(tableLines: string[], docStyle: DocStyle): Table {
  const primary   = hexNoHash(docStyle.primaryColor)
  const altRow    = tint(docStyle.secondaryColor, 0.1)
  const borderCol = tint(docStyle.primaryColor, 0.3)
  const bodyFont  = docStyle.bodyFont
  const bodySize  = 22
  const dataRows  = tableLines
    .filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    .filter((l, idx) => {
      if (idx === 0) return true
      const cells = l.split('|').slice(1, -1).map(c => c.trim().toLowerCase())
      return !cells.every(c => !c || c === 'na' || c === '—' || c === '-' || c === '–' || c === '\\-')
    })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      bottom:           { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      left:             { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      right:            { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: borderCol },
    },
    rows: dataRows.map((row, rowIdx) => {
      const cells  = row.split('|').slice(1, -1).map(c => c.trim())
      const isHead = rowIdx === 0
      const isAlt  = !isHead && rowIdx % 2 === 0
      const fill   = isHead ? primary : isAlt ? altRow : 'FFFFFF'
      return new TableRow({
        children: cells.map(cell => new TableCell({
          shading: { fill, type: ShadingType.SOLID, color: fill },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: isHead
              ? [new TextRun({ text: sanitize(cell), bold: true, color: 'FFFFFF', font: docStyle.headingFont, size: bodySize })]
              : parseInlineRuns(cell, bodyFont, bodySize, '1A1A14'),
          })],
        })),
      })
    }),
  })
}

function buildFooterElement(docStyle: DocStyle): Footer {
  const font  = docStyle.bodyFont
  const size  = 18
  const muted = '6B7280'
  const parts: TextRun[] = []
  if (docStyle.agencyName) parts.push(new TextRun({ text: docStyle.agencyName, font, size, color: muted }))
  if (docStyle.footerText) {
    parts.push(new TextRun({ text: '\t', font, size }))
    parts.push(new TextRun({ text: docStyle.footerText, font, size, color: muted }))
  }
  if (docStyle.includePageNumbers) {
    parts.push(new TextRun({ text: '\t', font, size }))
    parts.push(new TextRun({ children: [PageNumber.CURRENT], font, size, color: muted }))
    parts.push(new TextRun({ text: ' / ', font, size, color: muted }))
    parts.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size, color: muted }))
  }
  return new Footer({
    children: [new Paragraph({
      children: parts,
      tabStops: [
        { type: 'center', position: 4680 },
        { type: 'right',  position: 9360 },
      ],
    })],
  })
}

function buildStatBar(lines: string[], docStyle: DocStyle): Table {
  const parsed = lines
    .filter(l => /^[-*] /.test(l))
    .slice(0, 4)
    .map(l => {
      const parts = l.slice(2).split('|').map(p => p.trim())
      return { val: (parts[0] ?? '').replace(/\*\*/g, ''), label: parts[1] ?? '', source: parts[2] ?? '' }
    })
  while (parsed.length < 4) parsed.push({ val: '–', label: '', source: '' })

  const primary   = hexNoHash(docStyle.primaryColor)
  const secondary = hexNoHash(docStyle.secondaryColor)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    rows: [new TableRow({
      children: parsed.map(s => new TableCell({
        shading: { fill: primary, type: ShadingType.SOLID, color: primary },
        margins: { top: 200, bottom: 200, left: 140, right: 140 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s.val), font: hf, size: 40, bold: true, color: secondary })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s.label), font: bf, size: 20, color: 'FFFFFF' })] }),
          ...(s.source ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s.source), font: bf, size: 16, italics: true, color: 'CCCCCC' })] })] : []),
        ],
      })),
    })],
  })
}

function buildPillars2x2(lines: string[], docStyle: DocStyle): Table {
  const blocks: { name: string; valueProp: string; bullets: string[] }[] = []
  let cur: { name: string; valueProp: string; bullets: string[] } | null = null
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (cur) blocks.push(cur)
      cur = { name: line.slice(4).trim(), valueProp: '', bullets: [] }
    } else if (cur) {
      if (/^[-*] /.test(line)) cur.bullets.push(line.slice(2).trim())
      else if (line.trim() && !cur.valueProp) cur.valueProp = line.trim()
    }
  }
  if (cur) blocks.push(cur)
  while (blocks.length < 4) blocks.push({ name: 'Additional Service Area', valueProp: '', bullets: [] })

  const primary   = hexNoHash(docStyle.primaryColor)
  const secondary = hexNoHash(docStyle.secondaryColor)
  const altFill   = tint(docStyle.secondaryColor, 0.06)
  const borderCol = tint(docStyle.primaryColor, 0.3)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  const buildCell = (b: typeof blocks[0], idx: number): TableCell => {
    const fill = idx % 2 === 0 ? 'FFFFFF' : altFill
    return new TableCell({
      shading: { fill, type: ShadingType.SOLID, color: fill },
      margins: { top: 180, bottom: 180, left: 160, right: 160 },
      children: [
        new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: sanitize(b.name), font: hf, size: 24, bold: true, color: primary })] }),
        ...(b.valueProp ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: sanitize(b.valueProp), font: bf, size: 20, italics: true, color: '3A3A34' })] })] : []),
        ...b.bullets.map(bl => new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: '• ', font: bf, size: 20, color: secondary }),
            new TextRun({ text: sanitize(bl), font: bf, size: 20 }),
          ],
        })),
      ],
    })
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.SINGLE, size: 4, color: primary },
      bottom:           { style: BorderStyle.SINGLE, size: 4, color: primary },
      left:             { style: BorderStyle.SINGLE, size: 4, color: primary },
      right:            { style: BorderStyle.SINGLE, size: 4, color: primary },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: borderCol },
    },
    rows: [
      new TableRow({ children: [buildCell(blocks[0], 0), buildCell(blocks[1], 1)] }),
      new TableRow({ children: [buildCell(blocks[2], 2), buildCell(blocks[3], 3)] }),
    ],
  })
}

function buildProofStrip(lines: string[], docStyle: DocStyle): Table {
  const parsed = lines
    .filter(l => /^[-*] /.test(l))
    .slice(0, 6)
    .map(l => {
      const parts = l.slice(2).split('|').map(p => p.trim())
      return { val: (parts[0] ?? '').replace(/\*\*/g, ''), label: parts[1] ?? '' }
    })

  const primary = hexNoHash(docStyle.primaryColor)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    rows: [new TableRow({
      children: parsed.map(p => new TableCell({
        shading: { fill: primary, type: ShadingType.SOLID, color: primary },
        margins: { top: 200, bottom: 200, left: 120, right: 120 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(p.val), font: hf, size: 48, bold: true, color: 'FFFFFF' })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(p.label), font: bf, size: 20, color: 'DDDDDD' })] }),
        ],
      })),
    })],
  })
}

function buildCaseStudies(lines: string[], docStyle: DocStyle): (Paragraph | Table)[] {
  const blocks: { title: string; fields: { key: string; value: string }[] }[] = []
  let cur: { title: string; fields: { key: string; value: string }[] } | null = null
  for (const line of lines) {
    if (line.startsWith('### ')) {
      if (cur) blocks.push(cur)
      cur = { title: line.slice(4).trim(), fields: [] }
    } else if (cur) {
      const m = line.match(/^\*\*([^*]+):\*\*\s*(.*)/)
      if (m) {
        cur.fields.push({ key: m[1].trim(), value: m[2].trim() })
      } else if (line.trim() && cur.fields.length > 0) {
        cur.fields[cur.fields.length - 1].value += ' ' + line.trim()
      }
    }
  }
  if (cur) blocks.push(cur)
  const placeholder = {
    title: 'Case Study Pending',
    fields: [
      { key: 'Who they are', value: 'Contact your team to add verified client profile details.' },
      { key: 'The challenge', value: '—' },
      { key: 'What we delivered', value: '—' },
      { key: 'The outcome', value: '—' },
    ],
  }
  while (blocks.length < 2) blocks.push(placeholder)

  const primary   = hexNoHash(docStyle.primaryColor)
  const borderCol = tint(docStyle.primaryColor, 0.25)
  const bf = docStyle.bodyFont
  const hf = docStyle.headingFont

  const result: (Paragraph | Table)[] = []

  for (const block of blocks) {
    result.push(new Paragraph({
      spacing: { before: 280, after: 120 },
      children: [new TextRun({ text: sanitize(block.title), font: hf, size: 26, bold: true, color: '1A1A14' })],
    }))
    result.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
      rows: block.fields.map(f => new TableRow({
        children: [
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE },
            margins: { top: 120, bottom: 120, left: 140, right: 140 },
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 4, color: borderCol },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: borderCol },
              left:   { style: BorderStyle.SINGLE, size: 4, color: borderCol },
              right:  noBorder(),
            },
            children: [new Paragraph({ children: [new TextRun({ text: sanitize(f.key), font: bf, size: 20, bold: true, color: primary })] })],
          }),
          new TableCell({
            margins: { top: 120, bottom: 120, left: 140, right: 140 },
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 4, color: borderCol },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: borderCol },
              left:   noBorder(),
              right:  { style: BorderStyle.SINGLE, size: 4, color: borderCol },
            },
            children: [new Paragraph({ children: [new TextRun({ text: sanitize(f.value), font: bf, size: 20 })] })],
          }),
        ],
      })),
    }))
    result.push(new Paragraph({}))
  }

  return result
}

function buildBackCoverCta(lines: string[], docStyle: DocStyle): (Paragraph | Table)[] {
  let ctaName = ''
  let ctaDesc = ''
  let ctaUrl  = ''
  const secondaries: string[] = []

  for (const line of lines) {
    if (/^\*\*[^*]+\*\*$/.test(line.trim()))  { ctaName = line.trim().replace(/\*\*/g, ''); continue }
    if (/^https?:\/\//i.test(line.trim()))     { ctaUrl  = line.trim(); continue }
    if (/^[-*] /.test(line))                   { secondaries.push(line.slice(2).trim()); continue }
    if (line.trim() && !ctaDesc)               { ctaDesc = line.trim() }
  }

  const primary = hexNoHash(docStyle.primaryColor)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  const ctaChildren: Paragraph[] = []
  if (ctaName) ctaChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: sanitize(ctaName), font: hf, size: 40, bold: true, color: 'FFFFFF' })] }))
  if (ctaDesc) ctaChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: sanitize(ctaDesc), font: bf, size: 22, color: 'DDDDDD' })] }))
  if (ctaUrl)  ctaChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80  }, children: [new TextRun({ text: ctaUrl, font: bf, size: 20, bold: true, color: 'FFFFFF', underline: {} })] }))

  const elements: (Paragraph | Table)[] = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
      rows: [new TableRow({
        children: [new TableCell({
          shading: { fill: primary, type: ShadingType.SOLID, color: primary },
          margins: { top: 320, bottom: 320, left: 320, right: 320 },
          children: ctaChildren.length ? ctaChildren : [new Paragraph({ children: [] })],
        })],
      })],
    }),
  ]
  if (secondaries.length) {
    elements.push(new Paragraph({ spacing: { before: 240 }, children: [] }))
    for (const s of secondaries) {
      elements.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: sanitize(s), font: bf, size: 22 })] }))
    }
  }
  return elements
}

// ── Brochure cover (Node-compatible — no logo, no browser Image) ──────────────

function buildBrochureCoverNode(
  docStyle: DocStyle,
  tagline: string,
  clientName: string,
  verticalName: string,
): (Paragraph | Table)[] {
  const primary   = hexNoHash(docStyle.primaryColor)
  const secondary = hexNoHash(docStyle.secondaryColor)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  const items: Paragraph[] = [
    // Top spacer (no logo in preview)
    new Paragraph({ spacing: { before: 1200 }, children: [] }),
    // Client name
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: sanitize(clientName), font: hf, size: 80, bold: true, color: 'FFFFFF' })],
    }),
    // Accent divider
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: '─────', font: bf, size: 24, color: secondary })],
    }),
  ]

  if (tagline) {
    items.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: sanitize(tagline), font: hf, size: 40, bold: false, color: 'FFFFFF' })],
    }))
  }

  items.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [new TextRun({ text: sanitize(verticalName).toUpperCase(), font: bf, size: 22, color: 'AAAAAA' })],
  }))

  const nilBorder = { style: BorderStyle.NIL } as const
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: nilBorder, bottom: nilBorder, left: nilBorder, right: nilBorder, insideHorizontal: nilBorder, insideVertical: nilBorder },
    rows: [new TableRow({
      height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT },
      children: [new TableCell({ shading: { fill: primary, type: ShadingType.SOLID, color: primary }, children: items })],
    })],
  })]
}

// ── Main brochure builder (Node-compatible — Packer.toBuffer) ─────────────────

async function buildBrochureBuffer(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Buffer> {
  const primaryHex   = hexNoHash(docStyle.primaryColor)
  const secondaryHex = hexNoHash(docStyle.secondaryColor)
  const bodyColor    = '1A1A14'
  const bodyFont     = docStyle.bodyFont
  const headFont     = docStyle.headingFont

  const rawSections = markdown.split(/^(?=## )/m).filter(s => s.trim())
  const sections = rawSections.map(s => {
    const lines = s.split('\n')
    const m = lines[0].match(/^## (.+)/)
    return { name: (m ? m[1] : '').trim().toLowerCase(), lines: lines.slice(1) }
  })

  const coverSection = sections.find(s => s.name === 'cover')
  const coverTagline = (coverSection?.lines.find(l => l.trim())?.trim() ?? '').replace(/^["'"'"']+|["'"'"']+$/g, '').trim()

  const body: (Paragraph | Table)[] = []

  const renderGeneric = (lines: string[]) => {
    let tableLines: string[] = []
    const flush = () => {
      if (!tableLines.length) return
      const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
      if (dataRows.length) body.push(buildStyledTable(tableLines, docStyle))
      tableLines = []
    }
    for (const line of lines) {
      if (line.startsWith('|')) { tableLines.push(line); continue }
      flush()
      if      (line.startsWith('# '))    body.push(new Paragraph({ style: 'Heading1', children: [new TextRun(sanitize(line.slice(2)))] }))
      else if (line.startsWith('## '))   body.push(new Paragraph({ style: 'Heading2', children: [new TextRun(sanitize(line.slice(3)))] }))
      else if (line.startsWith('### '))  body.push(new Paragraph({ style: 'Heading3', children: [new TextRun(sanitize(line.slice(4)))] }))
      else if (line.startsWith('#### ')) body.push(new Paragraph({ style: 'Heading4', children: [new TextRun(sanitize(line.slice(5)))] }))
      else if (/^[-*] /.test(line))      body.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), bodyFont, 22, bodyColor) }))
      else if (line.startsWith('> '))    body.push(new Paragraph({ indent: { left: 720 }, children: parseInlineRuns(line.slice(2), bodyFont, 22, bodyColor) }))
      else if (/^---+$|^===+$/.test(line.trim())) body.push(buildHRule(docStyle.primaryColor))
      else if (line.trim() === '')        body.push(new Paragraph({}))
      else                               body.push(new Paragraph({ children: parseInlineRuns(line, bodyFont, 22, bodyColor) }))
    }
    flush()
  }

  for (const { name, lines } of sections) {
    if (name === 'cover') continue

    if (name.includes('stat')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('Key Statistics')] }))
      body.push(buildStatBar(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('challenge')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('Challenges We Solve')] }))
      renderGeneric(lines)
      body.push(new Paragraph({}))
    } else if (name.includes('pillar') || name.includes('deliver')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('What We Deliver')] }))
      body.push(buildPillars2x2(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('why')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun(sanitize(name))] }))
      renderGeneric(lines)
      body.push(new Paragraph({}))
    } else if (name.includes('proof')) {
      body.push(buildHRule(docStyle.primaryColor))
      body.push(buildProofStrip(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('case') || name.includes('practice')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('In Practice')] }))
      body.push(...buildCaseStudies(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('back cover') || name.includes('back') || name.includes('cta') || name.includes('start')) {
      body.push(buildHRule(docStyle.primaryColor))
      body.push(...buildBackCoverCta(lines, docStyle))
    } else {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun(sanitize(name))] }))
      renderGeneric(lines)
      body.push(new Paragraph({}))
    }
  }

  const coverChildren = buildBrochureCoverNode(docStyle, coverTagline, clientName, verticalName)

  const showFooter = docStyle.includePageNumbers || !!docStyle.agencyName || !!docStyle.footerText
  const footers = showFooter ? { default: buildFooterElement(docStyle) } : undefined

  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Normal',   name: 'Normal',   run: { font: bodyFont, size: 22, color: bodyColor } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 48, bold: true, color: primaryHex }, paragraph: { spacing: { before: 240, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 36, bold: true, color: primaryHex }, paragraph: { spacing: { before: 200, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 28, bold: true, color: secondaryHex }, paragraph: { spacing: { before: 160, after: 80 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 24, bold: true, color: primaryHex }, paragraph: { spacing: { before: 120, after: 60 } } },
      ],
    },
    numbering: {
      config: [{ reference: 'default-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } }] }],
    },
    sections: [
      { properties: { type: SectionType.NEXT_PAGE }, children: coverChildren },
      { ...(footers ? { footers } : {}), children: body },
    ],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

// ── Sample content — NexusTek Healthcare ─────────────────────────────────────

const NEXUSTEK_BROCHURE = `
## cover
Smarter Care Starts with Connected Data

## stats
- 42% | Reduction in average claim denial rate | Advisory Board 2024
- 3.2x | Faster care gap closure vs. national average | NCQA Report 2023
- $2.1M | Average first-year ROI for 500-bed systems | NexusTek Client Data
- 98.7% | Uptime SLA across all production deployments | Internal SLA Report

## challenges
| Challenge | Impact | Root Cause |
|-----------|--------|------------|
| Disconnected EHR and billing systems | 18-22% claim denial rates | Data silos between clinical and revenue cycle |
| Manual care gap identification | Slow outreach, missed quality targets | No automated population health layer |
| Regulatory compliance overhead | $1.2M+ annual compliance cost | Fragmented audit trail across systems |
| Staff burnout from documentation | 34% nursing turnover | Time-consuming manual data entry |

## pillars
### Revenue Cycle Intelligence
Reduce denials before they happen with real-time eligibility verification and claim pre-scrubbing.
- Automated prior authorization
- Denial root-cause analytics
- 340B compliance monitoring
- Real-time eligibility checks

### Population Health Platform
Proactively close care gaps and improve HEDIS scores with AI-driven patient stratification.
- Risk stratification engine
- Automated care gap alerts
- HEDIS measure tracking
- Chronic disease management protocols

### Clinical Documentation Automation
Cut documentation time by 40% with ambient AI capture and smart templates.
- Ambient voice capture
- Smart documentation templates
- ICD-10 coding assistance
- Clinical decision support

### Analytics and Reporting
Board-ready dashboards and operational intelligence for every stakeholder.
- Real-time operational dashboards
- Custom KPI scorecards
- Regulatory reporting automation
- Peer health system benchmarking

## why NexusTek
Our implementation team includes former CMOs, CFOs, and CIOs — we've sat in your seat.

- **Deep healthcare expertise**: 200+ successful health system implementations since 2008
- **Interoperability-first architecture**: Pre-built connectors for Epic, Cerner, Meditech, and 40+ platforms
- **No shelf-ware guarantee**: Every module is deployed and adopted or you don't pay
- **Healthcare-only focus**: No competing priorities from other verticals

## proof
- 200+ | Health systems served
- 40+ | EHR integrations
- $840M | Revenue recovered for clients
- 99.2% | Client retention rate
- 15 yrs | Healthcare AI experience
- 4.8/5 | G2 customer satisfaction

## in practice
### Metro Regional Health System
**Who they are:** 650-bed regional health system, 12 clinics, southeastern US
**Challenge:** 21% claim denial rate and $4.2M in annual write-offs from preventable denials
**What we delivered:** Revenue Cycle Intelligence with real-time eligibility and denial analytics
**Outcome:** Denial rate dropped to 7.8% within 6 months. $3.1M recovered in year one.

### Cascade Community Medical Center
**Who they are:** 280-bed community hospital with critical access designation, Pacific Northwest
**Challenge:** Missing HEDIS targets by 12+ measures, threatening value-based contract bonuses
**What we delivered:** Population Health Platform with automated care gap workflows
**Outcome:** Achieved top-quartile HEDIS performance in 18 months. $1.4M in VBC bonuses captured.

## cta
**Ready to stop losing revenue to preventable denials?**
Book a 30-minute value assessment with our healthcare team. We'll benchmark your current performance against peer health systems and identify your top three revenue recovery opportunities.
https://nexustekhealthcare.com/assessment
- No obligation — leave with actionable benchmarks regardless
- Typical assessment identifies $800K–$2.4M in recoverable revenue
- Implementation timelines: 90 days to first value milestone
`

// ── Sample content — NexusTek BDR Emails ─────────────────────────────────────

const NEXUSTEK_BDR_EMAILS = `
## Cover
Call Scripts and Emails
NexusTek Healthcare
BDR Outreach · 5 Segments · 6 Email Sequences
Internal Use Only

## How to Use
Personalise every [customize with...] bracket before sending. Subject lines and conversation starters are written to work without customisation, but specificity always improves response rates. The Security Assessment is the call to action in every sequence — never pitch a full engagement on cold outreach.

## Contents
- Call Scripts — Subject lines, conversation starters, and voicemail scripts for all five segments
- Email 1 — Physician groups and multi-specialty practices
- Email 2 — Community hospitals and regional health systems
- Email 3 — Outpatient and ambulatory care centres
- Email 4 — Diagnostic labs and imaging centres
- Email 5 — Telehealth and remote care providers
- Email 6 — AI governance — all segments

## Call Scripts
| # | Email / Segment | Conversation Starters | Voicemail Script |
|---|----------------|----------------------|-----------------|
| 1 | Physician groups + multi-specialty | 1. "How are you currently managing IT support across your practice?" 2. "If your EHR went offline today during patient hours, what would happen?" 3. "When your cyber insurance came up for renewal, were there controls you couldn't evidence?" | Hi [First Name], this is [Name] from NexusTek — I sent you a note about managed IT and cybersecurity for physician groups. I'll follow up by email, or call me at [phone] to connect sooner. |
| 2 | Community hospitals + health systems | 1. "How is your internal IT team structured — what security monitoring can you sustain continuously?" 2. "If your team was handling an active incident, what happens to compliance documentation?" 3. "When did you last complete a documented risk analysis against HIPAA Security Rule requirements?" | Hi [First Name], this is [Name] from NexusTek — I reached out about Co-Managed IT and cybersecurity for community hospitals. I'll send a follow-up note, or reach me at [phone] to talk directly. |
| 3 | Outpatient + ambulatory care | 1. "How many sites are you running, and is your IT environment consistent across all of them?" 2. "What does a system outage during operating hours actually cost you?" 3. "Has system downtime affected a full clinical day in the last 12 months?" | Hi [First Name], this is [Name] from NexusTek — I sent you a note about managed IT for outpatient care. I'll follow up by email, or call me at [phone] to connect sooner. |
| 4 | Diagnostic labs + imaging | 1. "How are you managing patching across your PACS systems and imaging workstations?" 2. "If ransomware encrypted your imaging system, what's your recovery plan?" 3. "What does your backup posture look like specifically for imaging data and PACS availability?" | Hi [First Name], this is [Name] from NexusTek — I reached out about managed IT and disaster recovery for diagnostic labs. Over 83% of imaging devices run outdated software. I'll send a follow-up note. |
| 5 | Telehealth + remote care | 1. "How are you managing security across clinician devices and sessions?" 2. "What does your email security and credential protection look like today?" 3. "If a clinician account was compromised, how quickly would you know?" | Hi [First Name], this is [Name] from NexusTek — I sent you a note about cybersecurity for telehealth providers. Phishing targeting clinician credentials is the primary breach vector. I'll follow up by email. |

## Email 1 — Physician groups + multi-specialty practices

**Subject Line:** If your EHR went down during afternoon appointments
**Preview Text:** System downtime during patient hours has an immediate cost.

Hi [First Name],

If your EHR went offline during afternoon appointments today, what would happen — and who handles the response?

Most practices we work with are carrying HIPAA obligations with one or two people managing IT alongside clinical ops, billing, and compliance. Cyber insurance renewals are making that gap increasingly visible.

NexusTek provides managed IT, cybersecurity, and HIPAA-aligned infrastructure for physician groups as a single fixed-cost partner. The entry point is a no-cost Security Assessment — maps your current posture against HIPAA requirements, no commitment required.

[Book your Security Assessment]

Worth 20 minutes?

Best,
[Sign off]

## Email 2 — Community hospitals + regional health systems

**Subject Line:** Your IT team keeps the lights on. Who covers security when an incident hits?
**Preview Text:** Most healthcare IT teams keep operations running. The gap is sustained security and compliance coverage.

Hi [First Name],

When your IT team is managing an active infrastructure incident, what happens to security monitoring and HIPAA compliance documentation at the same time?

For most community hospitals, the honest answer is: those things slip. Not because no one cares — because one team can't cover everything continuously.

NexusTek's Co-Managed IT works alongside your existing team, covering 24/7 SOC monitoring, patch governance, and compliance documentation. Your team keeps the strategic work. We cover the rest.

[Schedule a brief conversation]

Best,
[Sign off]

## Email 3 — Outpatient + ambulatory care centres

**Subject Line:** One hour of downtime during a full schedule
**Preview Text:** For ambulatory care, system availability is a clinical operations metric.

Hi [First Name],

If your scheduling and clinical documentation systems went down for one hour during a full operating day, what would that cost in cancelled procedures, rescheduled patients, and staff time?

For multi-site ambulatory networks, IT that accumulated through growth tends to be uneven across locations — and the cost of an outage compounds fast.

NexusTek provides managed IT and cybersecurity that keeps clinical systems available during operating hours across every site.

[Available to compare approaches?]

Best,
[Sign off]

## Email 6 — AI governance — all segments

**Subject Line:** The problem with AI in healthcare isn't AI — it's the missing governance layer
**Preview Text:** 57% of healthcare orgs say admin automation is their biggest AI opportunity. Most can't deploy it safely.

Hi [First Name],

57% of healthcare organisations say reducing administrative burdens through AI is their biggest opportunity. Most have already explored it — and most hit the same wall: compliance teams blocking deployment because there's no governed layer between clinical data and the AI tools.

NexusTek's Secure AI Platform provides governed access to leading AI models inside a HIPAA-aligned boundary — ePHI never reaches an unmanaged third-party system. Governance built in from day one.

The AI Readiness Assessment identifies your highest-value use cases and what needs to close before safe deployment.

[Request the AI Readiness Assessment]

Worth a conversation?

Best,
[Sign off]
`

const NEXUSTEK_STYLE: DocStyle = {
  primaryColor: '#092648',
  secondaryColor: '#3358FF',
  headingFont: 'Arial',
  bodyFont: 'Arial',
  logoDataUrl: null,
  agencyName: 'ContentNode Preview',
  footerText: 'NexusTek Healthcare · Confidential',
  includeCoverPage: true,
  includePageNumbers: true,
}

// ── Generic DOCX builder (Node-compatible markdownToDocxBlob) ─────────────────

async function buildGenericDocxBuffer(
  markdown: string,
  docStyle: DocStyle,
  assetName: string,
  clientName: string,
  verticalName: string,
): Promise<Buffer> {
  const primaryHex   = hexNoHash(docStyle.primaryColor)
  const secondaryHex = hexNoHash(docStyle.secondaryColor)
  const bodyColor    = '1A1A14'
  const bodyFont     = docStyle.bodyFont
  const headFont     = docStyle.headingFont

  // Check for embedded ## Cover section
  const rawSections = markdown.split(/^(?=## )/m)
  let coverChildren: (Paragraph | Table)[] = []
  let bodyMarkdown = markdown

  if (rawSections.length > 0 && /^## Cover\b/i.test(rawSections[0])) {
    // Generic cover from embedded section (Node-compatible: no logo)
    const coverLines = rawSections[0].split('\n').slice(1).filter(l => l.trim())
    const primary = hexNoHash(docStyle.primaryColor)
    const secondary = hexNoHash(docStyle.secondaryColor)
    const items: Paragraph[] = [new Paragraph({ spacing: { before: 1440 }, children: [] })]
    let count = 0
    for (const raw of coverLines) {
      const text = sanitize(raw.replace(/\*\*/g, '').replace(/^\*|\*$/g, '').trim())
      if (!text) continue
      if (count === 0) items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, font: headFont, size: 52, bold: true, color: 'FFFFFF' })] }))
      else if (count === 1) {
        items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text, font: headFont, size: 40, bold: false, color: 'FFFFFF' })] }))
        items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '─────', font: bodyFont, size: 24, color: secondary })] }))
      } else {
        items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text, font: bodyFont, size: 18, color: 'AAAAAA' })] }))
      }
      count++
    }
    const nilBorder = { style: BorderStyle.NIL } as const
    coverChildren = [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nilBorder, bottom: nilBorder, left: nilBorder, right: nilBorder, insideHorizontal: nilBorder, insideVertical: nilBorder },
      rows: [new TableRow({
        height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT },
        children: [new TableCell({ shading: { fill: primary, type: ShadingType.SOLID, color: primary }, children: items })],
      })],
    })]
    bodyMarkdown = rawSections.slice(1).join('')
  } else if (docStyle.includeCoverPage && assetName) {
    // Standard cover page (Node-compatible: no logo)
    const primary = hexNoHash(docStyle.primaryColor)
    const coverItems: Paragraph[] = [
      new Paragraph({ spacing: { before: 1440 }, children: [] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: assetName, font: headFont, size: 56, bold: true, color: 'FFFFFF' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `${verticalName} · ${clientName}`, font: headFont, size: 28, color: 'DDDDDD' })] }),
    ]
    if (docStyle.agencyName || docStyle.footerText) {
      coverItems.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 720 }, children: [new TextRun({ text: [docStyle.agencyName, docStyle.footerText].filter(Boolean).join('  ·  '), font: bodyFont, size: 18, color: 'AAAAAA' })] }))
    }
    coverChildren = [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
      rows: [new TableRow({
        height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT },
        children: [new TableCell({ shading: { fill: primary, type: ShadingType.SOLID, color: primary }, children: coverItems })],
      })],
    })]
  }

  const STAT_BAR_LINE_RE = /^[-*] \*\*[\d$€£¥%#][^*]*\*\*.*\|/
  const lines = bodyMarkdown.split('\n')
  const children: (Paragraph | Table)[] = []
  let tableLines: string[] = []
  let statBarLines: string[] = []

  function flushStatBar() {
    if (!statBarLines.length) return
    if (statBarLines.length >= 2) children.push(buildStatBar(statBarLines, docStyle))
    else for (const l of statBarLines) children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(l.slice(2), bodyFont, 22, bodyColor) }))
    statBarLines = []
  }
  function flushTable() {
    if (!tableLines.length) return
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    if (dataRows.length) children.push(buildStyledTable(tableLines, docStyle))
    tableLines = []
  }

  for (const line of lines) {
    if (line.startsWith('|')) { flushStatBar(); tableLines.push(line); continue }
    flushTable()
    if (STAT_BAR_LINE_RE.test(line)) { statBarLines.push(line); continue }
    flushStatBar()
    if      (line.startsWith('# '))    children.push(new Paragraph({ style: 'Heading1', children: [new TextRun(sanitize(line.slice(2)))] }))
    else if (line.startsWith('## '))   children.push(new Paragraph({ style: 'Heading2', children: [new TextRun(sanitize(line.slice(3)))] }))
    else if (line.startsWith('### '))  children.push(new Paragraph({ style: 'Heading3', children: [new TextRun(sanitize(line.slice(4)))] }))
    else if (line.startsWith('#### ')) children.push(new Paragraph({ style: 'Heading4', children: [new TextRun(sanitize(line.slice(5)))] }))
    else if (/^[-*] /.test(line))      children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), bodyFont, 22, bodyColor) }))
    else if (line.startsWith('> '))    children.push(new Paragraph({ indent: { left: 720 }, children: parseInlineRuns(line.slice(2), bodyFont, 22, bodyColor) }))
    else if (/^---+$|^===+$/.test(line.trim())) children.push(buildHRule(docStyle.primaryColor))
    else if (line.trim() === '')        children.push(new Paragraph({}))
    else                               children.push(new Paragraph({ children: parseInlineRuns(line, bodyFont, 22, bodyColor) }))
  }
  flushTable()
  flushStatBar()

  const showFooter = docStyle.includePageNumbers || !!docStyle.agencyName || !!docStyle.footerText
  const footers = showFooter ? { default: buildFooterElement(docStyle) } : undefined

  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Normal',   name: 'Normal',   run: { font: bodyFont, size: 22, color: bodyColor } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 48, bold: true, color: primaryHex }, paragraph: { spacing: { before: 240, after: 160 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 36, bold: true, color: primaryHex }, paragraph: { spacing: { before: 200, after: 120 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 28, bold: true, color: secondaryHex }, paragraph: { spacing: { before: 160, after: 80 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: headFont, size: 24, bold: true, color: primaryHex }, paragraph: { spacing: { before: 120, after: 60 } } },
      ],
    },
    numbering: {
      config: [{ reference: 'default-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } }] }],
    },
    sections: [
      ...(coverChildren.length ? [{ properties: { type: SectionType.NEXT_PAGE }, children: coverChildren }] : []),
      { ...(footers ? { footers } : {}), children },
    ],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

// ── Internal Brief builder ────────────────────────────────────────────────────

async function buildInternalBriefBuffer(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Buffer> {
  const primary    = hexNoHash(docStyle.primaryColor)
  const secondary  = hexNoHash(docStyle.secondaryColor)
  const hf         = docStyle.headingFont
  const bf         = docStyle.bodyFont
  const bodyColor  = '1A1A14'
  const mutedColor = '6B7280'
  const lightLine  = { style: BorderStyle.SINGLE, size: 2, color: 'E0E4EC' } as const
  const heavyLine  = { style: BorderStyle.SINGLE, size: 6, color: primary } as const
  const nb         = noBorder()

  function p(text: string, opts: { size?: number; bold?: boolean; italic?: boolean; color?: string; before?: number; after?: number; align?: typeof AlignmentType[keyof typeof AlignmentType]; spacing?: number } = {}): Paragraph {
    return new Paragraph({
      alignment: opts.align,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: opts.spacing },
      children: [new TextRun({ text: sanitize(text), font: bf, size: opts.size ?? 20, bold: opts.bold, italics: opts.italic, color: opts.color ?? bodyColor, characterSpacing: opts.spacing })],
    })
  }

  function sectionHead(text: string): Paragraph {
    return new Paragraph({
      spacing: { before: 360, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: secondary, space: 2 } },
      children: [new TextRun({ text: sanitize(text).toUpperCase(), font: hf, size: 24, bold: true, color: primary, characterSpacing: 30 })],
    })
  }

  function darkBanner(children_: Paragraph[]): Table {
    const nilB = { style: BorderStyle.NIL } as const
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
      rows: [new TableRow({ children: [new TableCell({
        shading: { fill: primary, type: ShadingType.SOLID, color: primary },
        margins: { top: 280, bottom: 280, left: 360, right: 360 },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB },
        children: children_,
      })] })],
    })
  }

  // Pipe table → stat boxes (handles the "Why" section 2-row stat table)
  function pipeTableToStatBar(tableLines: string[]): Table | null {
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    if (dataRows.length < 2) return null
    const stats  = dataRows[0].split('|').slice(1, -1).map(c => c.trim().replace(/\*\*/g, ''))
    const labels = dataRows[1].split('|').slice(1, -1).map(c => c.trim().replace(/\*\*/g, ''))
    if (!stats.length) return null
    const divider = tint(docStyle.primaryColor, 0.2)
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: heavyLine, bottom: heavyLine, left: heavyLine, right: heavyLine, insideHorizontal: nb, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: divider } },
      rows: [new TableRow({ children: stats.map((s, i) => new TableCell({
        margins: { top: 180, bottom: 180, left: 120, right: 120 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s), font: hf, size: 52, bold: true, color: primary })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: sanitize(labels[i] ?? ''), font: bf, size: 19, color: bodyColor })] }),
        ],
      })) })],
    })
  }

  // Styled asset table — first column narrow + navy, second full description
  function buildAssetTable(tableLines: string[]): Table {
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    const assetFill = tint(docStyle.primaryColor, 0.07)
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine, insideHorizontal: lightLine, insideVertical: lightLine },
      rows: dataRows.map((row, ri) => {
        const cells = row.split('|').slice(1, -1).map(c => c.trim().replace(/\*\*/g, ''))
        const isHead = ri === 0
        const makeCell = (text: string, fill: string, pct: number, bold: boolean, color: string, font: string): TableCell =>
          new TableCell({
            width: { size: pct, type: WidthType.PERCENTAGE },
            shading: { fill, type: ShadingType.SOLID, color: fill },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine },
            children: [new Paragraph({ children: [new TextRun({ text: sanitize(isHead ? text.toUpperCase() : text), font, size: 20, bold, color })] })],
          })
        if (isHead) {
          return new TableRow({ tableHeader: true, children: [
            makeCell(cells[0] ?? '', primary, 22, true, 'FFFFFF', hf),
            makeCell(cells[1] ?? '', primary, 78, true, 'FFFFFF', hf),
          ]})
        }
        return new TableRow({ children: [
          makeCell(cells[0] ?? '', assetFill, 22, true,  primary,   hf),
          makeCell(cells[1] ?? '', 'FFFFFF',  78, false, bodyColor, bf),
        ]})
      }),
    })
  }

  // "Where to Start" — two sub-sections side by side in a 2-column table
  function buildWhereToStart(lines: string[]): Table {
    const cols: { heading: string; bullets: string[] }[] = []
    let cur: { heading: string; bullets: string[] } | null = null
    for (const l of lines) {
      const t = l.trim()
      if (/^If You/i.test(t)) { if (cur) cols.push(cur); cur = { heading: t, bullets: [] }; continue }
      if (cur && /^[-*] /.test(t)) { cur.bullets.push(t.slice(2).trim()); continue }
      if (cur && /^\[ListParagraph\]/.test(t)) { cur.bullets.push(t.replace(/^\[ListParagraph\]\s*/, '')); continue }
    }
    if (cur) cols.push(cur)
    const accentFill = tint(docStyle.secondaryColor, 0.06)
    const nilB = { style: BorderStyle.NIL } as const
    const makeCol = (col: { heading: string; bullets: string[] }, i: number): TableCell => {
      const fill = i === 0 ? 'FFFFFF' : accentFill
      return new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        shading: { fill, type: ShadingType.SOLID, color: fill },
        margins: { top: 180, bottom: 180, left: 200, right: 200 },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 6, color: secondary },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: secondary },
          left:   { style: BorderStyle.SINGLE, size: 6, color: secondary },
          right:  { style: BorderStyle.SINGLE, size: 6, color: secondary },
        },
        children: [
          new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: sanitize(col.heading), font: hf, size: 22, bold: true, color: primary })] }),
          ...col.bullets.map(b => new Paragraph({
            spacing: { after: 80 },
            indent: { left: convertInchesToTwip(0.2) },
            children: [
              new TextRun({ text: '• ', font: bf, size: 19, color: secondary }),
              new TextRun({ text: sanitize(b), font: bf, size: 19, color: bodyColor }),
            ],
          })),
        ],
      })
    }
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
      rows: [new TableRow({ children: cols.slice(0, 2).map((c, i) => makeCol(c, i)) })],
    })
  }

  // Key messages: bold headline + body paragraph pairs
  function buildKeyMessages(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    const cardFill = tint(docStyle.primaryColor, 0.06)
    const cardBorder = { style: BorderStyle.SINGLE, size: 4, color: tint(docStyle.primaryColor, 0.25) } as const
    const leftAccent = { style: BorderStyle.SINGLE, size: 8, color: primary } as const
    let headline = '', bodyText = '', inMsg = false
    const flush = () => {
      if (!headline) return
      const nilB = { style: BorderStyle.NIL } as const
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }))
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: [new TableCell({
          shading: { fill: cardFill, type: ShadingType.SOLID, color: cardFill },
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          borders: { top: cardBorder, bottom: cardBorder, left: leftAccent, right: cardBorder },
          children: [
            new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sanitize(headline), font: hf, size: 22, bold: true, color: primary })] }),
            new Paragraph({ spacing: { after: 0 }, children: parseInlineRuns(bodyText.trim(), bf, 20, bodyColor) }),
          ],
        })] })],
      }))
      headline = ''; bodyText = ''
    }
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      if (t.startsWith('**') && t.endsWith('**') && !t.slice(2, -2).includes('\n')) {
        flush(); headline = t.replace(/\*\*/g, '').trim(); inMsg = true; continue
      }
      if (inMsg) bodyText += (bodyText ? ' ' : '') + t.replace(/\*\*/g, '')
    }
    flush()
    return out
  }

  // Non-Negotiable warning box
  function buildNonNeg(lines: string[]): Table {
    const text = lines.filter(l => l.trim()).map(l => l.replace(/\*\*/g, '').trim()).join(' ')
    const nilB = { style: BorderStyle.NIL } as const
    const warnFill = 'FEE2E2'
    const redBorder = { style: BorderStyle.SINGLE, size: 6, color: 'DC2626' } as const
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
      rows: [new TableRow({ children: [new TableCell({
        shading: { fill: warnFill, type: ShadingType.SOLID, color: warnFill },
        margins: { top: 200, bottom: 200, left: 240, right: 240 },
        borders: { top: redBorder, bottom: redBorder, left: redBorder, right: redBorder },
        children: [
          new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: 'ONE NON-NEGOTIABLE', font: hf, size: 20, bold: true, color: 'DC2626' })] }),
          new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: sanitize(text), font: bf, size: 20, color: bodyColor })] }),
        ],
      })] })],
    })
  }

  // Send note email stub
  function buildSendNote(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    let annotation = '', subject = '', bodyLines: string[] = []
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      if (/^For\s+marketing/i.test(t)) { annotation = t; continue }
      if (/^Subject line:/i.test(t)) { subject = t.replace(/^Subject line:\s*/i, '').trim(); continue }
      bodyLines.push(t)
    }
    if (annotation) out.push(p(annotation, { italic: true, color: mutedColor, after: 80 }))
    if (subject) {
      const nilB = { style: BorderStyle.NIL } as const
      const accentFill = tint(docStyle.secondaryColor, 0.08)
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: [
          new TableCell({
            width: { size: 18, type: WidthType.PERCENTAGE },
            shading: { fill: accentFill, type: ShadingType.SOLID, color: accentFill },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine },
            children: [new Paragraph({ children: [new TextRun({ text: 'Subject Line', font: hf, size: 18, bold: true, color: primary })] })],
          }),
          new TableCell({
            width: { size: 82, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine },
            children: [new Paragraph({ children: [new TextRun({ text: sanitize(subject), font: bf, size: 19, color: bodyColor })] })],
          }),
        ]})],
      }))
      out.push(new Paragraph({ spacing: { after: 100 }, children: [] }))
    }
    for (const l of bodyLines) {
      if (l.trim()) out.push(p(l.replace(/\*\*/g, '').trim(), { after: 100 }))
    }
    return out
  }

  // ── Section dispatch ─────────────────────────────────────────────────────────

  const elements: (Paragraph | Table)[] = []
  let coverElements: (Paragraph | Table)[] = []

  const rawSections = markdown.split(/^(?=## )/m)

  for (const sec of rawSections) {
    const secMatch = sec.match(/^## (.+)/m)
    if (!secMatch) continue
    const secName = secMatch[1].trim()
    const secLines = sec.split('\n').slice(1)
    const sn = secName.toLowerCase()

    if (/^cover$/i.test(sn)) {
      const coverLines = secLines.filter(l => l.trim())
      if (!coverLines.length) {
        // Auto-generate cover
        coverElements = [darkBanner([
          new Paragraph({ spacing: { before: 1440, after: 200 }, children: [new TextRun({ text: sanitize(clientName), font: hf, size: 52, bold: true, color: 'FFFFFF' })] }),
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `${sanitize(verticalName).toUpperCase()} + HIPAA`, font: hf, size: 36, color: 'FFFFFF' })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '─────', font: bf, size: 24, color: secondary })] }),
          new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'GTM Launch Brief', font: hf, size: 32, bold: true, color: 'FFFFFF' })] }),
          new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: 'Internal Use Only  ·  Sales + Marketing', font: bf, size: 20, color: 'AAAAAA' })] }),
        ])]
      } else {
        const items: Paragraph[] = [new Paragraph({ spacing: { before: 1440 }, children: [] })]
        let cnt = 0
        for (const raw of coverLines) {
          const text = sanitize(raw.replace(/\*\*/g, '').trim())
          if (!text) continue
          if (cnt === 0) items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, font: hf, size: 52, bold: true, color: 'FFFFFF' })] }))
          else if (cnt === 1) {
            items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text, font: hf, size: 36, color: 'FFFFFF' })] }))
            items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '─────', font: bf, size: 24, color: secondary })] }))
          } else {
            items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text, font: bf, size: 18, color: 'AAAAAA' })] }))
          }
          cnt++
        }
        const nilB = { style: BorderStyle.NIL } as const
        coverElements = [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
          rows: [new TableRow({ height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT }, children: [new TableCell({
            shading: { fill: primary, type: ShadingType.SOLID, color: primary },
            children: items,
          })] })],
        })]
      }
    } else if (/^send note/i.test(sn)) {
      elements.push(...buildSendNote(secLines))
    } else if (/^why this vertical/i.test(sn)) {
      elements.push(sectionHead(secName))
      // Find the pipe table → render as stat boxes
      const tableLines = secLines.filter(l => l.trim().startsWith('|'))
      const nonTableLines = secLines.filter(l => !l.trim().startsWith('|') && l.trim())
      if (tableLines.length) {
        const statTable = pipeTableToStatBar(tableLines)
        if (statTable) elements.push(statTable)
      }
      // Urgency paragraph
      for (const l of nonTableLines) {
        if (l.trim()) elements.push(p(l.replace(/\*\*/g, '').trim(), { before: 160, after: 100 }))
      }
    } else if (/^what'?s? in the kit/i.test(sn)) {
      elements.push(sectionHead(secName))
      const tableLines = secLines.filter(l => l.trim().startsWith('|'))
      const introLine = secLines.find(l => l.trim() && !l.trim().startsWith('|'))
      if (introLine) elements.push(p(introLine.trim(), { after: 120 }))
      if (tableLines.length) elements.push(buildAssetTable(tableLines))
    } else if (/^where to start/i.test(sn)) {
      elements.push(sectionHead(secName))
      elements.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
      elements.push(buildWhereToStart(secLines))
    } else if (/^the .+ cta/i.test(sn) || /^the primary/i.test(sn)) {
      // CTA section: first sentence (hook) + description paragraph → dark banner
      // Case study vignette + quote → body text below banner
      elements.push(sectionHead(secName))
      const bodyParas = secLines.map(l => l.trim()).filter(Boolean)
      // Collect non-empty paragraphs (blank lines separate them)
      const paras: string[] = []
      let cur = ''
      for (const l of secLines) {
        const t = l.trim()
        if (!t) { if (cur) { paras.push(cur); cur = '' } }
        else cur += (cur ? ' ' : '') + t.replace(/\*\*/g, '')
      }
      if (cur) paras.push(cur)
      // First para → hook line in banner (secondary bold), second para → description in banner
      const bannerParas = paras.slice(0, 2)
      const restParas   = paras.slice(2)
      if (bannerParas.length) {
        elements.push(darkBanner([
          new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: sanitize(bannerParas[0]), font: hf, size: 22, bold: true, color: secondary })] }),
          ...(bannerParas[1] ? [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: sanitize(bannerParas[1]), font: bf, size: 20, color: 'DDDDDD' })] })] : []),
        ]))
        elements.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
      }
      for (const para of restParas) {
        if (para.startsWith('> ') || para.startsWith('"')) {
          const quote = para.replace(/^[>"\s]+/, '')
          elements.push(new Paragraph({ spacing: { before: 80, after: 120 }, indent: { left: convertInchesToTwip(0.35) }, border: { left: { style: BorderStyle.SINGLE, size: 8, color: secondary, space: 8 } }, children: [new TextRun({ text: sanitize(quote), font: bf, size: 20, italics: true, color: mutedColor })] }))
        } else {
          elements.push(p(para, { after: 100 }))
        }
      }
    } else if (/^the .+ angle/i.test(sn)) {
      elements.push(sectionHead(secName))
      for (const l of secLines) {
        const t = l.trim()
        if (!t) continue
        elements.push(p(t.replace(/\*\*/g, ''), { after: 100 }))
      }
    } else if (/^key messages/i.test(sn)) {
      elements.push(sectionHead(secName))
      elements.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
      elements.push(...buildKeyMessages(secLines))
    } else if (/^one non.negotiable/i.test(sn)) {
      elements.push(new Paragraph({ spacing: { before: 240, after: 120 }, children: [] }))
      elements.push(buildNonNeg(secLines))
    } else if (/^back cover/i.test(sn)) {
      // skip
    } else {
      // Generic fallback: section heading + body lines
      elements.push(sectionHead(secName))
      for (const l of secLines) {
        const t = l.trim()
        if (!t) { elements.push(new Paragraph({ spacing: { after: 60 }, children: [] })); continue }
        if (t.startsWith('> ')) elements.push(new Paragraph({ indent: { left: convertInchesToTwip(0.35) }, children: [new TextRun({ text: sanitize(t.slice(2)), font: bf, size: 20, italics: true, color: mutedColor })] }))
        else if (/^[-*] /.test(t)) elements.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: parseInlineRuns(t.slice(2), bf, 20, bodyColor) }))
        else elements.push(p(t.replace(/\*\*/g, ''), { after: 100 }))
      }
    }
  }

  // Back cover paragraph after body
  elements.push(new Paragraph({
    pageBreakBefore: true,
    spacing: { before: 0, after: 0 },
    children: [],
  }))
  elements.push(darkBanner([
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1440, after: 160 }, children: [new TextRun({ text: sanitize(clientName), font: hf, size: 52, bold: true, color: 'FFFFFF' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `${sanitize(verticalName).toUpperCase()} + HIPAA  |  GTM LAUNCH BRIEF  |  INTERNAL USE ONLY`, font: hf, size: 20, color: 'AAAAAA' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480 }, children: [new TextRun({ text: `${sanitize(clientName)} Marketing  ·  ${new Date().getFullYear()}`, font: bf, size: 18, color: '888888' })] }),
  ]))

  const doc = new Document({
    styles: { paragraphStyles: [{ id: 'Normal', name: 'Normal', run: { font: bf, size: 20, color: bodyColor } }] },
    sections: [
      ...(coverElements.length ? [{ properties: { type: SectionType.NEXT_PAGE }, children: coverElements }] : []),
      { footers: { default: buildFooterElement(docStyle) }, children: elements },
    ],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

// ── Web Page Copy builder ─────────────────────────────────────────────────────

async function buildWebPageCopyBuffer(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Buffer> {
  const primary    = hexNoHash(docStyle.primaryColor)
  const secondary  = hexNoHash(docStyle.secondaryColor)
  const hf         = docStyle.headingFont
  const bf         = docStyle.bodyFont
  const bodyColor  = '1A1A14'
  const mutedColor = '6B7280'
  const accentFill = tint(docStyle.secondaryColor, 0.08)
  const lightLine  = { style: BorderStyle.SINGLE, size: 2, color: 'E0E4EC' } as const
  const nb         = noBorder()

  function cell(children: (Paragraph | Table)[], opts: {
    pct?: number; fill?: string; top?: boolean; bold?: boolean; valign?: 'top' | 'center' | 'bottom'
  } = {}): TableCell {
    return new TableCell({
      width: opts.pct ? { size: opts.pct, type: WidthType.PERCENTAGE } : undefined,
      shading: opts.fill ? { fill: opts.fill, type: ShadingType.SOLID, color: opts.fill } : undefined,
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      verticalAlign: opts.valign,
      borders: {
        top:    opts.top ? { style: BorderStyle.SINGLE, size: 6, color: secondary } : lightLine,
        bottom: lightLine, left: lightLine, right: lightLine,
      },
      children,
    })
  }

  function para(text: string, opts: { size?: number; bold?: boolean; italic?: boolean; color?: string; align?: typeof AlignmentType[keyof typeof AlignmentType]; before?: number; after?: number } = {}): Paragraph {
    return new Paragraph({
      alignment: opts.align,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 100 },
      children: [new TextRun({ text: sanitize(text), font: bf, size: opts.size ?? 20, bold: opts.bold, italics: opts.italic, color: opts.color ?? bodyColor })],
    })
  }

  function sectionLabel(text: string): Paragraph {
    return new Paragraph({
      spacing: { before: 320, after: 80 },
      children: [new TextRun({ text: sanitize(text).toUpperCase(), font: hf, size: 18, bold: true, color: secondary, characterSpacing: 20 })],
    })
  }

  function sectionHeading(text: string): Paragraph {
    return new Paragraph({
      spacing: { before: 0, after: 140 },
      children: [new TextRun({ text: sanitize(text), font: hf, size: 36, bold: true, color: primary })],
    })
  }

  function darkBanner(children_: (Paragraph | Table)[]): Table {
    const nilB = { style: BorderStyle.NIL } as const
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
      rows: [new TableRow({ children: [new TableCell({
        shading: { fill: primary, type: ShadingType.SOLID, color: primary },
        margins: { top: 280, bottom: 280, left: 360, right: 360 },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB },
        children: children_,
      })] })],
    })
  }

  function pillRow(labels: string[]): Table {
    const w = Math.floor(100 / labels.length)
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nb, bottom: nb, left: nb, right: nb, insideHorizontal: nb, insideVertical: nb },
      rows: [new TableRow({ children: labels.map(lbl => new TableCell({
        width: { size: w, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 140, right: 140 },
        borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine },
        shading: { fill: accentFill, type: ShadingType.SOLID, color: accentFill },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(lbl.replace(/^\[|\]$/g, '')), font: hf, size: 20, bold: true, color: primary })] })],
      })) })],
    })
  }

  function ctaButtonRow(labels: string[]): Table {
    return new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      borders: { top: nb, bottom: nb, left: nb, right: nb, insideHorizontal: nb, insideVertical: nb },
      rows: [new TableRow({ children: labels.map(lbl => new TableCell({
        margins: { top: 100, bottom: 100, left: 180, right: 180 },
        shading: { fill: primary, type: ShadingType.SOLID, color: primary },
        borders: { top: { style: BorderStyle.SINGLE, size: 4, color: primary }, bottom: { style: BorderStyle.SINGLE, size: 4, color: primary }, left: { style: BorderStyle.SINGLE, size: 4, color: primary }, right: { style: BorderStyle.SINGLE, size: 4, color: primary } },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(lbl.replace(/^\[|\]$/g, '')), font: hf, size: 20, bold: true, color: 'FFFFFF' })] })],
      })) })],
    })
  }

  function nBoxTable(boxes: { heading: string; body: string; fill?: string }[]): Table {
    const w = Math.floor(100 / boxes.length)
    const nilB = { style: BorderStyle.NIL } as const
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
      rows: [new TableRow({ children: boxes.map((b, i) => {
        const fill = b.fill ?? (i % 2 === 0 ? 'FFFFFF' : accentFill)
        return new TableCell({
          width: { size: w, type: WidthType.PERCENTAGE },
          shading: { fill, type: ShadingType.SOLID, color: fill },
          margins: { top: 200, bottom: 200, left: 180, right: 180 },
          borders: {
            top:    { style: BorderStyle.SINGLE, size: 8, color: secondary },
            bottom: lightLine, left: lightLine, right: lightLine,
          },
          children: [
            new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: sanitize(b.heading), font: hf, size: 24, bold: true, color: primary })] }),
            new Paragraph({ children: parseInlineRuns(b.body, bf, 20, bodyColor) }),
          ],
        })
      }) })],
    })
  }

  // ── Section renderers ────────────────────────────────────────────────────────

  function renderPageMetadata(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [sectionLabel('Page Metadata'), new Paragraph({ spacing: { after: 80 }, children: [] })]
    const rows: [string, string][] = []
    let currentKey = ''
    for (const l of lines) {
      const kv = l.match(/^\*\*([^*]+)\*\*\s*$/)
      if (kv) { currentKey = kv[1].trim(); continue }
      if (currentKey && l.trim()) {
        rows.push([currentKey, l.replace(/\*\*/g, '').trim()])
        currentKey = ''
      }
    }
    if (rows.length) {
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine, insideHorizontal: lightLine, insideVertical: lightLine },
        rows: rows.map(([k, v]) => new TableRow({ children: [
          cell([para(k, { bold: true, color: primary, size: 20 })], { pct: 22, fill: accentFill }),
          cell([para(v, { size: 19, color: mutedColor })], { pct: 78 }),
        ]})),
      }))
    }
    return out
  }

  function renderHero(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    let headline = '', subHead = '', pills: string[] = [], ctas: string[] = []
    let secondarySub = '', supporting = '', eyebrow = ''
    let phase: 'init' | 'cta' = 'init'
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      if (t.startsWith('# ')) { headline = t.slice(2).trim(); continue }
      if (/^\[.+\]/.test(t) && t.includes('  ') && !headline) continue
      if (/^\[\[.+\]\]/.test(t) || (t.startsWith('[') && t.includes('  ['))) {
        const extracted = [...t.matchAll(/\[([^\]]+)\]/g)].map(m => m[1])
        if (!pills.length && !ctas.length && extracted.length >= 2 && !t.toLowerCase().includes('cta')) {
          pills = extracted; continue
        }
        if (phase === 'cta' || t.toLowerCase().includes('cta') || ctas.length > 0 || /schedule|see client|download|get started/i.test(t)) {
          ctas = extracted; continue
        }
        if (pills.length === 0) { pills = extracted; continue }
        ctas = extracted; continue
      }
      if (/^CTA buttons/i.test(t)) { phase = 'cta'; continue }
      if (/^\*\*\[/.test(t)) {
        const ms = [...t.matchAll(/\[([^\]]+)\]/g)].map(m => m[1])
        if (ms.length >= 2) { pills = ms; continue }
      }
      if (t.startsWith('**') && t.endsWith('**') && !t.slice(2, -2).includes('**')) {
        if (!secondarySub) { secondarySub = t.replace(/\*\*/g, '').trim(); continue }
      }
      if (t.startsWith('*') && t.endsWith('*') && /^[A-Z\s]+$/.test(t.replace(/\*/g, ''))) {
        eyebrow = t.replace(/\*/g, '').trim(); continue
      }
      if (!subHead && headline) { subHead = t.replace(/\*\*/g, ''); continue }
      if (!supporting && secondarySub) { supporting = t.replace(/\*\*/g, ''); continue }
    }
    out.push(new Paragraph({ spacing: { before: 240, after: 0 }, children: [] }))
    out.push(darkBanner([
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: sanitize(headline), font: hf, size: 56, bold: true, color: 'FFFFFF' })] }),
      ...(subHead ? [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: sanitize(subHead), font: bf, size: 22, color: 'DDDDDD' })] })] : []),
    ]))
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    if (pills.length) out.push(pillRow(pills))
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    if (ctas.length) out.push(ctaButtonRow(ctas))
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
    if (secondarySub) out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sanitize(secondarySub), font: hf, size: 28, bold: true, color: primary })] }))
    if (supporting) out.push(para(supporting, { color: mutedColor }))
    if (eyebrow) out.push(new Paragraph({ spacing: { before: 160, after: 0 }, children: [new TextRun({ text: sanitize(eyebrow), font: hf, size: 18, bold: true, color: secondary, characterSpacing: 30 })] }))
    return out
  }

  function renderStats(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [new Paragraph({ spacing: { after: 160 }, children: [] })]
    const statLines = lines.filter(l => /^[-*] \*\*/.test(l))
    const capsLine  = lines.find(l => /^[A-Z][A-Z\s,—\-.]+$/.test(l.trim()) && l.trim().length > 20)
    if (statLines.length) out.push(buildStatBar(statLines, docStyle))
    if (capsLine) out.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: sanitize(capsLine.trim()), font: hf, size: 22, bold: true, color: primary })] }))
    return out
  }

  function render3Box(lines: string[]): (Paragraph | Table)[] {
    const boxes: { heading: string; body: string }[] = []
    let cur: { heading: string; body: string } | null = null
    for (const l of lines) {
      if (l.startsWith('### ')) { if (cur) boxes.push(cur); cur = { heading: l.slice(4).trim(), body: '' } }
      else if (cur && l.trim() && !cur.body) cur.body = l.replace(/\*\*/g, '').trim()
    }
    if (cur) boxes.push(cur)
    if (!boxes.length) return []
    const out: (Paragraph | Table)[] = [new Paragraph({ spacing: { after: 160 }, children: [] })]
    out.push(nBoxTable(boxes.slice(0, 3)))
    return out
  }

  function renderCtaBanner(lines: string[]): (Paragraph | Table)[] {
    let title = '', body_ = '', btn = ''
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      if (!title && t.startsWith('**') && t.endsWith('**')) { title = t.replace(/\*\*/g, ''); continue }
      if (/^\[\[.+\]\]/.test(t) || /^\[.+\]$/.test(t)) { btn = t.replace(/[\[\]]/g, '').trim(); continue }
      if (!body_) { body_ = t.replace(/\*\*/g, ''); continue }
    }
    return [
      new Paragraph({ spacing: { after: 160 }, children: [] }),
      darkBanner([
        ...(title ? [new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: sanitize(title), font: hf, size: 28, bold: true, color: 'FFFFFF' })] })] : []),
        ...(body_  ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: sanitize(body_), font: bf, size: 20, color: 'DDDDDD' })] })] : []),
        ...(btn    ? [new Paragraph({ children: [new TextRun({ text: `[ ${sanitize(btn)} ]`, font: hf, size: 20, bold: true, color: secondary })] })] : []),
      ]),
    ]
  }

  function renderSolutionStack(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    // Section heading + intro
    let heading = '', intro = ''
    for (const l of lines) {
      const t = l.trim()
      if (!t || t.startsWith('###')) break
      if (!heading && t.startsWith('**') && t.endsWith('**')) { heading = t.replace(/\*\*/g, ''); continue }
      if (!intro && heading) { intro = t.replace(/\*\*/g, ''); continue }
    }
    if (heading) out.push(sectionHeading(heading))
    if (intro)   out.push(para(intro, { color: mutedColor, after: 200 }))

    // Parse pillars
    const pillars: { name: string; services: { name: string; desc: string }[] }[] = []
    let curPillar: typeof pillars[0] | null = null
    let curSvc: { name: string; desc: string } | null = null
    let expectingName = false
    for (const l of lines) {
      const t = l.trim()
      if (t.startsWith('### ')) {
        if (curSvc && curPillar) { curPillar.services.push(curSvc); curSvc = null }
        if (curPillar) pillars.push(curPillar)
        curPillar = { name: t.slice(4).trim(), services: [] }
        expectingName = false
        continue
      }
      if (!curPillar) continue
      // Bold pillar-name line is a card divider
      if (t.startsWith('**') && t.endsWith('**') && !t.slice(2, -2).includes('*')) {
        if (curSvc) { curPillar.services.push(curSvc); curSvc = null }
        expectingName = true
        continue
      }
      if (expectingName && t && !curSvc) {
        curSvc = { name: t.replace(/\*\*/g, ''), desc: '' }
        expectingName = false
        continue
      }
      if (curSvc && t && !curSvc.desc) { curSvc.desc = t.replace(/\*\*/g, ''); continue }
      if (curSvc && t && curSvc.desc) { curSvc.desc += ' ' + t.replace(/\*\*/g, '') }
    }
    if (curSvc && curPillar) curPillar.services.push(curSvc)
    if (curPillar) pillars.push(curPillar)

    const nilB = { style: BorderStyle.NIL } as const
    for (const pillar of pillars) {
      out.push(new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }))

      // Header + service cards in a single table so the header spans both columns
      const svcs = pillar.services.slice(0, 4)
      while (svcs.length % 2 !== 0) svcs.push({ name: '', desc: '' })

      const makeCard = (s: { name: string; desc: string }): TableCell => new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        margins: { top: 160, bottom: 160, left: 180, right: 180 },
        shading: s.name ? { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'FFFFFF' } : { fill: 'F9FAFB', type: ShadingType.SOLID, color: 'F9FAFB' },
        borders: { top: lightLine, bottom: lightLine, left: lightLine, right: lightLine },
        children: s.name ? [
          new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sanitize(s.name), font: hf, size: 22, bold: true, color: primary })] }),
          new Paragraph({ children: [new TextRun({ text: sanitize(s.desc), font: bf, size: 20, color: bodyColor })] }),
        ] : [new Paragraph({ children: [] })],
      })

      const cardRows: TableRow[] = []
      for (let i = 0; i < svcs.length; i += 2) {
        cardRows.push(new TableRow({ children: [makeCard(svcs[i]), makeCard(svcs[i + 1])] }))
      }

      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [
          // Header row — single cell spanning both columns
          new TableRow({ children: [new TableCell({
            columnSpan: 2,
            shading: { fill: primary, type: ShadingType.SOLID, color: primary },
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            borders: { top: nilB, bottom: nilB, left: nilB, right: nilB },
            children: [new Paragraph({ children: [new TextRun({ text: sanitize(pillar.name).toUpperCase(), font: hf, size: 22, bold: true, color: 'FFFFFF', characterSpacing: 20 })] })],
          })] }),
          ...cardRows,
        ],
      }))
    }
    return out
  }

  function renderSegments(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    let secHead = '', secIntro = ''
    for (const l of lines) {
      const t = l.trim()
      if (!t || t.startsWith('**SEGMENT') || t.startsWith('###')) break
      if (!secHead && t.startsWith('**') && t.endsWith('**')) { secHead = t.replace(/\*\*/g, ''); continue }
      if (!secIntro && secHead) { secIntro = t.replace(/\*\*/g, ''); continue }
    }
    if (secHead)  out.push(sectionHeading(secHead))
    if (secIntro) out.push(para(secIntro, { color: mutedColor, after: 200 }))

    // Parse segment blocks
    const segs: { num: string; name: string; titles: string; pain: string; delivers: string }[] = []
    let cur: typeof segs[0] | null = null
    for (const l of lines) {
      const t = l.trim()
      const numM = t.match(/^\*\*SEGMENT\s+(\d+)\*\*$/)
      if (numM) {
        if (cur) segs.push(cur)
        cur = { num: numM[1], name: '', titles: '', pain: '', delivers: '' }
        continue
      }
      if (!cur) continue
      if (t.startsWith('### ') && !cur.name) { cur.name = t.slice(4).trim(); continue }
      if (t.startsWith('*') && t.endsWith('*') && !cur.titles) { cur.titles = t.replace(/\*/g, '').trim(); continue }
      if (/^\[ListParagraph\]/.test(t) && !cur.pain) { cur.pain = t.replace(/^\[ListParagraph\]\s*/, '').trim(); continue }
      if (!cur.pain && t && !t.startsWith('*') && !t.startsWith('[') && !t.startsWith('#') && !cur.delivers) {
        if (!cur.pain && cur.titles) { cur.pain = t; continue }
      }
      if (/\bdelivers:/i.test(t)) { cur.delivers = t.replace(/\*\*/g, '').trim(); continue }
    }
    if (cur) segs.push(cur)

    const nilB = { style: BorderStyle.NIL } as const
    for (const seg of segs) {
      out.push(new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }))
      // Header row: SEGMENT N + Name
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: [
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            shading: { fill: secondary, type: ShadingType.SOLID, color: secondary },
            margins: { top: 140, bottom: 140, left: 180, right: 180 },
            borders: { top: nilB, bottom: nilB, left: nilB, right: nilB },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `SEG ${seg.num}`, font: hf, size: 20, bold: true, color: 'FFFFFF' })] })],
          }),
          new TableCell({
            width: { size: 85, type: WidthType.PERCENTAGE },
            shading: { fill: primary, type: ShadingType.SOLID, color: primary },
            margins: { top: 140, bottom: 140, left: 200, right: 180 },
            borders: { top: nilB, bottom: nilB, left: nilB, right: nilB },
            children: [new Paragraph({ children: [new TextRun({ text: sanitize(seg.name), font: hf, size: 22, bold: true, color: 'FFFFFF' })] })],
          }),
        ]})],
      }))
      // Body card
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: [new TableCell({
          shading: { fill: 'F9FAFB', type: ShadingType.SOLID, color: 'F9FAFB' },
          margins: { top: 140, bottom: 140, left: 200, right: 200 },
          borders: { top: lightLine, bottom: lightLine, left: { style: BorderStyle.SINGLE, size: 6, color: secondary }, right: lightLine },
          children: [
            ...(seg.titles ? [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sanitize(seg.titles), font: bf, size: 18, italics: true, color: mutedColor })] })] : []),
            ...(seg.pain ? [new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: sanitize(seg.pain), font: bf, size: 20, color: bodyColor })] })] : []),
            ...(seg.delivers ? [new Paragraph({ children: [new TextRun({ text: sanitize(seg.delivers), font: hf, size: 19, bold: true, color: primary })] })] : []),
          ],
        })]})],
      }))
      out.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [] }))
    }
    return out
  }

  function renderCaseStudies(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    const heading = lines.find(l => l.trim().startsWith('**') && l.trim().endsWith('**') && /proven/i.test(l))
    if (heading) out.push(sectionHeading(heading.replace(/\*\*/g, '').trim()))

    // Parse case study blocks
    const studies: { title: string; situation: string; delivery: string; quote: string; link: string; url: string }[] = []
    let cur: typeof studies[0] | null = null
    let phase: 'none' | 'situation' | 'delivery' = 'none'
    for (const l of lines) {
      const t = l.trim()
      if (/^\*CASE STUDY\*$/i.test(t)) {
        if (cur) studies.push(cur)
        cur = { title: '', situation: '', delivery: '', quote: '', link: '', url: '' }
        phase = 'none'; continue
      }
      if (!cur) continue
      if (t.startsWith('### ') && !cur.title) { cur.title = t.slice(4).trim(); continue }
      if (/^\*\*The situation\*\*/i.test(t)) { phase = 'situation'; continue }
      if (/^\*\*What .+ delivered\*\*/i.test(t)) { phase = 'delivery'; continue }
      if (t.startsWith('> ') || t.startsWith('"')) { cur.quote = t.replace(/^>\s*/, '').replace(/^[""]|[""]$/g, '').trim(); phase = 'none'; continue }
      if (/^\[\[View Full Case Study/i.test(t)) {
        const urlM = t.match(/\]\]\s+(.+)$/)
        if (urlM) cur.url = urlM[1].trim()
        cur.link = 'View Full Case Study →'; phase = 'none'; continue
      }
      if (phase === 'situation' && t && !t.startsWith('**')) cur.situation += (cur.situation ? ' ' : '') + t.replace(/\*\*/g, '')
      if (phase === 'delivery' && t && !t.startsWith('**') && !t.startsWith('"') && !t.startsWith('> ')) cur.delivery += (cur.delivery ? ' ' : '') + t.replace(/\*\*/g, '')
    }
    if (cur) studies.push(cur)

    const nilB = { style: BorderStyle.NIL } as const
    for (const cs of studies.slice(0, 2)) {
      out.push(new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }))
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: [new TableCell({
          shading: { fill: primary, type: ShadingType.SOLID, color: primary },
          margins: { top: 120, bottom: 120, left: 200, right: 200 },
          borders: { top: nilB, bottom: nilB, left: nilB, right: nilB },
          children: [new Paragraph({ children: [
            new TextRun({ text: 'CASE STUDY  ', font: hf, size: 18, bold: true, color: secondary }),
            new TextRun({ text: sanitize(cs.title), font: hf, size: 20, bold: true, color: 'FFFFFF' }),
          ]})],
        })]})],
      }))
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: [new TableCell({
          shading: { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'FFFFFF' },
          margins: { top: 180, bottom: 180, left: 200, right: 200 },
          borders: { top: lightLine, bottom: lightLine, left: { style: BorderStyle.SINGLE, size: 6, color: primary }, right: lightLine },
          children: [
            new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'The situation', font: hf, size: 20, bold: true, color: primary })] }),
            new Paragraph({ spacing: { after: 140 }, children: [new TextRun({ text: sanitize(cs.situation), font: bf, size: 20, color: bodyColor })] }),
            new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `What ${clientName} delivered`, font: hf, size: 20, bold: true, color: primary })] }),
            new Paragraph({ spacing: { after: cs.quote ? 140 : 80 }, children: [new TextRun({ text: sanitize(cs.delivery), font: bf, size: 20, color: bodyColor })] }),
            ...(cs.quote ? [new Paragraph({ spacing: { after: 80 }, indent: { left: convertInchesToTwip(0.3) }, children: [new TextRun({ text: `"${sanitize(cs.quote)}"`, font: bf, size: 20, italics: true, color: mutedColor })] })] : []),
            ...(cs.url ? [new Paragraph({ children: [new TextRun({ text: `${cs.link}  `, font: hf, size: 18, bold: true, color: secondary }), new TextRun({ text: cs.url, font: bf, size: 17, italics: true, color: mutedColor })] })] : []),
          ],
        })]})],
      }))
    }
    return out
  }

  function renderResources(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = []
    const intro = lines.find(l => l.trim() && !l.trim().startsWith('**') && !/^\[\[/.test(l.trim()))
    if (intro) out.push(para(intro.trim(), { color: mutedColor, before: 160 }))

    const cards: { type: string; title: string; desc: string; cta: string }[] = []
    let cur: typeof cards[0] | null = null
    for (const l of lines) {
      const t = l.trim()
      if (/^\*\*(eBOOK|BROCHURE|GUIDE|WHITEPAPER|TEMPLATE)\*\*$/i.test(t)) {
        if (cur) cards.push(cur)
        cur = { type: t.replace(/\*\*/g, ''), title: '', desc: '', cta: '' }; continue
      }
      if (!cur) continue
      if (/^\[\[.+\]\]$/.test(t)) { cur.cta = t.replace(/[\[\]]/g, ''); continue }
      if (!cur.title) { cur.title = t.replace(/\*\*/g, ''); continue }
      if (!cur.desc)  { cur.desc  = t.replace(/\*\*/g, ''); continue }
    }
    if (cur) cards.push(cur)

    const nilB = { style: BorderStyle.NIL } as const
    if (cards.length) {
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }))
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ children: cards.slice(0, 3).map((c, i) => {
          const fill = i % 2 === 0 ? accentFill : 'FFFFFF'
          return new TableCell({
            width: { size: Math.floor(100 / Math.min(cards.length, 3)), type: WidthType.PERCENTAGE },
            shading: { fill, type: ShadingType.SOLID, color: fill },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            borders: { top: { style: BorderStyle.SINGLE, size: 6, color: secondary }, bottom: lightLine, left: lightLine, right: lightLine },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sanitize(c.type), font: hf, size: 18, bold: true, color: secondary, characterSpacing: 20 })] }),
              new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: sanitize(c.title), font: hf, size: 22, bold: true, color: primary })] }),
              new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: sanitize(c.desc), font: bf, size: 19, color: bodyColor })] }),
              new Paragraph({ children: [new TextRun({ text: `[ ${sanitize(c.cta)} ]`, font: hf, size: 19, bold: true, color: secondary })] }),
            ],
          })
        }) })],
      }))
    }
    return out
  }

  function renderWhySection(lines: string[]): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [new Paragraph({ spacing: { after: 160 }, children: [] })]
    const statLines = lines.filter(l => /^[-*] \*\*/.test(l))
    // Cap at 5 — do first 4 as bar, then any remainder as a second bar
    if (statLines.length) {
      out.push(buildStatBar(statLines.slice(0, 4), docStyle))
      if (statLines.length > 4) {
        out.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
        out.push(buildStatBar(statLines.slice(4, 8), docStyle))
      }
    }
    return out
  }

  function renderFinalCta(lines: string[]): (Paragraph | Table)[] {
    let headline = '', body_ = '', ctaLabels: string[] = []
    for (const l of lines) {
      const t = l.trim()
      if (!t) continue
      if (t.startsWith('# ')) { headline = t.slice(2).trim(); continue }
      if (/^\[\[.+\]\]/.test(t) || (t.startsWith('[') && t.includes('  ['))) {
        ctaLabels = [...t.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]); continue
      }
      if (!body_ && headline) { body_ = t.replace(/\*\*/g, ''); continue }
    }
    return [
      new Paragraph({ spacing: { before: 280, after: 0 }, children: [] }),
      darkBanner([
        ...(headline ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: sanitize(headline), font: hf, size: 36, bold: true, color: 'FFFFFF' })] })] : []),
        ...(body_    ? [new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: sanitize(body_), font: bf, size: 20, color: 'DDDDDD' })] })] : []),
        ...(ctaLabels.length ? [new Paragraph({ children: ctaLabels.map((lbl, i) => new TextRun({ text: (i > 0 ? '    ' : '') + `[ ${sanitize(lbl)} ]`, font: hf, size: 20, bold: true, color: secondary })) })] : []),
      ]),
    ]
  }

  // ── Dispatch sections ────────────────────────────────────────────────────────

  const elements: (Paragraph | Table)[] = []
  let coverElements: (Paragraph | Table)[] = []

  const rawSections = markdown.split(/^(?=## )/m)

  for (const sec of rawSections) {
    const secMatch = sec.match(/^## (.+)/m)
    if (!secMatch) continue
    const secName = secMatch[1].trim()
    const secLines = sec.split('\n').slice(1)
    const sn = secName.toLowerCase()

    if (/^cover$/i.test(sn)) {
      // Build cover from generic logic
      const coverLines = secLines.filter(l => l.trim())
      const items: Paragraph[] = [new Paragraph({ spacing: { before: 1440 }, children: [] })]
      let cnt = 0
      for (const raw of coverLines) {
        const text = sanitize(raw.replace(/\*\*/g, '').replace(/^\*|\*$/g, '').trim())
        if (!text) continue
        if (cnt === 0) items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, font: hf, size: 52, bold: true, color: 'FFFFFF' })] }))
        else if (cnt === 1) {
          items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text, font: hf, size: 40, color: 'FFFFFF' })] }))
          items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '─────', font: bf, size: 24, color: secondary })] }))
        } else {
          items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text, font: bf, size: 18, color: 'AAAAAA' })] }))
        }
        cnt++
      }
      const nilB = { style: BorderStyle.NIL } as const
      coverElements = [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
        rows: [new TableRow({ height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT }, children: [new TableCell({
          shading: { fill: primary, type: ShadingType.SOLID, color: primary },
          children: items,
        })] })],
      })]
    } else if (/^page metadata/i.test(sn)) {
      elements.push(...renderPageMetadata(secLines))
    } else if (/^hero/i.test(sn)) {
      elements.push(...renderHero(secLines))
    } else if (/^stats/i.test(sn)) {
      elements.push(...renderStats(secLines))
    } else if (/^3.box|three.box/i.test(sn)) {
      elements.push(...render3Box(secLines))
    } else if (/^cta banner/i.test(sn)) {
      elements.push(...renderCtaBanner(secLines))
    } else if (/^solution stack/i.test(sn)) {
      elements.push(...renderSolutionStack(secLines))
    } else if (/^segments/i.test(sn)) {
      elements.push(...renderSegments(secLines))
    } else if (/^case studies/i.test(sn)) {
      elements.push(...renderCaseStudies(secLines))
    } else if (/^resources/i.test(sn)) {
      elements.push(sectionLabel('Resources'), ...renderResources(secLines))
    } else if (/^why /i.test(sn)) {
      elements.push(sectionLabel(secName), ...renderWhySection(secLines))
    } else if (/^final cta/i.test(sn)) {
      elements.push(...renderFinalCta(secLines))
    } else if (/^back cover/i.test(sn)) {
      // minimal back cover
    }
  }

  const footers = { default: buildFooterElement(docStyle) }
  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Normal', name: 'Normal', run: { font: bf, size: 20, color: bodyColor } },
      ],
    },
    sections: [
      ...(coverElements.length ? [{ properties: { type: SectionType.NEXT_PAGE }, children: coverElements }] : []),
      { footers, children: elements },
    ],
  })
  return Buffer.from(await Packer.toBuffer(doc))
}

// ── Asset manifest ────────────────────────────────────────────────────────────

const ASSET_META = [
  { index: 0, num: '01', name: 'Brochure',          ext: 'docx' },
  { index: 1, num: '02', name: 'eBook',             ext: 'html' },
  { index: 2, num: '03', name: 'Sales Cheat Sheet', ext: 'html' },
  { index: 3, num: '04', name: 'BDR Emails',        ext: 'docx' },
  { index: 4, num: '05', name: 'Customer Deck',     ext: 'pptx' },
  { index: 5, num: '06', name: 'Video Script',      ext: 'docx' },
  { index: 6, num: '07', name: 'Web Page Copy',     ext: 'docx' },
  { index: 7, num: '08', name: 'Internal Brief',    ext: 'docx' },
]

// ── BDR Emails builder (Node-compatible) ─────────────────────────────────────

async function buildBdrEmailsBuffer(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Buffer> {
  const primary    = hexNoHash(docStyle.primaryColor)
  const secondary  = hexNoHash(docStyle.secondaryColor)
  const hf         = docStyle.headingFont
  const bf         = docStyle.bodyFont
  const bodyColor  = '1A1A14'
  const borderCol  = 'E0DEDA'
  const mutedColor = '6B7280'
  const cb = { style: BorderStyle.SINGLE, size: 4, color: borderCol } as const
  const nb = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const

  function buildEmailBlock(lines: string[], emailNum: number | null, segmentName: string): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = []

    // Page break — each email starts on its own page (no-op for the first email at section start)
    elements.push(new Paragraph({ pageBreakBefore: true, children: [] }))

    // Parse subject/preview first so subject line can appear as italic subtitle in header
    let subjectLine = ''
    let previewText = ''
    const bodyLines: string[] = []
    for (const line of lines) {
      const subM = line.match(/^\*\*Subject(?:\s+Line)?[:\*]*\*\*\s*(.+)/i)
      const preM = line.match(/^\*\*Preview(?:\s+Text)?[:\*]*\*\*\s*(.+)/i)
      if (subM) { subjectLine = subM[1].replace(/\*\*/g, '').trim(); continue }
      if (preM) { previewText = preM[1].replace(/\*\*/g, '').trim(); continue }
      bodyLines.push(line)
    }
    if (!subjectLine) {
      let nextIsSubject = false
      const filtered: string[] = []
      for (const line of bodyLines) {
        if (/^#+\s*Subject(?:\s+Line)?$/i.test(line.trim())) { nextIsSubject = true; continue }
        if (nextIsSubject && line.trim()) { subjectLine = sanitize(line.trim()); nextIsSubject = false; continue }
        filtered.push(line)
      }
      if (subjectLine) bodyLines.splice(0, bodyLines.length, ...filtered)
    }

    // Table 1: Email N header — dark background, segment name bold white, subject line italic subtitle
    const headerParas: Paragraph[] = [
      new Paragraph({
        children: [
          ...(emailNum !== null ? [new TextRun({ text: `Email ${emailNum}  `, font: hf, size: 26, bold: true, color: secondary })] : []),
          new TextRun({ text: sanitize(segmentName), font: hf, size: 26, bold: true, color: 'FFFFFF' }),
        ],
      }),
    ]
    if (subjectLine) {
      headerParas.push(new Paragraph({
        children: [new TextRun({ text: sanitize(subjectLine), font: bf, size: 22, italics: true, color: 'AABBCC' })],
      }))
    }
    elements.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: cb, bottom: cb, left: cb, right: cb, insideHorizontal: nb, insideVertical: nb },
      rows: [new TableRow({
        children: [new TableCell({
          width: { size: 100, type: WidthType.PERCENTAGE },
          shading: { fill: primary, type: ShadingType.SOLID, color: primary },
          margins: { top: 120, bottom: 120, left: 200, right: 200 },
          children: headerParas,
        })],
      })],
    }))

    // Separator paragraph — prevents Word from merging the two adjacent tables
    elements.push(new Paragraph({ spacing: { before: 0, after: 0 }, children: [] }))

    // Table 2: Subject Line + Preview Text — white backgrounds, bold dark labels, e0deda borders
    const metaRows: TableRow[] = []
    if (subjectLine) {
      metaRows.push(new TableRow({
        children: [
          new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, shading: { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'FFFFFF' }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: 'Subject Line', font: hf, size: 20, bold: true, color: bodyColor })] })] }),
          new TableCell({ width: { size: 75, type: WidthType.PERCENTAGE }, shading: { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'FFFFFF' }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: [new Paragraph({ children: parseInlineRuns(subjectLine, bf, 20, bodyColor) })] }),
        ],
      }))
    }
    if (previewText) {
      metaRows.push(new TableRow({
        children: [
          new TableCell({ width: { size: 25, type: WidthType.PERCENTAGE }, shading: { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'FFFFFF' }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: 'Preview Text', font: hf, size: 20, bold: true, color: bodyColor })] })] }),
          new TableCell({ width: { size: 75, type: WidthType.PERCENTAGE }, shading: { fill: 'FFFFFF', type: ShadingType.SOLID, color: 'FFFFFF' }, margins: { top: 100, bottom: 100, left: 160, right: 160 }, children: [new Paragraph({ children: [new TextRun({ text: sanitize(previewText), font: bf, size: 20, color: mutedColor })] })] }),
        ],
      }))
    }
    if (metaRows.length) {
      elements.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: cb, bottom: cb, left: cb, right: cb, insideHorizontal: cb, insideVertical: cb },
        rows: metaRows,
      }))
    }

    elements.push(new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }))
    for (const line of bodyLines) {
      if (!line.trim()) {
        elements.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
      } else if (/^\[.+\]$/.test(line.trim())) {
        // Standalone placeholder [Link], [Sign off], etc. — plain italic text
        elements.push(new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: line.trim(), font: bf, size: 22, italics: true, color: secondary })],
        }))
      } else {
        elements.push(new Paragraph({ spacing: { after: 80 }, children: parseInlineRuns(line, bf, 24, bodyColor) }))
      }
    }
    elements.push(new Paragraph({ spacing: { before: 200, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: borderCol, space: 4 } }, children: [] }))
    return elements
  }

  const rawSections = markdown.split(/^(?=## )/m).filter(s => s.trim())
  const sections = rawSections.map(s => {
    const lines = s.split('\n')
    const m = lines[0].match(/^## (.+)/)
    return { name: (m ? m[1] : '').trim().toLowerCase(), title: m ? m[1].trim() : '', lines: lines.slice(1) }
  })

  // Cover (Node-compatible — no logo)
  const coverSection = sections.find(s => s.name === 'cover')
  const coverItems: Paragraph[] = [new Paragraph({ spacing: { before: 1200 }, children: [] })]
  const coverLines = (coverSection?.lines ?? []).filter(l => l.trim())
  coverLines.forEach((raw, i) => {
    const text = sanitize(raw.replace(/\*\*/g, '').trim())
    if (i === 0) coverItems.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, font: hf, size: 52, bold: true, color: 'FFFFFF' })] }))
    else if (i === 1) {
      coverItems.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text, font: hf, size: 40, bold: false, color: 'FFFFFF' })] }))
      coverItems.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '─────', font: bf, size: 24, color: secondary })] }))
    } else {
      coverItems.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text, font: bf, size: i === 2 ? 22 : 18, color: i === 2 ? 'CCCCCC' : 'AAAAAA' })] }))
    }
  })
  const nilB = { style: BorderStyle.NIL } as const
  const coverChildren = [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: nilB, bottom: nilB, left: nilB, right: nilB, insideHorizontal: nilB, insideVertical: nilB },
    rows: [new TableRow({ height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT }, children: [new TableCell({ shading: { fill: primary, type: ShadingType.SOLID, color: primary }, children: coverItems })] })],
  })]

  const body: (Paragraph | Table)[] = []

  function renderGenericLines(lines: string[]) {
    let tbl: string[] = []
    const flush = () => { if (!tbl.length) return; const dr = tbl.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())); if (dr.length) body.push(buildStyledTable(tbl, docStyle)); tbl = [] }
    for (const line of lines) {
      if (line.startsWith('|')) { tbl.push(line); continue }
      flush()
      if (/^[-*] /.test(line)) body.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), bf, 22, bodyColor) }))
      else if (line.trim() === '') body.push(new Paragraph({}))
      else body.push(new Paragraph({ spacing: { after: 80 }, children: parseInlineRuns(line, bf, 22, bodyColor) }))
    }
    flush()
  }

  for (const { name, title, lines } of sections) {
    if (name === 'cover') continue
    const emailMatch = name.match(/^email\s+(\d+)(?:\s*[—\-–:]\s*(.+))?/)
    if (emailMatch) {
      const num = parseInt(emailMatch[1], 10)
      const segment = emailMatch[2]?.trim() ?? title.replace(/^email\s+\d+\s*[—\-–:]\s*/i, '').trim()
      body.push(...buildEmailBlock(lines, num, segment))
      continue
    }
    if (name.includes('how to use') || name.includes('usage')) {
      const calloutBg = tint(docStyle.secondaryColor, 0.08)
      const text = lines.filter(l => l.trim()).join(' ')
      if (text) {
        body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: cb, bottom: cb, left: cb, right: cb, insideHorizontal: nb, insideVertical: nb }, rows: [new TableRow({ children: [new TableCell({ width: { size: 100, type: WidthType.PERCENTAGE }, shading: { fill: calloutBg, type: ShadingType.SOLID, color: calloutBg }, margins: { top: 120, bottom: 120, left: 200, right: 200 }, children: [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'How to use', font: hf, size: 20, bold: true, color: secondary })] }), new Paragraph({ children: parseInlineRuns(text, bf, 20, '4A5568') })] })] })] }))
        body.push(new Paragraph({}))
      }
      continue
    }
    body.push(new Paragraph({ spacing: { before: 320, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, color: borderCol, size: 4, space: 6 } }, children: [new TextRun({ text: sanitize(title), font: hf, size: 32, bold: true, color: primary })] }))
    renderGenericLines(lines)
    body.push(new Paragraph({}))
  }

  const docHeader = new Footer({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: secondary, size: 6, space: 4 } }, spacing: { after: 80 }, children: [new TextRun({ text: `${sanitize(clientName)}  |  ${sanitize(verticalName)}  |  BDR Call Scripts and Emails`, font: hf, size: 18, bold: true, color: primary })] })] })
  const docFooter = new Footer({ children: [new Paragraph({ tabStops: [{ type: 'right' as const, position: 9026 }], border: { top: { style: BorderStyle.SINGLE, color: borderCol, size: 4, space: 4 } }, children: [new TextRun({ text: `${sanitize(clientName)}  |  Call Scripts and Emails  |  Internal Use Only`, font: hf, size: 16, italics: true, color: mutedColor }), new TextRun({ text: '\t', font: hf, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], font: hf, size: 16, color: mutedColor })] })] })

  const doc = new Document({
    styles: { paragraphStyles: [{ id: 'Normal', name: 'Normal', run: { font: bf, size: 22, color: bodyColor } }] },
    sections: [
      { properties: { type: SectionType.NEXT_PAGE }, children: coverChildren },
      { footers: { default: docFooter }, children: body },
    ],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

// ── Entry point ───────────────────────────────────────────────────────────────

function parseStatLine(line: string): { stat: string; label: string; source: string } | null {
  const m = line.match(/^[-*]\s*\*\*\s*([^*]+?)\s*\*\*\s*[—–\-]\s*([^(—–\n]+?)(?:\s*[—–\-]\s*\(([^)]+)\)|\s*\(([^)]+)\))?\s*$/)
  if (!m) return null
  return { stat: m[1].trim(), label: m[2].trim(), source: (m[3] ?? m[4] ?? '').trim() }
}

// ── Customer Deck PPTX builder (Node-compatible) ─────────────────────────────

async function buildCustomerDeckPptxBuffer(markdown: string, docStyle: DocStyle): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const prs = new PptxGenJS()
  prs.layout = 'LAYOUT_WIDE'

  const primary   = docStyle.primaryColor
  const secondary = docStyle.secondaryColor ?? '#4A90D9'
  const pri       = hexNoHash(primary)
  const sec       = hexNoHash(secondary)
  const headFont  = docStyle.headingFont
  const bodyFont  = docStyle.bodyFont
  const cardAccents = [sec, lerpHex(secondary, primary, 0.45), pri, lerpHex(primary, '#000000', 0.25)]

  type Slide = ReturnType<typeof prs.addSlide>

  function logo(slide: Slide) {
    if (docStyle.agencyName) slide.addText(docStyle.agencyName, { x: 10.5, y: 6.95, w: 2.5, h: 0.35, fontSize: 7, color: '999999', fontFace: bodyFont, align: 'right' })
  }
  function whiteHdr(slide: Slide, title: string, sub?: string) {
    slide.background = { color: 'FFFFFF' }
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.09, fill: { color: sec }, line: { color: sec, width: 0 } })
    slide.addText(sanitize(title), { x: 0.4, y: 0.15, w: 10.5, h: 0.72, fontSize: 22, bold: true, color: pri, fontFace: headFont })
    if (sub) slide.addText(sanitize(sub), { x: 0.4, y: 0.87, w: 12.13, h: 0.4, fontSize: 11, color: '5F6B80', fontFace: bodyFont, wrap: true })
  }
  function accBars(slide: Slide) {
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.13, fill: { color: sec }, line: { color: sec, width: 0 } })
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 7.37, w: '100%', h: 0.13, fill: { color: sec }, line: { color: sec, width: 0 } })
  }
  function detect(idx: number, total: number, body: string[]): string {
    if (idx === 0) return 'cover'
    if (idx === total - 1) return 'closing'
    const ne = body.filter(l => l.trim())
    if (ne.some(l => l.includes(' | ') && !l.startsWith('#'))) return 'casestudy'
    if (ne.some(l => l.includes('→'))) return 'ctapaths'
    if (ne.filter(l => parseStatLine(l) !== null).length >= 3) return 'stats'
    if (ne.filter(l => /^[-*]\s*\*\*[^*]+\*\*\s*[—–-][^)]+[·•]/.test(l)).length >= 4) return 'challenges'
    const bh = ne.filter(l => /^\*\*[^*]+\*\*\s*$/.test(l.trim()))
    if (bh.length >= 2) {
      const pillar = ne.some((l, i) => { if (!/^\*\*[^*]+\*\*\s*$/.test(l.trim())) return false; const n = ne[i+1]; return n && !/^[-*]/.test(n) && !/^\*\*/.test(n) })
      return pillar ? 'pillars' : 'frameworks'
    }
    if (ne[0] && /\*\*[^*]+\*\*[^·•]+[·•]/.test(ne[0])) return 'whyus'
    const f = ne[0] ?? ''
    if (!f.startsWith('-') && !f.startsWith('*') && !f.startsWith('#') && f.trim() && ne.slice(1).some(l => /^[-*]\s*\*\*/.test(l))) return 'deepdive'
    return 'bullets'
  }

  function rCover(sl: Slide, t: string, b: string[]) {
    sl.background = { color: pri }; accBars(sl)
    sl.addText(sanitize(t), { x: 0.6, y: 1.6, w: 12.13, h: 2.5, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: headFont, align: 'center', valign: 'middle', wrap: true })
    const s = b.filter(l => l.trim()).map(l => l.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim())
    if (s[0]) sl.addText(sanitize(s[0]), { x: 1.0, y: 3.85, w: 11.33, h: 0.7, fontSize: 16, color: 'DDDDDD', fontFace: bodyFont, align: 'center', valign: 'middle', wrap: true })
    if (s[1]) sl.addText(sanitize(s[1]), { x: 1.0, y: 4.65, w: 11.33, h: 0.45, fontSize: 12, color: 'AAAAAA', fontFace: bodyFont, align: 'center' })
    logo(sl)
  }
  function rClosing(sl: Slide, t: string, b: string[]) {
    sl.background = { color: pri }; accBars(sl)
    sl.addText(sanitize(t), { x: 0.6, y: 0.8, w: 12.13, h: 2.0, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: headFont, align: 'center', valign: 'middle', wrap: true })
    let oy = 3.1
    b.filter(l => l.trim()).slice(0, 5).forEach(l => {
      const raw = l.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').replace(/\*\*/g, '').trim()
      sl.addText(sanitize(raw), { x: 0.6, y: oy, w: 12.13, h: 0.55, fontSize: 13, color: /→|http|www/.test(raw) ? sec : 'DDDDDD', fontFace: bodyFont, align: 'center', wrap: true })
      oy += 0.58
    })
    logo(sl)
  }
  function rStats(sl: Slide, t: string, b: string[]) {
    sl.background = { color: pri }
    sl.addText(sanitize(t), { x: 0.4, y: 0.22, w: 12.53, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: headFont })
    const stats = b.filter(l => parseStatLine(l) !== null).slice(0, 4)
    const narr = b.filter(l => l.trim() && !parseStatLine(l) && !l.startsWith('#')).map(l => l.replace(/^[-*> ]+/, '').trim()).join(' ')
    if (narr) sl.addText(sanitize(narr), { x: 0.4, y: 0.9, w: 12.53, h: 0.42, fontSize: 11, color: 'AABBCC', fontFace: bodyFont, wrap: true })
    const gX = 0.25, gY = 0.22, cW = (12.53-gX)/2, cH = (5.45-gY)/2, sY = 1.42
    stats.forEach((line, i) => {
      const p = parseStatLine(line)!
      const cx = 0.4+(i%2)*(cW+gX), cy = sY+Math.floor(i/2)*(cH+gY), acc = cardAccents[i%4]
      sl.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: lighten(pri,0.12) }, line: { color: lighten(pri,0.2), width: 0.5 } })
      sl.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: 0.12, h: cH, fill: { color: acc }, line: { color: acc, width: 0 } })
      sl.addText(sanitize(p.stat), { x: cx+0.25, y: cy+0.2, w: cW-0.35, h: cH*0.52, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: headFont, valign: 'middle' })
      sl.addText(sanitize(p.label), { x: cx+0.25, y: cy+cH*0.6, w: cW-0.35, h: cH*0.24, fontSize: 11, color: 'AABBCC', fontFace: bodyFont, wrap: true })
      if (p.source) sl.addText(sanitize(p.source), { x: cx+0.25, y: cy+cH*0.84, w: cW-0.35, h: cH*0.16, fontSize: 9, color: '778899', fontFace: bodyFont })
    }); logo(sl)
  }
  function rChallenges(sl: Slide, t: string, b: string[]) {
    sl.background = { color: pri }
    sl.addText(sanitize(t), { x: 0.4, y: 0.15, w: 12.53, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: headFont })
    const items = b.filter(l => /^[-*]\s*\*\*[^*]+\*\*/.test(l)).slice(0, 6).map(l => {
      const m = l.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*([^·•]+?)(?:\s*[·•]\s*(.+))?$/)
      return m ? { name: m[1].trim(), desc: m[2].trim(), pillar: m[3]?.trim()??'' } : null
    }).filter(Boolean) as { name:string; desc:string; pillar:string }[]
    const gap=0.22, cW=(12.53-gap*2)/3, cH=(7.25-0.88-gap)/2
    items.forEach((ch, i) => {
      const cx=0.4+(i%3)*(cW+gap), cy=0.88+Math.floor(i/3)*(cH+gap), acc=cardAccents[i%4]
      sl.addShape(prs.ShapeType.rect, { x:cx, y:cy, w:cW, h:cH, fill:{color:lighten(pri,0.12)}, line:{color:lighten(pri,0.2),width:0.5} })
      sl.addShape(prs.ShapeType.rect, { x:cx, y:cy, w:cW, h:0.08, fill:{color:acc}, line:{color:acc,width:0} })
      sl.addText(sanitize(ch.name), { x:cx+0.18, y:cy+0.15, w:cW-0.28, h:0.5, fontSize:14, bold:true, color:'FFFFFF', fontFace:headFont })
      sl.addText(sanitize(ch.desc), { x:cx+0.18, y:cy+0.72, w:cW-0.28, h:cH-1.1, fontSize:11, color:'AABBCC', fontFace:bodyFont, wrap:true, valign:'top' })
      if (ch.pillar) sl.addText(sanitize(ch.pillar), { x:cx+0.18, y:cy+cH-0.42, w:cW-0.28, h:0.35, fontSize:9, color:sec, fontFace:bodyFont })
    }); logo(sl)
  }
  function rFrameworks(sl: Slide, t: string, b: string[]) {
    const sub = b.find(l => !l.startsWith('**') && !l.startsWith('-') && l.trim() && !l.startsWith('#'))
    whiteHdr(sl, t, sub)
    const blocks: { name:string; bullets:string[] }[] = []; let cur: typeof blocks[0]|null = null
    for (const l of b) { const hm=l.trim().match(/^\*\*([^*]+)\*\*\s*$/); if(hm){if(cur)blocks.push(cur);cur={name:hm[1].trim(),bullets:[]}} else if(cur&&/^[-*] /.test(l))cur.bullets.push(l.replace(/^[-*] /,'').replace(/\*\*/g,'').trim()) }
    if(cur)blocks.push(cur)
    const cY=sub?1.35:1.05, gap=0.22, cW=(12.53-gap)/2, cH=(7.25-cY-gap)/2
    blocks.slice(0,4).forEach((bk,i)=>{
      const cx=0.4+(i%2)*(cW+gap), cy=cY+Math.floor(i/2)*(cH+gap), acc=cardAccents[i%4]
      sl.addShape(prs.ShapeType.rect, {x:cx,y:cy,w:cW,h:cH,fill:{color:'F0F2FA'},line:{color:'E2E6F0',width:0.5}})
      sl.addShape(prs.ShapeType.rect, {x:cx,y:cy,w:0.1,h:cH,fill:{color:acc},line:{color:acc,width:0}})
      sl.addText(sanitize(bk.name), {x:cx+0.22,y:cy+0.15,w:cW-0.32,h:0.48,fontSize:14,bold:true,color:pri,fontFace:headFont})
      if(bk.bullets.length) sl.addText(bk.bullets.slice(0,4).map(bt=>({text:sanitize(bt),options:{bullet:true as const,color:'374151' as string,fontFace:bodyFont}})),{x:cx+0.22,y:cy+0.7,w:cW-0.32,h:cH-0.85,fontSize:11,valign:'top',wrap:true})
    }); logo(sl)
  }
  function rPillars(sl: Slide, t: string, b: string[]) {
    whiteHdr(sl, t)
    const blocks: { name:string; vp:string; svcs:string[] }[] = []; let cur: typeof blocks[0]|null=null
    for (const l of b) {
      const hm = l.trim().match(/^\*\*([^*]+)\*\*\s*$/)
      if (hm) {
        if (cur) blocks.push(cur)
        cur = { name: hm[1].trim(), vp: '', svcs: [] }
      } else if (cur && /^[-*] /.test(l)) {
        cur.svcs.push(l.replace(/^[-*] /, '').replace(/\*\*/g, '').trim())
      } else if (cur && l.trim() && !cur.vp) {
        cur.vp = l.replace(/\*\*/g, '').trim()
      }
    }
    if(cur)blocks.push(cur)
    const gap=0.22, cW=(12.53-gap)/2, cH=(7.25-1.05-gap)/2
    blocks.slice(0,4).forEach((bk,i)=>{
      const cx=0.4+(i%2)*(cW+gap), cy=1.05+Math.floor(i/2)*(cH+gap), bg=cardAccents[i%4]
      sl.addShape(prs.ShapeType.rect, {x:cx,y:cy,w:cW,h:cH,fill:{color:bg},line:{color:bg,width:0}})
      sl.addText(sanitize(bk.name.toUpperCase()), {x:cx+0.22,y:cy+0.18,w:cW-0.35,h:0.36,fontSize:11,bold:true,color:'FFFFFF',fontFace:headFont})
      if(bk.vp) sl.addText(sanitize(bk.vp), {x:cx+0.22,y:cy+0.58,w:cW-0.35,h:0.75,fontSize:12,color:'DDDDDD',fontFace:bodyFont,wrap:true})
      if(bk.svcs.length) sl.addText(bk.svcs.slice(0,4).map(s=>({text:`• ${sanitize(s)}`,options:{color:'CCCCCC' as string,fontFace:bodyFont,fontSize:10 as const}})),{x:cx+0.22,y:cy+1.42,w:cW-0.35,h:cH-1.62,valign:'top',wrap:true})
    }); logo(sl)
  }
  function rDeepDive(sl: Slide, t: string, b: string[]) {
    const ne=b.filter(l=>l.trim()), subH=ne[0]?.replace(/^[-*#> ]+/,'').trim()??'', bullets=ne.slice(1).filter(l=>/^[-*]/.test(l)).slice(0,4)
    sl.background={color:pri}
    sl.addText(sanitize(t.toUpperCase()), {x:0.4,y:0.22,w:6.0,h:0.55,fontSize:18,bold:true,color:sec,fontFace:headFont})
    if(subH) sl.addText(sanitize(subH), {x:0.4,y:0.88,w:12.53,h:0.72,fontSize:24,bold:true,color:'FFFFFF',fontFace:headFont,wrap:true})
    const feats=bullets.map(bul=>{const m=bul.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*(.+)$/);return m?{title:m[1].trim(),desc:m[2].trim()}:{title:'',desc:bul.replace(/^[-*]\s*/,'').replace(/\*\*/g,'').trim()}})
    if(feats.length){const cols=feats.length<=3?feats.length:4, gap=0.2, cW=(12.53-gap*(cols-1))/cols, cH=7.25-1.85-0.25
      feats.forEach((f,i)=>{const cx=0.4+i*(cW+gap), cy=1.85
        sl.addShape(prs.ShapeType.rect,{x:cx,y:cy,w:cW,h:cH,fill:{color:lighten(pri,0.12)},line:{color:lighten(pri,0.2),width:0.5}})
        sl.addShape(prs.ShapeType.rect,{x:cx,y:cy,w:0.08,h:cH,fill:{color:sec},line:{color:sec,width:0}})
        if(f.title) sl.addText(sanitize(f.title),{x:cx+0.18,y:cy+0.18,w:cW-0.28,h:0.55,fontSize:13,bold:true,color:'FFFFFF',fontFace:headFont,wrap:true})
        sl.addText(sanitize(f.desc),{x:cx+0.18,y:cy+(f.title?0.82:0.22),w:cW-0.28,h:cH-(f.title?1.0:0.4),fontSize:11,color:'AABBCC',fontFace:bodyFont,wrap:true,valign:'top'})
      })}
    logo(sl)
  }
  function rWhyUs(sl: Slide, t: string, b: string[]) {
    whiteHdr(sl, t); const ne=b.filter(l=>l.trim())
    const sm=[...( ne[0]??'').matchAll(/\*\*([^*]+)\*\*\s*([^·•*]+)/g)]
    if(sm.length){const items=sm.slice(0,5).map(m=>({stat:m[1].trim(),label:m[2].trim().replace(/[·•,]$/,'').trim()})), bW=Math.min(2.4,(12.53-0.6)/items.length-0.15)
      items.forEach((s,i)=>{const bx=0.4+i*(bW+0.18)
        sl.addShape(prs.ShapeType.rect,{x:bx,y:1.05,w:bW,h:0.72,fill:{color:tint(secondary,0.1)},line:{color:tint(secondary,0.3),width:0.5}})
        sl.addText(sanitize(s.stat),{x:bx+0.05,y:1.08,w:bW-0.1,h:0.39,fontSize:17,bold:true,color:sec,fontFace:headFont,align:'center'})
        sl.addText(sanitize(s.label),{x:bx+0.05,y:1.47,w:bW-0.1,h:0.28,fontSize:8,color:'5F6B80',fontFace:bodyFont,align:'center'})
      })}
    const diffs=ne.slice(1).filter(l=>/^[-*]\s*\*\*/.test(l)).slice(0,6), gap=0.2, cW=(12.53-gap)/2, cH=0.9
    diffs.forEach((d,i)=>{const m=d.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*(.+)$/), lbl=m?m[1].trim():'', dsc=m?m[2].trim():d.replace(/^[-*]\s*/,'').replace(/\*\*/g,'').trim()
      const cx=0.4+(i%2)*(cW+gap), cy=1.92+Math.floor(i/2)*(cH+0.14)
      sl.addShape(prs.ShapeType.rect,{x:cx,y:cy,w:cW,h:cH,fill:{color:'F0F2FA'},line:{color:'E2E6F0',width:0.5}})
      sl.addShape(prs.ShapeType.rect,{x:cx,y:cy,w:0.1,h:cH,fill:{color:sec},line:{color:sec,width:0}})
      sl.addText(lbl?[{text:`${sanitize(lbl)}  `,options:{bold:true,color:pri,fontFace:headFont,fontSize:12 as const}},{text:sanitize(dsc),options:{bold:false,color:'374151',fontFace:bodyFont,fontSize:11 as const}}]:[{text:sanitize(dsc),options:{bold:false,color:'374151',fontFace:bodyFont,fontSize:11 as const}}],{x:cx+0.22,y:cy+0.12,w:cW-0.32,h:cH-0.24,valign:'middle',wrap:true,fontSize:11})
    }); logo(sl)
  }
  function rCaseStudy(sl: Slide, t: string, b: string[]) {
    whiteHdr(sl, t); const pl=b.filter(l=>l.includes('|')&&l.trim())
    let hdrs=['Situation','What We Delivered','Outcomes']
    const hRow=pl.find(l=>/\*\*/.test(l)); if(hRow){const pts=hRow.split('|').map(p=>p.replace(/\*\*/g,'').replace(/^[-*·\s]+/,'').trim()).filter(Boolean); if(pts.length>=3)hdrs=pts.slice(0,3)}
    const c3:[string[],string[],string[]]=[[], [], []]
    pl.filter(l=>!/^\s*\*\*/.test(l)).forEach(l=>{const pts=l.split(' | ').map(p=>p.replace(/^[-*·\s]+/,'').replace(/·?\s*$/,'').replace(/\*\*/g,'').trim()).filter(Boolean); if(pts.length>=3){c3[0].push(pts[0]);c3[1].push(pts[1]);c3[2].push(pts[2])}})
    const gap=0.25,cW=(12.53-gap*2)/3,hH=0.55,cY=1.1,bH=7.25-cY-hH-0.15, accs=[sec,cardAccents[1],cardAccents[2]]
    hdrs.forEach((h,col)=>{const cx=0.4+col*(cW+gap)
      sl.addShape(prs.ShapeType.rect,{x:cx,y:cY,w:cW,h:hH,fill:{color:accs[col]??sec},line:{color:accs[col]??sec,width:0}})
      sl.addText(sanitize(h),{x:cx+0.15,y:cY+0.07,w:cW-0.2,h:hH-0.14,fontSize:13,bold:true,color:'FFFFFF',fontFace:headFont,valign:'middle'})
      sl.addShape(prs.ShapeType.rect,{x:cx,y:cY+hH,w:cW,h:bH,fill:{color:'F5F7FA'},line:{color:'E2E6F0',width:0.5}})
      c3[col].slice(0,4).forEach((txt,ri)=>sl.addText(`• ${sanitize(txt)}`,{x:cx+0.15,y:cY+hH+0.15+ri*1.35,w:cW-0.25,h:1.2,fontSize:11,color:'374151',fontFace:bodyFont,wrap:true,valign:'top'}))
    }); logo(sl)
  }
  function rCtaPaths(sl: Slide, t: string, b: string[]) {
    const sub=b.find(l=>!l.startsWith('-')&&!l.startsWith('*')&&l.trim()&&!l.startsWith('#')); whiteHdr(sl,t,sub)
    const paths:{ name:string;trigger:string;cta:string;url:string }[]=[];let cur:typeof paths[0]|null=null
    for(const l of b){if(/^[-*]\s*\*\*[^*]+\*\*/.test(l)&&!l.includes('→')){if(cur)paths.push(cur);const m=l.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*(.+)$/);cur={name:m?m[1].trim():'',trigger:m?m[2].trim():'',cta:'',url:''}}else if(l.includes('→')&&cur){const m=l.trim().match(/→\s*([^—–]+?)(?:\s*[—–]\s*(.+))?$/);if(m){cur.cta=m[1].trim();cur.url=m[2]?.trim()??''}}}
    if(cur)paths.push(cur)
    const sY=sub?1.38:1.08, gap=0.22, cW=(12.53-gap)/2, cH=sub?2.45:2.7
    paths.slice(0,4).forEach((p,i)=>{const cx=0.4+(i%2)*(cW+gap),cy=sY+Math.floor(i/2)*(cH+gap),acc=cardAccents[i%4]
      sl.addShape(prs.ShapeType.rect,{x:cx,y:cy,w:cW,h:cH,fill:{color:'F5F7FA'},line:{color:'E2E6F0',width:0.5}})
      sl.addShape(prs.ShapeType.rect,{x:cx,y:cy,w:cW,h:0.09,fill:{color:acc},line:{color:acc,width:0}})
      sl.addText(sanitize(p.name),{x:cx+0.18,y:cy+0.18,w:cW-0.28,h:0.52,fontSize:14,bold:true,color:pri,fontFace:headFont,wrap:true})
      if(p.trigger) sl.addText(sanitize(p.trigger),{x:cx+0.18,y:cy+0.76,w:cW-0.28,h:0.7,fontSize:11,color:'5F6B80',fontFace:bodyFont,wrap:true})
      if(p.cta){const ctaY=cy+cH-0.65;sl.addShape(prs.ShapeType.rect,{x:cx+0.18,y:ctaY,w:cW-0.36,h:0.45,fill:{color:acc},line:{color:acc,width:0}});sl.addText(`${sanitize(p.cta)}${p.url?`  ·  ${sanitize(p.url)}`:''}`,{x:cx+0.18,y:ctaY,w:cW-0.36,h:0.45,fontSize:10,bold:true,color:'FFFFFF',fontFace:headFont,align:'center',valign:'middle'})}
    }); logo(sl)
  }
  function rBullets(sl: Slide, t: string, b: string[]) {
    whiteHdr(sl, t)
    const items=b.filter(l=>l.trim()&&!l.startsWith('#')).map(l=>{const iB=/^[-*] /.test(l), raw=sanitize(iB?l.slice(2):l).trim(); return raw.includes('**')?raw.split(/\*\*/).map((p,pi)=>({text:p,options:{bullet:iB&&pi===0,bold:pi%2===1,color:'1A1A14' as string,fontFace:bodyFont}})):[{text:raw,options:{bullet:iB,bold:false,color:'1A1A14' as string,fontFace:bodyFont}}]}).flat()
    if(items.length) sl.addText(items,{x:0.4,y:1.05,w:12.53,h:6.0,fontSize:13,valign:'top',wrap:true})
    logo(sl)
  }

  const bks = markdown.split(/(?=^## Slide \d+:)/m).filter(b => b.trim())
  if (!bks.length) {
    const sl = prs.addSlide(); sl.background = { color: 'FFFFFF' }
    sl.addText(sanitize(markdown.substring(0, 800)), { x: 0.4, y: 0.5, w: 12.2, h: 6, fontSize: 12, fontFace: bodyFont, valign: 'top', wrap: true })
  } else {
    bks.forEach((blk, idx) => {
      const tm = blk.match(/^## Slide \d+:\s*(.+)/), title = tm ? tm[1].trim() : ''
      const body = blk.split('\n').slice(1), layout = detect(idx, bks.length, body), sl = prs.addSlide()
      switch (layout) {
        case 'cover': rCover(sl,title,body); break; case 'closing': rClosing(sl,title,body); break
        case 'stats': rStats(sl,title,body); break; case 'challenges': rChallenges(sl,title,body); break
        case 'frameworks': rFrameworks(sl,title,body); break; case 'pillars': rPillars(sl,title,body); break
        case 'deepdive': rDeepDive(sl,title,body); break; case 'whyus': rWhyUs(sl,title,body); break
        case 'casestudy': rCaseStudy(sl,title,body); break; case 'ctapaths': rCtaPaths(sl,title,body); break
        default: rBullets(sl,title,body)
      }
    })
  }
  return Buffer.from(await prs.write({ outputType: 'arraybuffer' }) as ArrayBuffer)
}

// ── Sample content for Customer Deck ─────────────────────────────────────────

const NEXUSTEK_CUSTOMER_DECK = `## Slide 1: IT That Keeps Care Moving.
- Managed IT, cybersecurity, and private cloud for healthcare organisations that need HIPAA-aligned, always-on infrastructure.
- NexusTek Healthcare  ·  Healthcare + HIPAA

## Slide 2: Market Pressure
- **57.5%** — Providers hit directly — (The HIPAA Journal, 2026)
- **$7.42M** — Average breach cost — (IBM, 2025)
- **279 days** — Avg. time to detect breach — (IBM, 2025)
- **73%** — Healthcare IT on legacy infrastructure — (Profound Logic, 2025)
Healthcare IT carries the highest breach exposure of any sector.

## Slide 3: The Challenges
- **Cyber Resilience** — 57.5% of breaches hit providers directly · Cybersecurity
- **Compliance + Auditability** — MFA and encryption now mandatory · Compliance
- **IT Staffing Gap** — 61% say shortages impact work directly · IT Operations
- **Legacy Modernisation** — 73% of systems cannot be patched safely · Infrastructure
- **Unpredictable IT Costs** — Breach response consumes clinical budgets · Cost Management
- **AI Readiness** — PHI governance stops most AI pilots · Data and AI

## Slide 4: Compliance and Regulatory
**HIPAA Security Rule**
- MFA and encryption now mandatory
- Annual risk analysis required
- Full audit logging required
**NIST CSF 2.0 + HPH CPGs**
- Cross-org cybersecurity risk ownership
- Cyber insurers reference HPH CPGs
- NIST CSF 2.0 Govern function required
**HIPAA Breach Notification**
- 60-day notification window required
- Breaches averaged 279 days to detect
- MDR and SOC monitoring closes gap
**NIST AI Risk Management**
- PHI creates HIPAA exposure in AI
- Governed infrastructure layer required
- AI Readiness Assessment maps the path
NexusTek implements and manages the controls these frameworks require.

## Slide 5: Our Four Pillars
**Cloud and Infrastructure**
HIPAA-aligned, always-on infrastructure without building internal IT.
- Private Cloud
- Disaster Recovery as a Service
- Hybrid Architecture

**Cybersecurity**
24/7 protection built for healthcare's threat environment.
- MDR + 24/7 SOC
- Security Assessment
- vCISO

**IT Operations**
The IT team healthcare organisations need.
- Managed IT
- Co-Managed IT
- NexusOps Platform

**Data and AI**
Governed AI adoption inside HIPAA boundaries.
- Secure AI Platform
- AI Readiness Assessment
- GPU Private Cloud

## Slide 6: Cloud and Infrastructure
HIPAA-aligned private cloud keeping clinical operations continuously available.
- **99.9% uptime SLA** — Clinical operations stay online
- **100% migration success rate** — Zero disruption to patient care
- **Fixed-cost billing** — No variable egress charges or surprises
- **Disaster recovery built-in** — Ransomware contained, not catastrophic

## Slide 7: Cybersecurity
24/7 protection. Healthcare accounts for 57.5% of all sector breaches.
- **MDR + 24/7 SOC** — Sub-hour response, AI-powered detection
- **AI Email Security** — Stops phishing at the primary breach vector
- **MFA + IAM** — Mandatory under OCR's proposed HIPAA updates
- **Security Assessment** — Maps posture against HIPAA, NIST, HPH CPGs
- **vCISO Services** — CISO-level leadership without full-time hire cost

## Slide 8: IT Operations
Proactive managed IT built on NexusOps, our AI-powered delivery platform.
- **97% triage accuracy** — NexusOps with NexusIQ automated diagnosis
- **Root cause 90% faster** — Automated root cause at scale
- **180 hours saved per month** — Structural staffing gap answer
- **vCIO on demand** — Strategy and vendor management included

## Slide 9: Data and AI
Governed AI adoption — ePHI inside a HIPAA-aligned boundary.
- **Secure AI Platform** — ePHI never reaches unmanaged third-party AI
- **AI Readiness Assessment** — Maps use cases and governance gaps
- **GPU Private Cloud** — Inferencing in NexusTek's controlled environment
- **EHF Case Study** — Research time reduced 5x with governed AI

## Slide 10: Why Us
**30+** Years IT Experience · **98%** Client Satisfaction · **1,200+** Active Clients · **~6yr** Avg. Relationship · **100+** Partnerships
- **HIPAA-Aligned Infrastructure** — Tier 4/5 Private Cloud, not public cloud with a healthcare add-on.
- **Compliance Under One Partner** — Security, Cloud, MDR, DRaaS, vCISO — one contract.
- **Structural Staffing Answer** — NexusOps: 97% triage accuracy, root cause 90% faster.
- **100% Migration Success** — Sequenced by clinical risk. Zero disruption to patient care.
- **Governed Path to AI** — ePHI inside HIPAA-aligned boundary. EHF: research time cut 5x.
- **Executive Security On Demand** — vCISO at CISO-level function without full-time cost.

## Slide 11: Case Study — Episcopal Health Foundation
**Situation** | **What We Delivered** | **Outcomes**
- Texas health equity nonprofit · | - Custom AI on Private Cloud · | - Research time cut 5x ·
- Research data outpacing team · | - HIPAA governance built-in · | - From 5-10 hrs to 1-2 hrs ·
- Strict data governance required · | - Managed infrastructure layer · | - Production-ready from day one ·

## Slide 12: Case Study — Mid-Market Healthcare Client
**Situation** | **What We Delivered** | **Outcomes**
- 279-day breach detection risk · | - MDR + 24/7 SOC deployment · | - Detection under 1 hour ·
- Legacy infrastructure exposure · | - HIPAA-aligned Private Cloud · | - Zero clinical disruption ·
- Cyber insurance renewal at risk · | - Security Assessment + vCISO · | - Insurance renewed successfully ·

## Slide 13: Your Path Forward
- **IT + Security Assessment** — Current posture mapped to HIPAA, NIST CSF 2.0, HPH CPGs.
  → Schedule Assessment — nexustek.com/healthcare/security-assessment
- **Cloud Readiness Assessment** — For organisations at infrastructure refresh cycles.
  → Cloud Assessment — nexustek.com/healthcare/cloud
- **Cybersecurity Risk Review** — For post-incident or high-risk environments.
  → Risk Review — nexustek.com/healthcare/cyber
- **AI Readiness Assessment** — Maps use cases and governance gaps before deployment.
  → AI Assessment — nexustek.com/healthcare/ai

## Slide 14: IT That Keeps Care Moving.
- Managed IT, cybersecurity, and private cloud for healthcare organisations that need HIPAA-aligned, always-on infrastructure.
- **Proof:** 99.9% Uptime SLA · 100% Migration Success · 98% Client Satisfaction · 1,200+ Active Clients
- **Security Assessment** → nexustek.com/healthcare/security-assessment
- nexustek.com/healthcare
`

const NEXUSTEK_INTERNAL_BRIEF = `## Cover

## Send Note
For marketing to send to sales and company

Subject line: Healthcare + HIPAA GTM kit — everything you need to start conversations today

Great news — the full Healthcare + HIPAA GTM kit is ready.

This is one of our highest-priority verticals. Healthcare providers carry the highest breach exposure of any sector, operate under tightening HIPAA compliance obligations, and are managing all of it with IT teams that were never sized for the current environment. The gap between what they need and what they can sustain internally is the conversation. Every asset in this kit is built to open it, advance it, and close it.

## Why This Vertical, Why Now

| **57.5%** | **$7.42M** | **279 days** | **73%** |
|---|---|---|---|
| Of all healthcare breaches hit providers directly | Avg. cost of a healthcare data breach | Avg. time to detect and contain a breach | Of healthcare IT systems are legacy infrastructure |

OCR's proposed HIPAA Security Rule updates are moving the compliance expectation from periodic to continuous. Encryption and MFA are no longer 'addressable' — they are mandatory. For most mid-market providers, that means a gap between where they are and where a compliance review now expects them to be. That gap is the urgency driver for every conversation in this vertical.

## What's in the Kit

Eight assets, ready to use across cold outreach, discovery, proposals, and partner channel conversations.

| ASSET | WHAT IT IS + HOW TO USE IT |
|---|---|
| Messaging Framework | The strategic foundation — positioning, segment callouts for all five healthcare sub-segments, objection handling, proof points, and brand voice guidance. Read this first. |
| Sales Cheat Sheet | Two-page desk reference — ICP by segment, buyer personas, lead hooks, pain-to-solution mapping, 8 objections with responses, qualifying questions, regulatory context, and both case studies with 'when to use' tags. |
| BDR Call Scripts + Emails | 5-segment call script table and 6 personalised prospecting emails — physician groups, community hospitals, ambulatory care, diagnostic labs, telehealth, and AI governance. Ready to personalise and send. |
| Customer Deck | 13-slide sales presentation for discovery and proposal conversations. Market pressure, compliance context, four pillars, both case studies, and a clear Security Assessment CTA. |
| Brochure | Print and digital leave-behind. Six challenges, four service pillars, eight differentiators, and both case studies. Pairs with the deck or stands alone. |
| eBook | 'IT that keeps care moving' — The mid-market healthcare provider's guide to HIPAA-aligned infrastructure, cybersecurity, and AI readiness. Use as a lead magnet, email nurture attachment, or LinkedIn content. |
| Video Script | 60-second and 90-second storyboards with on-screen text, imagery direction, and a full voiceover script. Built for LinkedIn organic, paid social, and BDR email embeds. |
| Web Page Copy | Full copy for nexustek.com/healthcare — hero, three-box benefits, solution stack, all five segments, both case studies, and resources slider. Hand off to web team at launch. |

## Where to Start

If You're in Sales
- Read the Sales Cheat Sheet first — keep it open during every healthcare conversation
- Pull the right email from the BDR doc and personalise the [customize with...] bracket
- Attach the Brochure or eBook to intro emails
- Use the Customer Deck for discovery and proposal calls
- Lead every conversation with the Security Assessment offer — never a full pitch

If You Are in BDR / Outbound
- Start with the BDR emails — 6 segment-specific sequences ready to personalise
- Use the 60-second video in email embeds for higher engagement
- Open compliance conversations with the HIPAA regulatory context from the cheat sheet
- Drive all CTA traffic to nexustek.com/healthcare for the no-cost Security Assessment
- Use the eBook as a value-add attachment for mid-funnel nurture

## The Primary CTA — Security Assessment

Every asset drives one conversion: the no-cost Security Assessment.

It maps the prospect's current posture against HIPAA Security Rule requirements, NIST CSF 2.0, and HPH CPGs — and delivers a prioritised remediation roadmap. 30 minutes. No commitment. The output is useful whether they engage NexusTek or not. It's the lowest-friction, highest-value first ask in the market for this buyer.

When the mental health nonprofit came to NexusTek, their previous MSP had failed them and clinical staff were losing reliable access to patient systems. NexusTek took over network operations with a dedicated SDM from day one.

> "We always know what we're doing, what the next steps are, and when those are due." — IT Director, 300+ employee nonprofit mental health organisation

## The HIPAA Compliance Angle — Don't Miss This

OCR's proposed HIPAA Security Rule updates are a genuine urgency driver. Many mid-market providers don't know encryption and MFA are now mandatory — or that the IT controls they're missing are the same controls NexusTek already delivers. Use the regulatory context section in the cheat sheet to open that conversation. It's the fastest way to move a prospect from 'we'll look at it later' to 'we need to act now.'

## Key Messages to Land in Every Conversation

**IT that keeps care moving.**
The headline. Clinical systems staying available isn't an IT outcome — it's a patient care outcome. This is the emotional anchor for every segment.

**Mid-market complexity, enterprise-grade IT.**
Healthcare providers carry HIPAA obligations, breach exposure, and legacy infrastructure burdens far larger than their IT teams. NexusTek closes that gap.

**Compliance without a certifier.**
NexusTek implements and manages the controls HIPAA requires — MFA, encrypted infrastructure, monitoring, incident response, audit trails. We don't certify; we execute. Position clearly.

**Four pillars. One partner. Nothing left uncovered.**
Cloud, Cybersecurity, IT Operations, Data + AI — fully integrated through NexusOps. This is the full-stack differentiation that separates NexusTek from point solution vendors and generic MSPs.

**The Security Assessment is the door.**
Low friction, high value. Maps HIPAA posture, surfaces gaps, delivers a roadmap. It's the right first ask for every conversation in this vertical — not a full managed services pitch.

## One Non-Negotiable

Never claim NexusTek certifies organisations as HIPAA compliant, builds EHR or clinical platforms, or provides regulatory or legal counsel. These are the positioning boundaries in the Messaging Framework — they protect every conversation and set the right client expectations from the start.

## Back Cover
NexusTek
HEALTHCARE + HIPAA  |  GTM LAUNCH BRIEF  |  INTERNAL USE ONLY
NexusTek Marketing  ·  2026
`

const NEXUSTEK_WEB_PAGE_COPY = `## Cover
NexusTek
Healthcare + HIPAA
Web Page Copy
nexustek.com/healthcare  ·  Draft v1  ·  2026

## Page Metadata

**Page URL**
nexustek.com/healthcare

**Page title tag**
Managed IT + Cybersecurity for Healthcare | NexusTek

**Meta description**
NexusTek provides managed IT, cybersecurity, and private cloud for healthcare organisations that need HIPAA-compliant, always-on infrastructure — without building an internal IT organisation to maintain it.

## Hero Section

# IT THAT KEEPS HEALTHCARE RUNNING.
Managed IT, cybersecurity, and private cloud for healthcare — HIPAA-aligned, always-on, without building an internal IT organisation.

[[Keep care running]]  [[Protect patient data]]  [[Build for AI and compliance]]

CTA buttons:
[[Schedule a Security Assessment]]  [[See Client Stories]]

**Where Reliability, Security, and Compliance Converge**
From physician groups to regional health systems — we support mid-market healthcare IT.

*MEET THE MOMENT WITH CONFIDENCE*

## Stats

- **99.9%** | Uptime SLA
- **100%** | Cloud Migration Success Rate
- **279 days** | Avg. breach detection — we close this gap
- **vCISO-Led** | Executive security leadership built in

FROM PHYSICIAN GROUPS TO HEALTH SYSTEMS, WE ADDRESS THE OPERATIONAL REALITIES OF MID-MARKET HEALTHCARE.

## 3-Box Treatment

### Keep Care Running
EHR downtime stops care. NexusTek keeps clinical systems available with proactive monitoring, tested DRaaS, and a 99.9% uptime SLA.

### Protect Patient Data
Healthcare is the most breached sector. MDR, AI Email Security, MFA, and 24/7 SOC close the 279-day detection gap.

### Build for AI and Compliance
HIPAA-aligned Private Cloud, Security Assessments, and a governed AI platform. The infrastructure compliance and AI readiness require.

## CTA Banner

**Healthcare IT + Security Assessment**
Map your posture against HIPAA, NIST CSF 2.0, and HPH CPGs. Prioritised remediation roadmap. No commitment required.
[[Get Started]]

## Solution Stack

**The Full IT Stack. One Partner.**
Four service pillars through NexusOps — built for the operational and compliance realities of mid-market healthcare.

### IT Operations

**IT Operations**
Fully Managed IT Services
Help desk, monitoring, patching, and lifecycle management across clinical and administrative systems. Dedicated SDM and weekly cadence calls from day one.

**IT Operations**
Co-Managed IT
Covers the layers your internal team can't sustain continuously — 24/7 monitoring, patch governance, compliance documentation, and vCISO oversight.

**IT Operations**
vCIO Services
IT strategy, vendor management, and technology roadmap aligned to clinical and operational priorities. Without adding headcount.

### Cloud

**Cloud**
NexusTek Private Cloud
HIPAA-aligned Tier 4/5. 99.9% uptime SLA. Encryption at rest and in transit. RBAC and full audit logging. Fixed-cost billing.

**Cloud**
Managed Hybrid Cloud
Legacy clinical systems stay available during phased migration. Cloud Readiness Assessment sequences workloads by clinical risk. 100% migration success rate.

**Cloud**
Disaster Recovery as a Service
Immutable backup with tested RTOs. Ransomware becomes a contained incident. Recovery procedures documented and available on demand.

### Cybersecurity

**Cybersecurity**
MDR + 24/7 SOC
Continuous monitoring across endpoint, email, identity, and network. Closes the 279-day detection gap. Sub-hour response SLA.

**Cybersecurity**
AI Email Security
Stops phishing before clinical inboxes. The primary breach vector for mid-market providers, addressed at the source.

**Cybersecurity**
Security Assessments
Maps posture against HIPAA Security Rule, NIST CSF 2.0, and HPH CPGs. Prioritised remediation roadmap. Entry point for every engagement.

**Cybersecurity**
vCISO Services
Executive security leadership on demand — programme structure, OCR readiness, insurance preparation. No full-time hire required.

### Data + AI

**Data + AI**
Secure AI Platform
Governed access to leading AI models inside a HIPAA-aligned boundary. ePHI never reaches an unmanaged third-party system.

**Data + AI**
AI Readiness Assessment
Identifies high-value use cases — billing automation, documentation, scheduling — and maps governance gaps before deployment.

## Segments Section

**Built for Every Healthcare Segment**
Physician groups to health systems to telehealth providers — one partner, right-sized for every mid-market healthcare organisation.

**SEGMENT 1**
### Physician Groups + Multi-Specialty Practices
*Practice Administrators · COOs · Office Managers*
No dedicated IT — EHR downtime stops patient care and HIPAA obligations go unmet.
**NexusTek delivers:**  Fully Managed IT | Security Assessment | MDR + 24/7 SOC | HIPAA Private Cloud

**SEGMENT 2**
### Community Hospitals + Regional Health Systems
*IT Directors · VP IT · CIO · COO*
Internal IT keeps operations running but can't sustain security depth and compliance governance simultaneously.
**NexusTek delivers:**  Co-Managed IT | MDR + 24/7 SOC | vCISO | Security Assessment

**SEGMENT 3**
### Outpatient + Ambulatory Care Centres
*Practice Administrators · Operations Directors · COOs*
System downtime during operating hours stops the entire schedule — and multi-site coverage is uneven.
**NexusTek delivers:**  Fully Managed IT | Security Assessment | Multi-Site Coverage | DRaaS

**SEGMENT 4**
### Diagnostic Labs + Imaging Centres
*Operations Directors · IT Managers · COOs*
83%+ of imaging devices run outdated software — ransomware targeting PACS delays patient diagnosis.
**NexusTek delivers:**  Security Assessment | DRaaS with Tested RTOs | MDR | HIPAA Compliance

**SEGMENT 5**
### Telehealth + Remote Care Providers
*CTOs · IT Directors · COOs*
No physical perimeter — phishing targeting clinician credentials is the primary breach vector.
**NexusTek delivers:**  AI Email Security | Secure Remote Access | MDR + 24/7 SOC | Security Assessment

## Case Studies Section

**Proven in Healthcare**

*CASE STUDY*
### Mental Health Nonprofit | Fully Managed IT

**The situation**
300+ employee mental health nonprofit. Internal IT stretched past capacity. Existing MSP underdelivering. Clinical staff losing reliable access to patient systems.

**What NexusTek delivered**
Fully Managed IT. Proactive monitoring, patch management, firewall, and cybersecurity. Dedicated SDM with weekly cadence calls. Clinical staff regained reliable access from day one.

> "We always know what we're doing, what the next steps are, and when those are due."

[[View Full Case Study →]]  nexustek.com/insights/case-study-nonprofit-mental-health-it-managed-services

*CASE STUDY*
### Episcopal Health Foundation | AI + Private Cloud

**The situation**
Texas health equity nonprofit. Manual research analysis: 5–10 hours per area. Growing data volumes, strict governance requirements, no internal AI expertise.

**What NexusTek delivered**
Custom AI tool on NexusTek Private Cloud. Encrypted RBAC architecture. Governance built in from day one. Research time reduced to 1–2 hours — up to 5x faster.

> Up to 5x faster. Governed AI with PHI controls from day one.

[[View Full Case Study →]]  nexustek.com/insights/case-study-community-health-nonprofit-ai-private-cloud

## Resources

Explore the full healthcare GTM kit.

**eBOOK**
IT that keeps care moving
The mid-market healthcare provider's guide to HIPAA-aligned infrastructure, cybersecurity, and AI readiness.
[[Download]]

**BROCHURE**
Secure IT. Uninterrupted Care.
Managed IT, cybersecurity, and private cloud built for healthcare. Challenges, solutions, service pillars, and case studies.
[[View]]

## Why NexusTek

- **30 years** | IT services experience
- **1,200+** | Active clients
- **98%** | Client satisfaction rating
- **CRN MSP500** | 9 consecutive years
- **100+** | Technology partnerships

## Final CTA

# Ready to Put IT to Work for Your Patients?
Talk to a NexusTek healthcare specialist. We start by understanding how your environment operates, where compliance and security risk exists, and where we can deliver the fastest impact.

[[Schedule a Security Assessment]]  [[View All Services]]

## Back Cover
NexusTek
HEALTHCARE + HIPAA  |  WEB PAGE COPY  |  DRAFT V1
Confidential — Internal Use Only  ·  NexusTek Marketing  ·  2026
`

async function main() {
  const contentFile = process.argv[2]
  const assetIndex  = process.argv[3] ? parseInt(process.argv[3], 10) : 0

  const asset = ASSET_META[assetIndex] ?? ASSET_META[0]
  const date  = new Date().toISOString().slice(0, 10)
  const ext   = asset.ext
  const outName = `preview-${asset.num}-${asset.name.replace(/ /g, '-').toLowerCase()}-${date}.${ext}`
  const outPath = path.join(os.homedir(), 'Downloads', outName)

  const defaultContent: Record<number, string> = {
    0: NEXUSTEK_BROCHURE,
    3: NEXUSTEK_BDR_EMAILS,
    4: NEXUSTEK_CUSTOMER_DECK,
    6: NEXUSTEK_WEB_PAGE_COPY,
    7: NEXUSTEK_INTERNAL_BRIEF,
  }

  const markdown = contentFile && contentFile !== ''
    ? fs.readFileSync(path.resolve(contentFile), 'utf8')
    : (defaultContent[assetIndex] ?? NEXUSTEK_BROCHURE)

  if (contentFile && contentFile !== '') {
    console.log(`Using content from: ${contentFile}`)
  } else {
    console.log('Using NexusTek sample content (pass a content file to use real data)')
  }

  console.log(`Building ${asset.num} ${asset.name} preview…`)

  let buf: Buffer
  if (asset.index === 0) {
    buf = await buildBrochureBuffer(markdown, NEXUSTEK_STYLE, 'NexusTek Healthcare', 'Healthcare')
  } else if (asset.index === 3) {
    buf = await buildBdrEmailsBuffer(markdown, NEXUSTEK_STYLE, 'NexusTek Healthcare', 'Healthcare')
  } else if (asset.index === 4) {
    buf = await buildCustomerDeckPptxBuffer(markdown, NEXUSTEK_STYLE)
  } else if (asset.index === 6) {
    buf = await buildWebPageCopyBuffer(markdown, NEXUSTEK_STYLE, 'NexusTek', 'Healthcare')
  } else if (asset.index === 7) {
    buf = await buildInternalBriefBuffer(markdown, NEXUSTEK_STYLE, 'NexusTek', 'Healthcare')
  } else {
    buf = await buildGenericDocxBuffer(markdown, NEXUSTEK_STYLE, asset.name, 'NexusTek Healthcare', 'Healthcare')
  }

  fs.writeFileSync(outPath, buf)
  console.log(`✓ Saved: ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
