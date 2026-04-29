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

  const primary = hexNoHash(docStyle.primaryColor)
  const divider = tint(docStyle.primaryColor, 0.2)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.SINGLE, size: 6, color: primary },
      bottom:           { style: BorderStyle.SINGLE, size: 6, color: primary },
      left:             noBorder(),
      right:            noBorder(),
      insideHorizontal: noBorder(),
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: divider },
    },
    rows: [new TableRow({
      children: parsed.map(s => new TableCell({
        margins: { top: 160, bottom: 160, left: 120, right: 120 },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s.val), font: hf, size: 48, bold: true, color: primary })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s.label), font: bf, size: 22 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: sanitize(s.source), font: bf, size: 18, italics: true, color: '6B7280' })] }),
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
      if (m) cur.fields.push({ key: m[1].trim(), value: m[2].trim() })
    }
  }
  if (cur) blocks.push(cur)
  const placeholder = {
    title: 'Case study pending',
    fields: [
      { key: 'Who they are', value: 'Contact your team to add a case study.' },
      { key: 'Challenge', value: '—' },
      { key: 'What we delivered', value: '—' },
      { key: 'Outcome', value: '—' },
    ],
  }
  while (blocks.length < 2) blocks.push(placeholder)

  const primary   = hexNoHash(docStyle.primaryColor)
  const borderCol = tint(docStyle.primaryColor, 0.3)
  const altFill   = tint(docStyle.secondaryColor, 0.05)
  const hf = docStyle.headingFont
  const bf = docStyle.bodyFont

  const buildCard = (b: typeof blocks[0]): TableCell => new TableCell({
    shading: { fill: altFill, type: ShadingType.SOLID, color: altFill },
    margins: { top: 160, bottom: 160, left: 160, right: 160 },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 6, color: primary },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: borderCol },
      left:   { style: BorderStyle.SINGLE, size: 2, color: borderCol },
      right:  { style: BorderStyle.SINGLE, size: 2, color: borderCol },
    },
    children: [
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: sanitize(b.title), font: hf, size: 24, bold: true, color: primary })] }),
      ...b.fields.flatMap(f => [
        new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: sanitize(f.key) + ':', font: bf, size: 20, bold: true })] }),
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sanitize(f.value), font: bf, size: 20 })] }),
      ]),
    ],
  })

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
      rows: [new TableRow({ children: [buildCard(blocks[0]), buildCard(blocks[1])] })],
    }),
  ]
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

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const contentFile = process.argv[2]
  const assetIndex  = process.argv[3] ? parseInt(process.argv[3], 10) : 0

  const asset = ASSET_META[assetIndex] ?? ASSET_META[0]
  const date  = new Date().toISOString().slice(0, 10)
  const outName = `preview-${asset.num}-${asset.name.replace(/ /g, '-').toLowerCase()}-${date}.docx`
  const outPath = path.join(os.homedir(), 'Downloads', outName)

  const markdown = contentFile
    ? fs.readFileSync(path.resolve(contentFile), 'utf8')
    : NEXUSTEK_BROCHURE

  if (contentFile) {
    console.log(`Using content from: ${contentFile}`)
  } else {
    console.log('Using NexusTek sample content (pass a content file to use real data)')
  }

  console.log(`Building ${asset.num} ${asset.name} preview…`)

  let buf: Buffer
  if (asset.index === 0) {
    buf = await buildBrochureBuffer(markdown, NEXUSTEK_STYLE, 'NexusTek Healthcare', 'Healthcare')
  } else {
    buf = await buildGenericDocxBuffer(markdown, NEXUSTEK_STYLE, asset.name, 'NexusTek Healthcare', 'Healthcare')
  }

  fs.writeFileSync(outPath, buf)
  console.log(`✓ Saved: ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
