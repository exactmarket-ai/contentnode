import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType,
  Footer, PageNumber,
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
    } else if (name.includes('pillar')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('Our Four Pillars')] }))
      body.push(buildPillars2x2(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('why')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('Why Us')] }))
      renderGeneric(lines)
      body.push(new Paragraph({}))
    } else if (name.includes('proof')) {
      body.push(buildHRule(docStyle.primaryColor))
      body.push(buildProofStrip(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('case')) {
      body.push(new Paragraph({ style: 'Heading2', children: [new TextRun('Client Stories')] }))
      body.push(...buildCaseStudies(lines, docStyle))
      body.push(new Paragraph({}))
    } else if (name.includes('back cover') || name.includes('back') || name.includes('cta')) {
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

  const lines = markdown.split('\n')
  const children: (Paragraph | Table)[] = []
  let tableLines: string[] = []

  function flushTable() {
    if (!tableLines.length) return
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    if (dataRows.length) children.push(buildStyledTable(tableLines, docStyle))
    tableLines = []
  }

  for (const line of lines) {
    if (line.startsWith('|')) { tableLines.push(line); continue }
    flushTable()

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

  const hasCover = docStyle.includeCoverPage && !!meta?.assetName
  const coverChildren = hasCover
    ? await buildCoverSection(docStyle, meta!.assetName!, meta!.clientName ?? '', meta!.verticalName ?? '')
    : []

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
      ...(hasCover ? [{
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
  prs.layout = 'LAYOUT_WIDE'

  const primary    = docStyle.primaryColor
  const secondary  = docStyle.secondaryColor ?? '#4A90D9'
  const headFont   = docStyle.headingFont
  const bodyFont   = docStyle.bodyFont
  const titleColor = primary.replace('#', '')
  const accentHex  = secondary.replace('#', '')

  // Compute logo placement once: height fixed at 0.4", width from natural aspect ratio.
  // If dimensions cannot be determined, logoW is null and we fall back to agency name text.
  const LOGO_H = 0.4 // inches
  let pptxLogoW: number | null = null
  if (docStyle.logoDataUrl) {
    const dims = await getImageDimensions(docStyle.logoDataUrl)
    if (dims && dims.h > 0) {
      pptxLogoW = parseFloat((LOGO_H * (dims.w / dims.h)).toFixed(3))
    }
  }

  // Helper: add branded top bar + title — used by all content slides
  function addSlideHeader(slide: ReturnType<typeof prs.addSlide>, title: string) {
    slide.background = { color: 'FFFFFF' }
    slide.addShape(prs.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 0.11,
      fill: { color: titleColor },
      line: { color: titleColor, width: 0 },
    })
    slide.addText(sanitize(title), {
      x: 0.4, y: 0.18, w: 10.5, h: 0.75,
      fontSize: 22, bold: true, color: titleColor, fontFace: headFont,
    })
  }

  // Helper: stat card grid — renders 3-4 stat cards as a 2×2 (or 1×3) visual grid
  function renderStatCards(
    slide: ReturnType<typeof prs.addSlide>,
    cards: { stat: string; label: string; source: string }[],
    narrativeLines: string[],
  ) {
    const cols = cards.length <= 2 ? cards.length : 2
    const rows = Math.ceil(cards.length / cols)
    const cardW = cols === 2 ? 5.8 : 8.0
    const cardH = rows === 1 ? 2.2 : 1.85
    const startX = cols === 2 ? 0.4 : 2.67
    const startY = 1.05
    const gapX = cols === 2 ? 0.95 : 0
    const gapY = 0.2

    cards.forEach((card, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = startX + col * (cardW + gapX)
      const y = startY + row * (cardH + gapY)

      slide.addShape(prs.ShapeType.rect, {
        x, y, w: cardW, h: cardH,
        fill: { color: 'F3F4F6' },
        line: { color: 'E5E7EB', width: 0.5 },
      })
      // Large stat number
      slide.addText(sanitize(card.stat), {
        x: x + 0.18, y: y + 0.15, w: cardW - 0.36, h: cardH * 0.5,
        fontSize: rows === 1 ? 38 : 32, bold: true, color: titleColor, fontFace: headFont,
        valign: 'middle',
      })
      // Label
      slide.addText(sanitize(card.label), {
        x: x + 0.18, y: y + cardH * 0.58, w: cardW - 0.36, h: cardH * 0.26,
        fontSize: 11, color: '374151', fontFace: bodyFont, wrap: true,
      })
      // Source
      if (card.source) {
        slide.addText(sanitize(card.source), {
          x: x + 0.18, y: y + cardH * 0.83, w: cardW - 0.36, h: cardH * 0.17,
          fontSize: 9, color: '9CA3AF', fontFace: bodyFont,
        })
      }
    })

    // Narrative below the grid
    if (narrativeLines.length > 0) {
      const narrativeY = startY + rows * (cardH + gapY) + 0.15
      const narrativeText = narrativeLines.map(l => l.replace(/^[-*]\s*/, '').trim()).join(' ')
      slide.addText(sanitize(narrativeText), {
        x: 0.4, y: narrativeY, w: 12.5, h: 7.5 - narrativeY - 0.5,
        fontSize: 12, color: '4B5563', fontFace: bodyFont, wrap: true,
      })
    }
  }

  const slideBlocks = markdown.split(/(?=^## Slide \d+:)/m).filter(b => b.trim())

  if (!slideBlocks.length) {
    const slide = prs.addSlide()
    slide.background = { color: 'FFFFFF' }
    slide.addText(sanitize(markdown.substring(0, 800)), { x: 0.4, y: 0.5, w: 12.2, h: 6, fontSize: 12, fontFace: bodyFont, valign: 'top', wrap: true })
  } else {
    slideBlocks.forEach((block, blockIdx) => {
      const titleMatch = block.match(/^## Slide \d+:\s*(.+)/)
      const title = titleMatch ? titleMatch[1].trim() : ''
      const bodyLines = block.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('##'))

      const isCover   = blockIdx === 0
      const isDivider = title.toLowerCase().includes('section') || bodyLines.length === 0
      const isClosing = blockIdx > 0 && bodyLines.length > 0 &&
        !bodyLines.some(l => /^[-*] /.test(l)) === false &&
        title.length > 10 // closing slide has a long tagline title

      const slide = prs.addSlide()

      if (isCover || isDivider) {
        slide.background = { color: primary.replace('#', '') }

        if (isCover) {
          // Always render a rich cover — use body lines if present, fall back gracefully
          slide.addText(sanitize(title), {
            x: 0.6, y: 1.5, w: 12.1, h: 2.0,
            fontSize: 40, bold: true, color: 'FFFFFF', fontFace: headFont,
            align: 'center', valign: 'middle', wrap: true,
          })
          const subtitleRaw = bodyLines[0]?.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim() ?? ''
          if (subtitleRaw) {
            slide.addText(sanitize(subtitleRaw), {
              x: 1.0, y: 3.65, w: 11.33, h: 0.75,
              fontSize: 17, bold: false, color: 'DDDDDD', fontFace: bodyFont,
              align: 'center', valign: 'middle', wrap: true,
            })
          }
          const clientRaw = bodyLines[1]?.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim() ?? ''
          if (clientRaw) {
            slide.addText(sanitize(clientRaw), {
              x: 1.0, y: 4.55, w: 11.33, h: 0.5,
              fontSize: 13, bold: false, color: 'AAAAAA', fontFace: bodyFont,
              align: 'center', valign: 'middle',
            })
          }
          // Accent bar
          slide.addShape(prs.ShapeType.rect, {
            x: 0, y: 7.12, w: '100%', h: 0.15,
            fill: { color: accentHex },
            line: { color: accentHex, width: 0 },
          })
        } else {
          slide.addText(sanitize(title), {
            x: 0.4, y: 3.0, w: 12.2, h: 1.2,
            fontSize: 28, bold: true, color: 'FFFFFF', fontFace: headFont,
            align: 'center', valign: 'middle',
          })
        }
      } else if (isClosing) {
        // Closing slide: dark background like cover
        slide.background = { color: primary.replace('#', '') }
        slide.addText(sanitize(title), {
          x: 0.6, y: 1.2, w: 12.1, h: 1.8,
          fontSize: 38, bold: true, color: 'FFFFFF', fontFace: headFont,
          align: 'center', valign: 'middle', wrap: true,
        })
        const bodyText = bodyLines.map(l => l.replace(/^[-*] /, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim()).filter(Boolean)
        bodyText.forEach((line, i) => {
          slide.addText(sanitize(line), {
            x: 1.0, y: 3.2 + i * 0.62, w: 11.33, h: 0.55,
            fontSize: 13, color: i === 0 ? 'DDDDDD' : 'AAAAAA', fontFace: bodyFont,
            align: 'center',
          })
        })
        slide.addShape(prs.ShapeType.rect, {
          x: 0, y: 7.12, w: '100%', h: 0.15,
          fill: { color: accentHex },
          line: { color: accentHex, width: 0 },
        })
      } else {
        addSlideHeader(slide, title)

        if (bodyLines.length) {
          // Detect stat-card layout: 3+ bullet lines starting with **[number/stat]**
          const statCards = bodyLines
            .slice(0, 4)
            .map(l => parseStatLine(l))
          const validCards = statCards.filter((c): c is NonNullable<typeof c> => c !== null)

          if (validCards.length >= 3) {
            renderStatCards(slide, validCards, bodyLines.slice(validCards.length))
          } else {
            const textItems = bodyLines.map(l => {
              const isBullet = /^[-*] /.test(l)
              const raw = sanitize(isBullet ? l.slice(2) : l).trim()
              // Handle **bold text** — keep bold markers for inline bold
              const hasBoldMarkers = raw.includes('**')
              if (hasBoldMarkers) {
                const parts = raw.split(/\*\*/)
                return parts.map((part, pi) => ({
                  text: part,
                  options: {
                    bullet: isBullet && pi === 0,
                    bold: pi % 2 === 1,
                    color: '1A1A14' as string,
                    fontFace: bodyFont,
                  },
                }))
              }
              return [{
                text: raw,
                options: { bullet: isBullet, bold: false, color: '1A1A14' as string, fontFace: bodyFont },
              }]
            }).flat()
            slide.addText(textItems, { x: 0.4, y: 1.05, w: 12.2, h: 5.65, fontSize: 13, valign: 'top', wrap: true })
          }
        }
      }

      // Logo (aspect-ratio preserved) or agency name text fallback in bottom-right corner
      if (docStyle.logoDataUrl && pptxLogoW !== null) {
        try {
          const lx = parseFloat(Math.max(0, 13.33 - pptxLogoW - 0.3).toFixed(3))
          slide.addImage({ data: docStyle.logoDataUrl, x: lx, y: 6.85, w: pptxLogoW, h: LOGO_H })
        } catch { /* skip on error */ }
      } else if (docStyle.agencyName) {
        slide.addText(docStyle.agencyName, {
          x: 10.5, y: 6.9, w: 2.5, h: 0.35,
          fontSize: 7, color: 'AAAAAA', fontFace: bodyFont, align: 'right',
        })
      }
    })
  }

  const buffer = await prs.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
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
    // Brochure uses a specialized section-aware renderer
    blob = await buildBrochureDocxBlob(asset.content, style, clientName, verticalName)
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
