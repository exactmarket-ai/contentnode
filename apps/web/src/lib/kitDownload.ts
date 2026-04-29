import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType,
  Footer, Header, PageNumber,
  ShadingType, HeightRule, BorderStyle, SectionType,
  ImageRun, convertInchesToTwip,
} from 'docx'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DocStyle {
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

interface AssetForDownload {
  index: number
  name: string
  num: string
  ext: string
  content: string
}

const DEFAULT_STYLE: DocStyle = {
  primaryColor: '#1B1F3B',
  secondaryColor: '#4A90D9',
  headingFont: 'Calibri',
  bodyFont: 'Calibri',
  logoDataUrl: null,
  agencyName: '',
  footerText: '',
  includeCoverPage: false,
  includePageNumbers: true,
}

// ── Color helpers ──────────────────────────────────────────────────────────────

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

// Blend two hex colors: t=0 → c1, t=1 → c2
function lerpHex(c1: string, c2: string, t: number): string {
  const h = (s: string) => s.replace('#', '').toUpperCase()
  const rgb = (s: string): [number, number, number] => {
    const c = h(s)
    return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)]
  }
  const [r1,g1,b1] = rgb(c1)
  const [r2,g2,b2] = rgb(c2)
  return [r1*(1-t)+r2*t, g1*(1-t)+g2*t, b1*(1-t)+b2*t]
    .map(v => Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase()
}

// Add brightness to a hex color (amount 0–1)
function lighten(hex: string, amount: number): string {
  const c = hex.replace('#', '').toUpperCase()
  const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16)
  return [
    Math.min(255, Math.round(r + (255-r)*amount)),
    Math.min(255, Math.round(g + (255-g)*amount)),
    Math.min(255, Math.round(b + (255-b)*amount)),
  ].map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase()
}

// ── Image helpers ──────────────────────────────────────────────────────────────

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1] ?? ''
  const bin = atob(base64)
  const buf = new ArrayBuffer(bin.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i)
  return buf
}

function imageTypeFromDataUrl(dataUrl: string): 'png' | 'jpg' | 'gif' | 'bmp' | null {
  const mime = dataUrl.split(';')[0].split(':')[1] ?? ''
  if (mime.includes('svg')) return null  // SVG not supported in DOCX ImageRun
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('bmp')) return 'bmp'
  return 'png'
}

// Returns natural pixel dimensions of an image data URL.
// Resolves null if the image fails to load or takes longer than 2 seconds.
// Never set both DOCX/PPTX width and height to fixed values without computing
// from these dimensions — that stretches or squishes the logo.
async function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () =>
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? resolve({ w: img.naturalWidth, h: img.naturalHeight })
        : resolve(null)
    img.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 2000)
    img.src = dataUrl
  })
}

// ── DOCX helpers ───────────────────────────────────────────────────────────────

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

function buildStyledTable(tableLines: string[], docStyle: DocStyle): Table {
  const primary    = hexNoHash(docStyle.primaryColor)
  const altRow     = tint(docStyle.secondaryColor, 0.1)
  const borderCol  = tint(docStyle.primaryColor, 0.3)
  const bodyFont   = docStyle.bodyFont
  const bodySize   = 22 // 11pt in half-points
  // Filter out: (1) separator rows  (2) data rows where every cell is empty / "na" / "–" (stray placeholders)
  const dataRows   = tableLines
    .filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    .filter((l, idx) => {
      if (idx === 0) return true // always keep header
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
  const size  = 18 // 9pt
  const muted = '6B7280'
  const parts: TextRun[] = []

  // Left: agency name
  if (docStyle.agencyName) {
    parts.push(new TextRun({ text: docStyle.agencyName, font, size, color: muted }))
  }
  // Center: footer text
  if (docStyle.footerText) {
    parts.push(new TextRun({ text: '\t', font, size }))
    parts.push(new TextRun({ text: docStyle.footerText, font, size, color: muted }))
  }
  // Right: page number
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
        { type: 'center', position: 4680 }, // center of standard letter page
        { type: 'right',  position: 9360 }, // right margin
      ],
    })],
  })
}

async function buildCoverSection(
  docStyle: DocStyle,
  assetName: string,
  clientName: string,
  verticalName: string,
): Promise<(Paragraph | Table)[]> {
  const primary      = hexNoHash(docStyle.primaryColor)
  const coverItems: Paragraph[] = []

  // Logo with correct aspect ratio, or fall back to agency name text
  if (docStyle.logoDataUrl) {
    const logoType = imageTypeFromDataUrl(docStyle.logoDataUrl)
    let placed = false
    if (logoType) {
      const dims = await getImageDimensions(docStyle.logoDataUrl)
      if (dims && dims.h > 0) {
        const TARGET_H = 50                                  // fixed height (px)
        const targetW  = Math.round(TARGET_H * (dims.w / dims.h)) // width from ratio
        try {
          const logoData = dataUrlToArrayBuffer(docStyle.logoDataUrl)
          coverItems.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 720, after: 480 },
            children: [new ImageRun({ data: logoData, type: logoType, transformation: { width: targetW, height: TARGET_H } })],
          }))
          placed = true
        } catch { /* fall through to text fallback */ }
      }
    }
    if (!placed) {
      // SVG, unresolvable dims, or ImageRun error: agencyName text is correct fallback
      coverItems.push(
        docStyle.agencyName
          ? new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 720, after: 480 },
              children: [new TextRun({ text: docStyle.agencyName, font: docStyle.headingFont, size: 32, bold: true, color: 'FFFFFF' })],
            })
          : new Paragraph({ spacing: { before: 1440 }, children: [] }),
      )
    }
  } else {
    coverItems.push(new Paragraph({ spacing: { before: 1440 }, children: [] }))
  }

  coverItems.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: assetName, font: docStyle.headingFont, size: 56, bold: true, color: 'FFFFFF' })],
  }))
  coverItems.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: `${verticalName} · ${clientName}`, font: docStyle.headingFont, size: 28, color: 'DDDDDD' })],
  }))
  if (docStyle.agencyName || docStyle.footerText) {
    coverItems.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 720 },
      children: [new TextRun({
        text: [docStyle.agencyName, docStyle.footerText].filter(Boolean).join('  ·  '),
        font: docStyle.bodyFont, size: 18, color: 'AAAAAA',
      })],
    }))
  }

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top:              { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom:           { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left:             { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right:            { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      rows: [new TableRow({
        height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT },
        children: [new TableCell({
          shading: { fill: primary, type: ShadingType.SOLID, color: primary },
          children: coverItems,
        })],
      })],
    }),
  ]
}

// ── Markdown-cover builder (for assets with embedded ## Cover sections) ────────

async function buildMarkdownCoverSection(
  coverLines: string[],
  docStyle: DocStyle,
): Promise<(Paragraph | Table)[]> {
  const primary   = hexNoHash(docStyle.primaryColor)
  const secondary = hexNoHash(docStyle.secondaryColor)
  const items: Paragraph[] = []

  if (docStyle.logoDataUrl) {
    const logoType = imageTypeFromDataUrl(docStyle.logoDataUrl)
    let placed = false
    if (logoType) {
      const dims = await getImageDimensions(docStyle.logoDataUrl)
      if (dims && dims.h > 0) {
        const TARGET_H = 50
        const targetW  = Math.round(TARGET_H * (dims.w / dims.h))
        try {
          const logoData = dataUrlToArrayBuffer(docStyle.logoDataUrl)
          items.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 720, after: 480 },
            children: [new ImageRun({ data: logoData, type: logoType, transformation: { width: targetW, height: TARGET_H } })],
          }))
          placed = true
        } catch { /* fall through */ }
      }
    }
    if (!placed && docStyle.agencyName) {
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 720, after: 480 }, children: [new TextRun({ text: docStyle.agencyName, font: docStyle.headingFont, size: 32, bold: true, color: 'FFFFFF' })] }))
    }
  } else {
    items.push(new Paragraph({ spacing: { before: 1440 }, children: [] }))
  }

  let nonEmptyCount = 0
  for (const raw of coverLines) {
    const text = sanitize(raw.replace(/\*\*/g, '').replace(/^\*|\*$/g, '').trim())
    if (!text) continue
    if (nonEmptyCount === 0) {
      // Document type title — large bold white
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text, font: docStyle.headingFont, size: 52, bold: true, color: 'FFFFFF' })] }))
    } else if (nonEmptyCount === 1) {
      // Client name — medium white
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text, font: docStyle.headingFont, size: 40, bold: false, color: 'FFFFFF' })] }))
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: '─────', font: docStyle.bodyFont, size: 24, color: secondary })] }))
    } else if (nonEmptyCount === 2) {
      // "X Segments · Y Sequences"
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text, font: docStyle.bodyFont, size: 22, color: 'CCCCCC' })] }))
    } else {
      // "Internal Use Only" / version info
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text, font: docStyle.bodyFont, size: 18, color: 'AAAAAA' })] }))
    }
    nonEmptyCount++
  }

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

// ── Brochure-specific builders ─────────────────────────────────────────────────

function noBorder() { return { style: BorderStyle.NONE, size: 0, color: 'auto' } as const }

/** 4-cell horizontal stats bar: large bold number, label below, source below that */
function buildStatBar(lines: string[], docStyle: DocStyle): Table {
  const parsed = lines
    .filter(l => /^[-*] /.test(l))
    .slice(0, 4)
    .map(l => {
      const parts = l.slice(2).split('|').map(p => p.trim())
      return {
        val:    (parts[0] ?? '').replace(/\*\*/g, ''),
        label:  parts[1] ?? '',
        source: parts[2] ?? '',
      }
    })
  while (parsed.length < 4) parsed.push({ val: '–', label: '', source: '' })

  const primary  = hexNoHash(docStyle.primaryColor)
  const divider  = tint(docStyle.primaryColor, 0.2)
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

/** 2×2 table for pillars. Each cell: name heading, value prop, bullet services — all as separate Paragraphs, no HTML */
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

/** Dark-background proof strip: primaryColor fill, large white stat + label per cell */
function buildProofStrip(lines: string[], docStyle: DocStyle): Table {
  const parsed = lines
    .filter(l => /^[-*] /.test(l))
    .slice(0, 6)
    .map(l => {
      const parts = l.slice(2).split('|').map(p => p.trim())
      return { val: (parts[0] ?? '').replace(/\*\*/g, ''), label: parts[1] ?? '' }
    })
  if (!parsed.length) return buildStatBar([], docStyle)

  const primary  = hexNoHash(docStyle.primaryColor)
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

/** Two side-by-side case study cards */
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

/** Dark CTA box with URL + optional secondary bullet list */
function buildBackCoverCta(lines: string[], docStyle: DocStyle): (Paragraph | Table)[] {
  let ctaName = ''
  let ctaDesc = ''
  let ctaUrl  = ''
  const secondaries: string[] = []

  for (const line of lines) {
    if (/^\*\*[^*]+\*\*$/.test(line.trim())) { ctaName = line.trim().replace(/\*\*/g, ''); continue }
    if (/^https?:\/\//i.test(line.trim()))    { ctaUrl  = line.trim(); continue }
    if (/^[-*] /.test(line))                  { secondaries.push(line.slice(2).trim()); continue }
    if (line.trim() && !ctaDesc)              { ctaDesc = line.trim() }
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

/** Brochure-specific cover: client name large + tagline + vertical name on primary-color background */
async function buildBrochureCoverSection(
  docStyle: DocStyle,
  tagline: string,
  clientName: string,
  verticalName: string,
): Promise<(Paragraph | Table)[]> {
  const primary   = hexNoHash(docStyle.primaryColor)
  const secondary = hexNoHash(docStyle.secondaryColor)
  // Strip any surrounding quotes the model may have added
  const cleanTagline = tagline.replace(/^["'"'"']+|["'"'"']+$/g, '').trim()
  const items: Paragraph[] = []

  // Agency logo or name — upper area
  if (docStyle.logoDataUrl) {
    const logoType = imageTypeFromDataUrl(docStyle.logoDataUrl)
    let placed = false
    if (logoType) {
      const dims = await getImageDimensions(docStyle.logoDataUrl)
      if (dims && dims.h > 0) {
        const TARGET_H = 54
        const targetW = Math.round(TARGET_H * (dims.w / dims.h))
        try {
          items.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 560, after: 400 },
            children: [new ImageRun({ data: dataUrlToArrayBuffer(docStyle.logoDataUrl), type: logoType, transformation: { width: targetW, height: TARGET_H } })],
          }))
          placed = true
        } catch { /* fall through */ }
      }
    }
    if (!placed && docStyle.agencyName) {
      items.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 560, after: 400 }, children: [new TextRun({ text: docStyle.agencyName, font: docStyle.headingFont, size: 32, bold: true, color: 'FFFFFF' })] }))
    }
  } else {
    items.push(new Paragraph({ spacing: { before: 1200 }, children: [] }))
  }

  // Client name — large and prominent
  items.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: sanitize(clientName), font: docStyle.headingFont, size: 80, bold: true, color: 'FFFFFF' })],
  }))

  // Accent divider line (simulated with a highlighted text run)
  items.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: '─────', font: docStyle.bodyFont, size: 24, color: secondary })],
  }))

  // Tagline — display size, not body text
  if (cleanTagline) {
    items.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: sanitize(cleanTagline), font: docStyle.headingFont, size: 40, bold: false, color: 'FFFFFF' })],
    }))
  }

  // Vertical name as a label
  items.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
    children: [new TextRun({ text: sanitize(verticalName).toUpperCase(), font: docStyle.bodyFont, size: 22, color: 'AAAAAA' })],
  }))

  // NIL borders so Word renders zero table lines — more absolute than NONE
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

/** Main orchestrator: parses brochure markdown by section and applies specialized renderers */
export async function buildBrochureDocxBlob(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Blob> {
  const primaryHex   = hexNoHash(docStyle.primaryColor)
  const secondaryHex = hexNoHash(docStyle.secondaryColor)
  const bodyColor    = '1A1A14'
  const bodyFont     = docStyle.bodyFont
  const headFont     = docStyle.headingFont

  // Split into named sections by ## headers
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

  const coverChildren = await buildBrochureCoverSection(docStyle, coverTagline, clientName, verticalName)

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

  return Packer.toBlob(doc)
}

// ── Main DOCX builder ──────────────────────────────────────────────────────────

export async function markdownToDocxBlob(
  markdown: string,
  docStyle: DocStyle = DEFAULT_STYLE,
  meta?: { assetName?: string; verticalName?: string; clientName?: string },
): Promise<Blob> {
  const primaryHex   = hexNoHash(docStyle.primaryColor)
  const secondaryHex = hexNoHash(docStyle.secondaryColor)
  const bodyColor    = '1A1A14'
  const bodyFont     = docStyle.bodyFont
  const headFont     = docStyle.headingFont

  // Detect embedded ## Cover section — extract and render as dark cover page
  const rawMdSections = markdown.split(/^(?=## )/m)
  let coverChildren: (Paragraph | Table)[] = []
  let bodyMarkdown = markdown

  if (rawMdSections.length > 0 && /^## Cover\b/i.test(rawMdSections[0])) {
    const coverLines = rawMdSections[0].split('\n').slice(1).filter(l => l.trim())
    coverChildren = await buildMarkdownCoverSection(coverLines, docStyle)
    bodyMarkdown = rawMdSections.slice(1).join('')
  } else if (docStyle.includeCoverPage && !!meta?.assetName) {
    coverChildren = await buildCoverSection(docStyle, meta!.assetName!, meta!.clientName ?? '', meta!.verticalName ?? '')
  }

  // Bullet lines starting with a bold stat value followed by | — rendered as visual stat bar
  const STAT_BAR_LINE_RE = /^[-*] \*\*[\d$€£¥%#][^*]*\*\*.*\|/

  const lines = bodyMarkdown.split('\n')
  const children: (Paragraph | Table)[] = []
  let tableLines: string[] = []
  let statBarLines: string[] = []

  function flushStatBar() {
    if (!statBarLines.length) return
    if (statBarLines.length >= 2) {
      children.push(buildStatBar(statBarLines, docStyle))
    } else {
      for (const l of statBarLines) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(l.slice(2), bodyFont, 22, bodyColor) }))
      }
    }
    statBarLines = []
  }

  function flushTable() {
    if (!tableLines.length) return
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    if (dataRows.length) children.push(buildStyledTable(tableLines, docStyle))
    tableLines = []
  }

  for (const line of lines) {
    if (line.startsWith('|')) {
      flushStatBar()
      tableLines.push(line)
      continue
    }
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
        {
          id: 'Normal', name: 'Normal',
          run: { font: bodyFont, size: 22, color: bodyColor },
        },
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: headFont, size: 48, bold: true, color: primaryHex },
          paragraph: { spacing: { before: 240, after: 160 } },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: headFont, size: 36, bold: true, color: primaryHex },
          paragraph: { spacing: { before: 200, after: 120 } },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: headFont, size: 28, bold: true, color: secondaryHex },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
        {
          id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: headFont, size: 24, bold: true, color: primaryHex },
          paragraph: { spacing: { before: 120, after: 60 } },
        },
      ],
    },
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } }],
      }],
    },
    sections: [
      ...(coverChildren.length ? [{
        properties: { type: SectionType.NEXT_PAGE },
        children: coverChildren,
      }] : []),
      { ...(footers ? { footers } : {}), children },
    ],
  })

  return Packer.toBlob(doc)
}

// ── PPTX builder ───────────────────────────────────────────────────────────────

// Pattern: "- **42%** — Short label — (Source, 2024)" or "- **$2.1M** — Short label (Source, 2024)"
const STAT_LINE_RE = /^[-*]\s*\*\*([\d,\.\$€%×xX\+\-]+[^*]*?)\*\*\s*[—–\-]\s*([^(—–\-]+?)(?:\s*[—–\-]\s*|\s*)\(([^)]+)\)\s*$|^[-*]\s*\*\*([\d,\.\$€%×xX\+\-]+[^*]*?)\*\*\s*[—–\-]\s*(.+)$/

function parseStatLine(line: string): { stat: string; label: string; source: string } | null {
  const m = line.match(/^[-*]\s*\*\*\s*([^*]+?)\s*\*\*\s*[—–\-]\s*([^(—–\n]+?)(?:\s*[—–\-]\s*\(([^)]+)\)|\s*\(([^)]+)\))?\s*$/)
  if (!m) return null
  return { stat: m[1].trim(), label: m[2].trim(), source: (m[3] ?? m[4] ?? '').trim() }
}

export async function markdownToPptxBlob(markdown: string, docStyle: DocStyle = DEFAULT_STYLE): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const prs = new PptxGenJS()
  prs.layout = 'LAYOUT_WIDE'  // 13.33" × 7.5"

  const primary   = docStyle.primaryColor
  const secondary = docStyle.secondaryColor ?? '#4A90D9'
  const pri       = hexNoHash(primary)
  const sec       = hexNoHash(secondary)
  const headFont  = docStyle.headingFont
  const bodyFont  = docStyle.bodyFont

  // 4 accent colors derived from brand palette (cycled across cards)
  const cardAccents = [sec, lerpHex(secondary, primary, 0.45), pri, lerpHex(primary, '#000000', 0.25)]

  const LOGO_H = 0.4
  let pptxLogoW: number | null = null
  if (docStyle.logoDataUrl) {
    const dims = await getImageDimensions(docStyle.logoDataUrl)
    if (dims && dims.h > 0) pptxLogoW = parseFloat((LOGO_H * (dims.w / dims.h)).toFixed(3))
  }

  type Slide = ReturnType<typeof prs.addSlide>

  function addLogo(slide: Slide) {
    if (docStyle.logoDataUrl && pptxLogoW !== null) {
      try {
        const lx = parseFloat(Math.max(0, 13.33 - pptxLogoW - 0.3).toFixed(3))
        slide.addImage({ data: docStyle.logoDataUrl, x: lx, y: 6.95, w: pptxLogoW, h: LOGO_H })
      } catch { /* skip */ }
    } else if (docStyle.agencyName) {
      slide.addText(docStyle.agencyName, { x: 10.5, y: 6.95, w: 2.5, h: 0.35, fontSize: 7, color: '999999', fontFace: bodyFont, align: 'right' })
    }
  }

  function whiteHeader(slide: Slide, title: string, subtitle?: string) {
    slide.background = { color: 'FFFFFF' }
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.09, fill: { color: sec }, line: { color: sec, width: 0 } })
    slide.addText(sanitize(title), { x: 0.4, y: 0.15, w: 10.5, h: 0.72, fontSize: 22, bold: true, color: pri, fontFace: headFont })
    if (subtitle) slide.addText(sanitize(subtitle), { x: 0.4, y: 0.87, w: 12.13, h: 0.4, fontSize: 11, color: '5F6B80', fontFace: bodyFont, wrap: true })
  }

  function darkAccentBars(slide: Slide) {
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.13, fill: { color: sec }, line: { color: sec, width: 0 } })
    slide.addShape(prs.ShapeType.rect, { x: 0, y: 7.37, w: '100%', h: 0.13, fill: { color: sec }, line: { color: sec, width: 0 } })
  }

  // ── Layout detection ───────────────────────────────────────────────────────
  function detectLayout(idx: number, total: number, bodyLines: string[]): string {
    if (idx === 0) return 'cover'
    if (idx === total - 1) return 'closing'
    const ne = bodyLines.filter(l => l.trim())
    if (ne.some(l => l.includes(' | ') && !l.startsWith('#'))) return 'casestudy'
    if (ne.some(l => l.includes('→'))) return 'ctapaths'
    if (ne.filter(l => parseStatLine(l) !== null).length >= 3) return 'stats'
    if (ne.filter(l => /^[-*]\s*\*\*[^*]+\*\*\s*[—–-][^)]+[·•]/.test(l)).length >= 4) return 'challenges'
    const boldHdrs = ne.filter(l => /^\*\*[^*]+\*\*\s*$/.test(l.trim()))
    if (boldHdrs.length >= 2) {
      const hasPillar = ne.some((l, i) => {
        if (!/^\*\*[^*]+\*\*\s*$/.test(l.trim())) return false
        const nxt = ne[i + 1]
        return nxt && !/^[-*]/.test(nxt) && !/^\*\*/.test(nxt)
      })
      return hasPillar ? 'pillars' : 'frameworks'
    }
    if (ne[0] && /\*\*[^*]+\*\*[^·•]+[·•]/.test(ne[0])) return 'whyus'
    const f = ne[0] ?? ''
    if (!f.startsWith('-') && !f.startsWith('*') && !f.startsWith('#') && f.trim() &&
        ne.slice(1).some(l => /^[-*]\s*\*\*/.test(l))) return 'deepdive'
    return 'bullets'
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  function renderCover(slide: Slide, title: string, body: string[]) {
    slide.background = { color: pri }
    darkAccentBars(slide)
    slide.addText(sanitize(title), { x: 0.6, y: 1.6, w: 12.13, h: 2.5, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: headFont, align: 'center', valign: 'middle', wrap: true })
    const subs = body.filter(l => l.trim()).map(l => l.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim())
    if (subs[0]) slide.addText(sanitize(subs[0]), { x: 1.0, y: 3.85, w: 11.33, h: 0.7, fontSize: 16, color: 'DDDDDD', fontFace: bodyFont, align: 'center', valign: 'middle', wrap: true })
    if (subs[1]) slide.addText(sanitize(subs[1]), { x: 1.0, y: 4.65, w: 11.33, h: 0.45, fontSize: 12, color: 'AAAAAA', fontFace: bodyFont, align: 'center' })
    addLogo(slide)
  }

  function renderClosing(slide: Slide, title: string, body: string[]) {
    slide.background = { color: pri }
    darkAccentBars(slide)
    slide.addText(sanitize(title), { x: 0.6, y: 0.8, w: 12.13, h: 2.0, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: headFont, align: 'center', valign: 'middle', wrap: true })
    let oy = 3.1
    body.filter(l => l.trim()).slice(0, 5).forEach(l => {
      const raw = l.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').replace(/\*\*/g, '').trim()
      const isCta = /→|http|www\./.test(raw)
      slide.addText(sanitize(raw), { x: 0.6, y: oy, w: 12.13, h: 0.55, fontSize: 13, color: isCta ? sec : 'DDDDDD', fontFace: bodyFont, align: 'center', wrap: true })
      oy += 0.58
    })
    addLogo(slide)
  }

  function renderStats(slide: Slide, title: string, body: string[]) {
    slide.background = { color: pri }
    slide.addText(sanitize(title), { x: 0.4, y: 0.22, w: 12.53, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: headFont })
    const stats = body.filter(l => parseStatLine(l) !== null).slice(0, 4)
    const narr = body.filter(l => l.trim() && !parseStatLine(l) && !l.startsWith('#')).map(l => l.replace(/^[-*> ]+/, '').trim()).join(' ')
    if (narr) slide.addText(sanitize(narr), { x: 0.4, y: 0.9, w: 12.53, h: 0.42, fontSize: 11, color: 'AABBCC', fontFace: bodyFont, wrap: true })
    const gX = 0.25, gY = 0.22, cW = (12.53 - gX) / 2, cH = (5.45 - gY) / 2, sY = 1.42
    stats.forEach((line, i) => {
      const p = parseStatLine(line)!
      const col = i % 2, row = Math.floor(i / 2)
      const cx = 0.4 + col * (cW + gX), cy = sY + row * (cH + gY)
      const acc = cardAccents[i % 4]
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: lighten(pri, 0.12) }, line: { color: lighten(pri, 0.2), width: 0.5 } })
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: 0.12, h: cH, fill: { color: acc }, line: { color: acc, width: 0 } })
      slide.addText(sanitize(p.stat), { x: cx + 0.25, y: cy + 0.2, w: cW - 0.35, h: cH * 0.52, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: headFont, valign: 'middle' })
      slide.addText(sanitize(p.label), { x: cx + 0.25, y: cy + cH * 0.6, w: cW - 0.35, h: cH * 0.24, fontSize: 11, color: 'AABBCC', fontFace: bodyFont, wrap: true })
      if (p.source) slide.addText(sanitize(p.source), { x: cx + 0.25, y: cy + cH * 0.84, w: cW - 0.35, h: cH * 0.16, fontSize: 9, color: '778899', fontFace: bodyFont })
    })
    addLogo(slide)
  }

  function renderChallenges(slide: Slide, title: string, body: string[]) {
    slide.background = { color: pri }
    slide.addText(sanitize(title), { x: 0.4, y: 0.15, w: 12.53, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: headFont })
    const items = body.filter(l => /^[-*]\s*\*\*[^*]+\*\*/.test(l)).slice(0, 6).map(l => {
      const m = l.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*([^·•]+?)(?:\s*[·•]\s*(.+))?$/)
      return m ? { name: m[1].trim(), desc: m[2].trim(), pillar: m[3]?.trim() ?? '' } : null
    }).filter(Boolean) as { name: string; desc: string; pillar: string }[]
    const gap = 0.22, cW = (12.53 - gap * 2) / 3, cH = (7.25 - 0.88 - gap) / 2
    items.forEach((ch, i) => {
      const cx = 0.4 + (i % 3) * (cW + gap), cy = 0.88 + Math.floor(i / 3) * (cH + gap)
      const acc = cardAccents[i % 4]
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: lighten(pri, 0.12) }, line: { color: lighten(pri, 0.2), width: 0.5 } })
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: 0.08, fill: { color: acc }, line: { color: acc, width: 0 } })
      slide.addText(sanitize(ch.name), { x: cx + 0.18, y: cy + 0.15, w: cW - 0.28, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF', fontFace: headFont })
      slide.addText(sanitize(ch.desc), { x: cx + 0.18, y: cy + 0.72, w: cW - 0.28, h: cH - 1.1, fontSize: 11, color: 'AABBCC', fontFace: bodyFont, wrap: true, valign: 'top' })
      if (ch.pillar) slide.addText(sanitize(ch.pillar), { x: cx + 0.18, y: cy + cH - 0.42, w: cW - 0.28, h: 0.35, fontSize: 9, color: sec, fontFace: bodyFont })
    })
    addLogo(slide)
  }

  function renderFrameworks(slide: Slide, title: string, body: string[]) {
    const sub = body.find(l => !l.startsWith('**') && !l.startsWith('-') && l.trim() && !l.startsWith('#'))
    whiteHeader(slide, title, sub)
    const blocks: { name: string; bullets: string[] }[] = []
    let cur: { name: string; bullets: string[] } | null = null
    for (const l of body) {
      const hm = l.trim().match(/^\*\*([^*]+)\*\*\s*$/)
      if (hm) { if (cur) blocks.push(cur); cur = { name: hm[1].trim(), bullets: [] } }
      else if (cur && /^[-*] /.test(l)) cur.bullets.push(l.replace(/^[-*] /, '').replace(/\*\*/g, '').trim())
    }
    if (cur) blocks.push(cur)
    const cY = sub ? 1.35 : 1.05, gap = 0.22, cW = (12.53 - gap) / 2, cH = (7.25 - cY - gap) / 2
    blocks.slice(0, 4).forEach((b, i) => {
      const cx = 0.4 + (i % 2) * (cW + gap), cy = cY + Math.floor(i / 2) * (cH + gap)
      const acc = cardAccents[i % 4]
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: 'F0F2FA' }, line: { color: 'E2E6F0', width: 0.5 } })
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: 0.1, h: cH, fill: { color: acc }, line: { color: acc, width: 0 } })
      slide.addText(sanitize(b.name), { x: cx + 0.22, y: cy + 0.15, w: cW - 0.32, h: 0.48, fontSize: 14, bold: true, color: pri, fontFace: headFont })
      if (b.bullets.length) {
        const bItems = b.bullets.slice(0, 4).map(bt => ({ text: sanitize(bt), options: { bullet: true as const, color: '374151' as string, fontFace: bodyFont } }))
        slide.addText(bItems, { x: cx + 0.22, y: cy + 0.7, w: cW - 0.32, h: cH - 0.85, fontSize: 11, valign: 'top', wrap: true })
      }
    })
    addLogo(slide)
  }

  function renderPillars(slide: Slide, title: string, body: string[]) {
    whiteHeader(slide, title)
    const blocks: { name: string; valueProp: string; services: string[] }[] = []
    let cur: { name: string; valueProp: string; services: string[] } | null = null
    for (const l of body) {
      const hm = l.trim().match(/^\*\*([^*]+)\*\*\s*$/)
      if (hm) { if (cur) blocks.push(cur); cur = { name: hm[1].trim(), valueProp: '', services: [] } }
      else if (cur && /^[-*] /.test(l)) cur.services.push(l.replace(/^[-*] /, '').replace(/\*\*/g, '').trim())
      else if (cur && l.trim() && !cur.valueProp) cur.valueProp = l.replace(/\*\*/g, '').trim()
    }
    if (cur) blocks.push(cur)
    const gap = 0.22, cW = (12.53 - gap) / 2, cH = (7.25 - 1.05 - gap) / 2
    blocks.slice(0, 4).forEach((b, i) => {
      const cx = 0.4 + (i % 2) * (cW + gap), cy = 1.05 + Math.floor(i / 2) * (cH + gap)
      const bg = cardAccents[i % 4]
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: bg }, line: { color: bg, width: 0 } })
      slide.addText(sanitize(b.name.toUpperCase()), { x: cx + 0.22, y: cy + 0.18, w: cW - 0.35, h: 0.36, fontSize: 11, bold: true, color: 'FFFFFF', fontFace: headFont })
      if (b.valueProp) slide.addText(sanitize(b.valueProp), { x: cx + 0.22, y: cy + 0.58, w: cW - 0.35, h: 0.75, fontSize: 12, color: 'DDDDDD', fontFace: bodyFont, wrap: true })
      if (b.services.length) {
        const sItems = b.services.slice(0, 4).map(s => ({ text: `• ${sanitize(s)}`, options: { color: 'CCCCCC' as string, fontFace: bodyFont, fontSize: 10 as const } }))
        slide.addText(sItems, { x: cx + 0.22, y: cy + 1.42, w: cW - 0.35, h: cH - 1.62, valign: 'top', wrap: true })
      }
    })
    addLogo(slide)
  }

  function renderDeepDive(slide: Slide, title: string, body: string[]) {
    const ne = body.filter(l => l.trim())
    const subH = ne[0]?.replace(/^[-*#> ]+/, '').trim() ?? ''
    const bullets = ne.slice(1).filter(l => /^[-*]/.test(l)).slice(0, 4)
    slide.background = { color: pri }
    slide.addText(sanitize(title.toUpperCase()), { x: 0.4, y: 0.22, w: 6.0, h: 0.55, fontSize: 18, bold: true, color: sec, fontFace: headFont })
    if (subH) slide.addText(sanitize(subH), { x: 0.4, y: 0.88, w: 12.53, h: 0.72, fontSize: 24, bold: true, color: 'FFFFFF', fontFace: headFont, wrap: true })
    const feats = bullets.map(b => {
      const m = b.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*(.+)$/)
      return m ? { title: m[1].trim(), desc: m[2].trim() } : { title: '', desc: b.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim() }
    })
    if (feats.length) {
      const cols = feats.length <= 3 ? feats.length : 4, gap = 0.2
      const cW = (12.53 - gap * (cols - 1)) / cols, cH = 7.25 - 1.85 - 0.25
      feats.forEach((f, i) => {
        const cx = 0.4 + i * (cW + gap), cy = 1.85
        slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: lighten(pri, 0.12) }, line: { color: lighten(pri, 0.2), width: 0.5 } })
        slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: 0.08, h: cH, fill: { color: sec }, line: { color: sec, width: 0 } })
        if (f.title) slide.addText(sanitize(f.title), { x: cx + 0.18, y: cy + 0.18, w: cW - 0.28, h: 0.55, fontSize: 13, bold: true, color: 'FFFFFF', fontFace: headFont, wrap: true })
        slide.addText(sanitize(f.desc), { x: cx + 0.18, y: cy + (f.title ? 0.82 : 0.22), w: cW - 0.28, h: cH - (f.title ? 1.0 : 0.4), fontSize: 11, color: 'AABBCC', fontFace: bodyFont, wrap: true, valign: 'top' })
      })
    }
    addLogo(slide)
  }

  function renderWhyUs(slide: Slide, title: string, body: string[]) {
    whiteHeader(slide, title)
    const ne = body.filter(l => l.trim())
    const statsLine = ne[0] ?? ''
    const statsMatches = [...statsLine.matchAll(/\*\*([^*]+)\*\*\s*([^·•*]+)/g)]
    if (statsMatches.length) {
      const items = statsMatches.slice(0, 5).map(m => ({ stat: m[1].trim(), label: m[2].trim().replace(/[·•,]$/, '').trim() }))
      const bW = Math.min(2.4, (12.53 - 0.6) / items.length - 0.15)
      items.forEach((s, i) => {
        const bx = 0.4 + i * (bW + 0.18)
        slide.addShape(prs.ShapeType.rect, { x: bx, y: 1.05, w: bW, h: 0.72, fill: { color: tint(secondary, 0.1) }, line: { color: tint(secondary, 0.3), width: 0.5 } })
        slide.addText(sanitize(s.stat), { x: bx + 0.05, y: 1.08, w: bW - 0.1, h: 0.39, fontSize: 17, bold: true, color: sec, fontFace: headFont, align: 'center' })
        slide.addText(sanitize(s.label), { x: bx + 0.05, y: 1.47, w: bW - 0.1, h: 0.28, fontSize: 8, color: '5F6B80', fontFace: bodyFont, align: 'center' })
      })
    }
    const diffs = ne.slice(1).filter(l => /^[-*]\s*\*\*/.test(l)).slice(0, 6)
    const gap = 0.2, cW = (12.53 - gap) / 2, cH = 0.9
    diffs.forEach((d, i) => {
      const m = d.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*(.+)$/)
      const label = m ? m[1].trim() : '', desc = m ? m[2].trim() : d.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim()
      const cx = 0.4 + (i % 2) * (cW + gap), cy = 1.92 + Math.floor(i / 2) * (cH + 0.14)
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: 'F0F2FA' }, line: { color: 'E2E6F0', width: 0.5 } })
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: 0.1, h: cH, fill: { color: sec }, line: { color: sec, width: 0 } })
      const items = label
        ? [{ text: `${sanitize(label)}  `, options: { bold: true, color: pri, fontFace: headFont, fontSize: 12 as const } }, { text: sanitize(desc), options: { bold: false, color: '374151', fontFace: bodyFont, fontSize: 11 as const } }]
        : [{ text: sanitize(desc), options: { bold: false, color: '374151', fontFace: bodyFont, fontSize: 11 as const } }]
      slide.addText(items, { x: cx + 0.22, y: cy + 0.12, w: cW - 0.32, h: cH - 0.24, valign: 'middle', wrap: true, fontSize: 11 })
    })
    addLogo(slide)
  }

  function renderCaseStudy(slide: Slide, title: string, body: string[]) {
    whiteHeader(slide, title)
    const pipeLines = body.filter(l => l.includes('|') && l.trim())
    let headers = ['Situation', 'What We Delivered', 'Outcomes']
    const hRow = pipeLines.find(l => /\*\*/.test(l))
    if (hRow) {
      const pts = hRow.split('|').map(p => p.replace(/\*\*/g, '').replace(/^[-*·\s]+/, '').trim()).filter(Boolean)
      if (pts.length >= 3) headers = pts.slice(0, 3)
    }
    const cols3: [string[], string[], string[]] = [[], [], []]
    pipeLines.filter(l => !/^\s*\*\*/.test(l)).forEach(l => {
      const parts = l.split(' | ').map(p => p.replace(/^[-*·\s]+/, '').replace(/·?\s*$/, '').replace(/\*\*/g, '').trim()).filter(Boolean)
      if (parts.length >= 3) { cols3[0].push(parts[0]); cols3[1].push(parts[1]); cols3[2].push(parts[2]) }
    })
    const gap = 0.25, cW = (12.53 - gap * 2) / 3, hH = 0.55, cY = 1.1, bodyH = 7.25 - cY - hH - 0.15
    const accs = [sec, cardAccents[1], cardAccents[2]]
    headers.forEach((h, col) => {
      const cx = 0.4 + col * (cW + gap)
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cY, w: cW, h: hH, fill: { color: accs[col] ?? sec }, line: { color: accs[col] ?? sec, width: 0 } })
      slide.addText(sanitize(h), { x: cx + 0.15, y: cY + 0.07, w: cW - 0.2, h: hH - 0.14, fontSize: 13, bold: true, color: 'FFFFFF', fontFace: headFont, valign: 'middle' })
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cY + hH, w: cW, h: bodyH, fill: { color: 'F5F7FA' }, line: { color: 'E2E6F0', width: 0.5 } })
      cols3[col].slice(0, 4).forEach((txt, ri) => {
        slide.addText(`• ${sanitize(txt)}`, { x: cx + 0.15, y: cY + hH + 0.15 + ri * 1.35, w: cW - 0.25, h: 1.2, fontSize: 11, color: '374151', fontFace: bodyFont, wrap: true, valign: 'top' })
      })
    })
    addLogo(slide)
  }

  function renderCtaPaths(slide: Slide, title: string, body: string[]) {
    const sub = body.find(l => !l.startsWith('-') && !l.startsWith('*') && l.trim() && !l.startsWith('#'))
    whiteHeader(slide, title, sub)
    const paths: { name: string; trigger: string; cta: string; url: string }[] = []
    let cur: typeof paths[0] | null = null
    for (const l of body) {
      if (/^[-*]\s*\*\*[^*]+\*\*/.test(l) && !l.includes('→')) {
        if (cur) paths.push(cur)
        const m = l.match(/^[-*]\s*\*\*([^*]+)\*\*\s*[—–-]\s*(.+)$/)
        cur = { name: m ? m[1].trim() : '', trigger: m ? m[2].trim() : '', cta: '', url: '' }
      } else if (l.includes('→') && cur) {
        const m = l.trim().match(/→\s*([^—–]+?)(?:\s*[—–]\s*(.+))?$/)
        if (m) { cur.cta = m[1].trim(); cur.url = m[2]?.trim() ?? '' }
      }
    }
    if (cur) paths.push(cur)
    const sY = sub ? 1.38 : 1.08, gap = 0.22, cW = (12.53 - gap) / 2, cH = sub ? 2.45 : 2.7
    paths.slice(0, 4).forEach((p, i) => {
      const cx = 0.4 + (i % 2) * (cW + gap), cy = sY + Math.floor(i / 2) * (cH + gap)
      const acc = cardAccents[i % 4]
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: cH, fill: { color: 'F5F7FA' }, line: { color: 'E2E6F0', width: 0.5 } })
      slide.addShape(prs.ShapeType.rect, { x: cx, y: cy, w: cW, h: 0.09, fill: { color: acc }, line: { color: acc, width: 0 } })
      slide.addText(sanitize(p.name), { x: cx + 0.18, y: cy + 0.18, w: cW - 0.28, h: 0.52, fontSize: 14, bold: true, color: pri, fontFace: headFont, wrap: true })
      if (p.trigger) slide.addText(sanitize(p.trigger), { x: cx + 0.18, y: cy + 0.76, w: cW - 0.28, h: 0.7, fontSize: 11, color: '5F6B80', fontFace: bodyFont, wrap: true })
      if (p.cta) {
        const ctaY = cy + cH - 0.65
        slide.addShape(prs.ShapeType.rect, { x: cx + 0.18, y: ctaY, w: cW - 0.36, h: 0.45, fill: { color: acc }, line: { color: acc, width: 0 } })
        slide.addText(`${sanitize(p.cta)}${p.url ? `  ·  ${sanitize(p.url)}` : ''}`, { x: cx + 0.18, y: ctaY, w: cW - 0.36, h: 0.45, fontSize: 10, bold: true, color: 'FFFFFF', fontFace: headFont, align: 'center', valign: 'middle' })
      }
    })
    addLogo(slide)
  }

  function renderBullets(slide: Slide, title: string, body: string[]) {
    whiteHeader(slide, title)
    const items = body.filter(l => l.trim() && !l.startsWith('#')).map(l => {
      const isBullet = /^[-*] /.test(l)
      const raw = sanitize(isBullet ? l.slice(2) : l).trim()
      if (raw.includes('**')) {
        return raw.split(/\*\*/).map((part, pi) => ({ text: part, options: { bullet: isBullet && pi === 0, bold: pi % 2 === 1, color: '1A1A14' as string, fontFace: bodyFont } }))
      }
      return [{ text: raw, options: { bullet: isBullet, bold: false, color: '1A1A14' as string, fontFace: bodyFont } }]
    }).flat()
    if (items.length) slide.addText(items, { x: 0.4, y: 1.05, w: 12.53, h: 6.0, fontSize: 13, valign: 'top', wrap: true })
    addLogo(slide)
  }

  // ── Parse and render ──────────────────────────────────────────────────────
  const blocks = markdown.split(/(?=^## Slide \d+:)/m).filter(b => b.trim())

  if (!blocks.length) {
    const sl = prs.addSlide()
    sl.background = { color: 'FFFFFF' }
    sl.addText(sanitize(markdown.substring(0, 800)), { x: 0.4, y: 0.5, w: 12.2, h: 6, fontSize: 12, fontFace: bodyFont, valign: 'top', wrap: true })
  } else {
    blocks.forEach((block, idx) => {
      const tm = block.match(/^## Slide \d+:\s*(.+)/)
      const title = tm ? tm[1].trim() : ''
      const bodyLines = block.split('\n').slice(1)
      const layout = detectLayout(idx, blocks.length, bodyLines)
      const slide = prs.addSlide()
      switch (layout) {
        case 'cover':       renderCover(slide, title, bodyLines); break
        case 'closing':     renderClosing(slide, title, bodyLines); break
        case 'stats':       renderStats(slide, title, bodyLines); break
        case 'challenges':  renderChallenges(slide, title, bodyLines); break
        case 'frameworks':  renderFrameworks(slide, title, bodyLines); break
        case 'pillars':     renderPillars(slide, title, bodyLines); break
        case 'deepdive':    renderDeepDive(slide, title, bodyLines); break
        case 'whyus':       renderWhyUs(slide, title, bodyLines); break
        case 'casestudy':   renderCaseStudy(slide, title, bodyLines); break
        case 'ctapaths':    renderCtaPaths(slide, title, bodyLines); break
        default:            renderBullets(slide, title, bodyLines)
      }
    })
  }

  const ab = await prs.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  return new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

// ── HTML branding injection ────────────────────────────────────────────────────

function injectDocStyleIntoHtml(html: string, docStyle: DocStyle): string {
  const primary   = docStyle.primaryColor
  const secondary = docStyle.secondaryColor
  const headFont  = docStyle.headingFont
  const bodyFont  = docStyle.bodyFont

  const styleOverride = `
<style>
  /* ContentNode branded export */
  :root {
    --brand-primary: ${primary};
    --brand-secondary: ${secondary};
    --heading-font: '${headFont}', sans-serif;
    --body-font: '${bodyFont}', sans-serif;
    --color-primary: ${primary};
    --color-dark: ${primary};
    --color-accent: ${secondary};
  }
</style>`

  // Inject before </head>; if missing try before <body; skip entirely for malformed HTML
  let result = html.includes('</head>')
    ? html.replace('</head>', styleOverride + '\n</head>')
    : html.includes('<body')
      ? html.replace('<body', styleOverride + '\n<body')
      : html

  // Logo: height:36px + width:auto preserves aspect ratio — never set both to fixed values
  if (docStyle.logoDataUrl) {
    const logoScript = `
<script>
(function() {
  var logo = ${JSON.stringify(docStyle.logoDataUrl)};
  document.addEventListener('DOMContentLoaded', function() {
    var navs = document.querySelectorAll('nav, .nav, header, .site-header, .top-bar');
    if (navs.length) {
      var img = document.createElement('img');
      img.src = logo;
      img.alt = 'Logo';
      img.style.cssText = 'height:36px;width:auto;max-width:160px;object-fit:contain;display:block;margin-right:12px;';
      navs[0].insertBefore(img, navs[0].firstChild);
    }
  });
})();
</script>`
    result = result.includes('</body>')
      ? result.replace('</body>', logoScript + '\n</body>')
      : result + logoScript
  }

  return result
}

// ── BDR Emails specialized renderer ───────────────────────────────────────────

export async function buildBdrEmailsDocxBlob(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Blob> {
  const primary    = hexNoHash(docStyle.primaryColor)
  const secondary  = hexNoHash(docStyle.secondaryColor)
  const hf         = docStyle.headingFont
  const bf         = docStyle.bodyFont
  const bodyColor  = '1A1A14'
  const borderCol  = 'E0DEDA'
  const mutedColor = '6B7280'
  const cb = { style: BorderStyle.SINGLE, size: 4, color: borderCol } as const
  const nb = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const

  // ── Email block builder ──────────────────────────────────────────────────────
  function buildEmailBlock(
    lines: string[],
    emailNum: number | null,
    segmentName: string,
  ): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = []

    // Page break — each email starts on its own page (no-op for the first email at section start)
    elements.push(new Paragraph({ pageBreakBefore: true, children: [] }))

    // Parse subject/preview first so subject line can appear in header
    let subjectLine = ''
    let previewText = ''
    const bodyLines: string[] = []

    for (const line of lines) {
      const subM = line.match(/^\*\*Subject(?:\s+Line)?[:\*]*\*\*\s*(.+)/i)
      const preM = line.match(/^\*\*Preview(?:\s+Text)?[:\*]*\*\*\s*(.+)/i)
      if (subM)  { subjectLine = subM[1].replace(/\*\*/g, '').trim(); continue }
      if (preM)  { previewText = preM[1].replace(/\*\*/g, '').trim(); continue }
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

    // Email body
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
        elements.push(new Paragraph({
          spacing: { after: 80 },
          children: parseInlineRuns(line, bf, 24, bodyColor),
        }))
      }
    }

    // Bottom separator
    elements.push(new Paragraph({
      spacing: { before: 200, after: 0 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: borderCol, space: 4 } },
      children: [],
    }))

    return elements
  }

  // ── Parse sections ────────────────────────────────────────────────────────────
  const rawSections = markdown.split(/^(?=## )/m).filter(s => s.trim())
  const sections = rawSections.map(s => {
    const lines = s.split('\n')
    const m = lines[0].match(/^## (.+)/)
    return { name: (m ? m[1] : '').trim().toLowerCase(), title: m ? m[1].trim() : '', lines: lines.slice(1) }
  })

  const coverSection = sections.find(s => s.name === 'cover')
  const coverTagline = coverSection?.lines.find(l => l.trim())?.trim() ?? 'Call Scripts and Emails'
  const coverChildren = coverSection
    ? await buildMarkdownCoverSection(coverSection.lines, docStyle)
    : await buildCoverSection(docStyle, 'BDR Call Scripts and Emails', clientName, verticalName)

  const body: (Paragraph | Table)[] = []

  function renderGenericLines(lines: string[]) {
    let tableLines: string[] = []
    const flush = () => {
      if (!tableLines.length) return
      const dr = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
      if (dr.length) body.push(buildStyledTable(tableLines, docStyle))
      tableLines = []
    }
    for (const line of lines) {
      if (line.startsWith('|')) { tableLines.push(line); continue }
      flush()
      if      (line.startsWith('# '))    body.push(new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: sanitize(line.slice(2)), font: hf, size: 36, bold: true, color: primary })] }))
      else if (line.startsWith('## '))   body.push(new Paragraph({ spacing: { before: 160, after: 80  }, children: [new TextRun({ text: sanitize(line.slice(3)), font: hf, size: 28, bold: true, color: primary })] }))
      else if (line.startsWith('### '))  body.push(new Paragraph({ spacing: { before: 120, after: 60  }, children: [new TextRun({ text: sanitize(line.slice(4)), font: hf, size: 24, bold: true, color: secondary })] }))
      else if (/^[-*] /.test(line))      body.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), bf, 22, bodyColor) }))
      else if (line.startsWith('> '))    body.push(new Paragraph({ indent: { left: 720 }, children: parseInlineRuns(line.slice(2), bf, 22, bodyColor) }))
      else if (/^---+$|^===+$/.test(line.trim())) body.push(buildHRule(docStyle.primaryColor))
      else if (line.trim() === '')        body.push(new Paragraph({}))
      else                               body.push(new Paragraph({ spacing: { after: 80 }, children: parseInlineRuns(line, bf, 22, bodyColor) }))
    }
    flush()
  }

  for (const { name, title, lines } of sections) {
    if (name === 'cover') continue

    // Email N — Segment Name
    const emailMatch = name.match(/^email\s+(\d+)(?:\s*[—\-–:]\s*(.+))?/)
    if (emailMatch) {
      const num = parseInt(emailMatch[1], 10)
      const segment = emailMatch[2]?.trim() ?? title.replace(/^email\s+\d+\s*[—\-–:]\s*/i, '').trim()
      body.push(...buildEmailBlock(lines, num, segment))
      continue
    }

    if (name.includes('call script')) {
      // Section heading for call scripts
      body.push(new Paragraph({
        spacing: { before: 320, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, color: borderCol, size: 4, space: 6 } },
        children: [new TextRun({ text: sanitize(title), font: hf, size: 32, bold: true, color: primary })],
      }))
      renderGenericLines(lines)
      body.push(new Paragraph({}))
      continue
    }

    if (name.includes('how to use') || name.includes('usage') || name.includes('instructions')) {
      const calloutBg = tint(docStyle.secondaryColor, 0.08)
      const text = lines.filter(l => l.trim()).join(' ')
      if (text) {
        body.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: cb, bottom: cb, left: cb, right: cb, insideHorizontal: nb, insideVertical: nb },
          rows: [new TableRow({
            children: [new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { fill: calloutBg, type: ShadingType.SOLID, color: calloutBg },
              margins: { top: 120, bottom: 120, left: 200, right: 200 },
              children: [
                new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'How to use', font: hf, size: 20, bold: true, color: secondary })] }),
                new Paragraph({ children: parseInlineRuns(text, bf, 20, '4A5568') }),
              ],
            })],
          })],
        }))
        body.push(new Paragraph({}))
      }
      continue
    }

    // Contents / TOC — render as two-column list
    if (name.includes('content') || name.includes('table of content')) {
      body.push(new Paragraph({
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: 'Contents', font: hf, size: 28, bold: true, color: primary })],
      }))
      renderGenericLines(lines)
      body.push(new Paragraph({}))
      continue
    }

    // Everything else
    body.push(new Paragraph({
      spacing: { before: 320, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, color: borderCol, size: 4, space: 6 } },
      children: [new TextRun({ text: sanitize(title), font: hf, size: 32, bold: true, color: primary })],
    }))
    renderGenericLines(lines)
    body.push(new Paragraph({}))
  }

  // ── Header ────────────────────────────────────────────────────────────────────
  const docHeader = new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, color: secondary, size: 6, space: 4 } },
      spacing: { after: 80 },
      children: [
        new TextRun({ text: sanitize(clientName), font: hf, size: 18, bold: true, color: primary }),
        new TextRun({ text: `  |  ${sanitize(verticalName)}  |  BDR Call Scripts and Emails`, font: hf, size: 18, color: mutedColor }),
      ],
    })],
  })

  // ── Footer ────────────────────────────────────────────────────────────────────
  const docFooter = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: 'right' as const, position: 9026 }],
      border: { top: { style: BorderStyle.SINGLE, color: borderCol, size: 4, space: 4 } },
      children: [
        new TextRun({ text: `${sanitize(clientName)}  |  Call Scripts and Emails  |  Internal Use Only`, font: hf, size: 16, italics: true, color: mutedColor }),
        new TextRun({ text: '\t', font: hf, size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], font: hf, size: 16, color: mutedColor }),
      ],
    })],
  })

  const doc = new Document({
    styles: { paragraphStyles: [{ id: 'Normal', name: 'Normal', run: { font: bf, size: 22, color: bodyColor } }] },
    sections: [
      { properties: { type: SectionType.NEXT_PAGE }, children: coverChildren },
      { headers: { default: docHeader }, footers: { default: docFooter }, children: body },
    ],
  })

  return Packer.toBlob(doc)
}

// ── Internal Brief specialized renderer ────────────────────────────────────────

export async function buildInternalBriefDocxBlob(
  markdown: string,
  docStyle: DocStyle,
  clientName: string,
  verticalName: string,
): Promise<Blob> {
  const DARK_NAVY    = '092648'
  const BRAND_BLUE   = '2E74B5'
  const STAT_BLUE    = '3358FF'
  const MID_GRAY     = '4A5A72'
  const HEAD_NAVY    = '1C3557'
  const CELL_TEXT    = 'AABBD0'
  const BORDER_LIGHT = 'D0D6E4'
  const hf           = 'Arial'
  const bf           = docStyle.bodyFont || 'Arial'
  const bodyColor    = '1A1A14'
  const currentYear  = new Date().getFullYear()

  const body: (Paragraph | Table)[] = []

  // ── Title block ────────────────────────────────────────────────────────────
  body.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: clientName, font: hf, size: 56, bold: true, color: DARK_NAVY })] }))
  body.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: verticalName, font: hf, size: 28, bold: true, color: BRAND_BLUE })] }))
  body.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: 'GTM Launch Brief', font: hf, size: 40, bold: true, color: DARK_NAVY })] }))
  body.push(new Paragraph({ spacing: { before: 0, after: 120 }, children: [new TextRun({ text: `Internal Use Only · Sales + Marketing · ${currentYear}`, font: bf, size: 22, color: MID_GRAY })] }))
  body.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: STAT_BLUE, size: 6, space: 1 } }, spacing: { after: 240 }, children: [] }))

  // ── Helpers ────────────────────────────────────────────────────────────────
  function ibHeading(text: string): Paragraph {
    return new Paragraph({
      spacing: { before: 400, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, color: BORDER_LIGHT, size: 3, space: 6 } },
      children: [new TextRun({ text: sanitize(text), font: hf, size: 36, bold: true, color: HEAD_NAVY })],
    })
  }

  function buildStatBoxes(tableLines: string[]): Table {
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    const stats  = (dataRows[0] ?? '').split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim())
    const labels = (dataRows[1] ?? '').split('|').slice(1, -1).map(c => c.trim())
    while (stats.length < 4) stats.push('–')
    while (labels.length < 4) labels.push('')
    const cb = { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT }
    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      borders: { top: cb, bottom: cb, left: cb, right: cb, insideHorizontal: cb, insideVertical: cb },
      rows: [new TableRow({
        children: stats.map((stat, i) => new TableCell({
          width: { size: 2340, type: WidthType.DXA },
          margins: { top: 160, bottom: 160, left: 120, right: 120 },
          shading: { fill: DARK_NAVY, type: ShadingType.CLEAR, color: DARK_NAVY },
          children: [
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: stat, font: hf, size: 28, bold: true, color: STAT_BLUE })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: labels[i] ?? '', font: bf, size: 22, color: CELL_TEXT })] }),
          ],
        })),
      })],
    })
  }

  function renderLines(lines: string[]) {
    let tbl: string[] = []
    const flush = () => {
      if (!tbl.length) return
      const dr = tbl.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
      if (dr.length) body.push(buildStyledTable(tbl, docStyle))
      tbl = []
    }
    for (const line of lines) {
      if (line.startsWith('|')) { tbl.push(line); continue }
      flush()
      if      (/^#{1,6} /.test(line)) { /* section headings handled by routing */ }
      else if (/^[-*] /.test(line))   body.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), bf, 22, bodyColor) }))
      else if (line.startsWith('> ')) body.push(new Paragraph({ indent: { left: 720 }, children: parseInlineRuns(line.slice(2), bf, 22, bodyColor) }))
      else if (/^---+$|^===+$/.test(line.trim())) body.push(buildHRule(docStyle.primaryColor))
      else if (line.trim() === '')    body.push(new Paragraph({}))
      else                           body.push(new Paragraph({ children: parseInlineRuns(line, bf, 22, bodyColor) }))
    }
    flush()
  }

  // ── Parse sections ─────────────────────────────────────────────────────────
  const stripped = markdown.replace(/^(?:# [^\n]*\n?)+/m, '').trim()
  const sections = stripped.split(/^(?=## )/m).filter(s => s.trim()).map(s => {
    const lines = s.split('\n')
    const m = lines[0].match(/^## (.+)/)
    return { name: (m ? m[1] : '').trim().toLowerCase(), title: m ? m[1].trim() : '', lines: lines.slice(1) }
  })

  for (const { name, title, lines } of sections) {
    if (name === 'cover') continue

    body.push(ibHeading(title))

    if (name.includes('why this') || name.includes('why now')) {
      // Stat table first, then narrative
      const tblLines: string[] = []
      const rest: string[] = []
      for (const line of lines) {
        if (line.startsWith('|')) tblLines.push(line)
        else rest.push(line)
      }
      if (tblLines.length) { body.push(buildStatBoxes(tblLines)); body.push(new Paragraph({})) }
      renderLines(rest)
    } else {
      renderLines(lines)
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  const docHeader = new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, color: STAT_BLUE, size: 6, space: 4 } },
      spacing: { after: 80 },
      children: [
        new TextRun({ text: clientName, font: hf, size: 18, bold: true, color: DARK_NAVY }),
        new TextRun({ text: `  |  ${verticalName}  |  GTM Launch Brief`, font: hf, size: 18, color: MID_GRAY }),
      ],
    })],
  })

  // ── Footer (tab stop layout — never a table) ────────────────────────────────
  const docFooter = new Footer({
    children: [new Paragraph({
      tabStops: [{ type: 'right' as const, position: 9026 }],
      border: { top: { style: BorderStyle.SINGLE, color: BORDER_LIGHT, size: 6, space: 4 } },
      children: [
        new TextRun({ text: `${clientName} ${verticalName}  |  Internal Use Only`, font: hf, size: 16, italics: true, color: MID_GRAY }),
        new TextRun({ text: '\tPage ', font: hf, size: 16, color: MID_GRAY }),
        new TextRun({ children: [PageNumber.CURRENT], font: hf, size: 16, color: MID_GRAY }),
      ],
    })],
  })

  const doc = new Document({
    styles: { paragraphStyles: [{ id: 'Normal', name: 'Normal', run: { font: bf, size: 22, color: bodyColor } }] },
    sections: [{ headers: { default: docHeader }, footers: { default: docFooter }, children: body }],
  })

  return Packer.toBlob(doc)
}

// ── Main download entry point ──────────────────────────────────────────────────

export async function downloadKit(
  asset: AssetForDownload,
  clientName: string,
  verticalName: string,
  docStyle?: DocStyle,
): Promise<void> {
  const style = docStyle ?? DEFAULT_STYLE
  const filename = `${clientName} ${verticalName} Kit - ${asset.num} ${asset.name}.${asset.ext}`
  let blob: Blob

  if (asset.ext === 'html') {
    const branded = injectDocStyleIntoHtml(asset.content, style)
    blob = new Blob([branded], { type: 'text/html;charset=utf-8' })
  } else if (asset.ext === 'pptx') {
    blob = await markdownToPptxBlob(asset.content, style)
  } else if (asset.ext === 'docx' && asset.index === 0) {
    blob = await buildBrochureDocxBlob(asset.content, style, clientName, verticalName)
  } else if (asset.ext === 'docx' && asset.index === 3) {
    blob = await buildBdrEmailsDocxBlob(asset.content, style, clientName, verticalName)
  } else if (asset.ext === 'docx' && asset.index === 7) {
    blob = await buildInternalBriefDocxBlob(asset.content, style, clientName, verticalName)
  } else {
    blob = await markdownToDocxBlob(asset.content, style, {
      assetName: asset.name,
      clientName,
      verticalName,
    })
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
