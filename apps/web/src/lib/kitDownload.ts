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

// Mix hex color with white at given opacity (0–1)
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
  const dataRows   = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
  const bodyFont   = docStyle.bodyFont
  const bodySize   = 20 // 10pt in half-points

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:     { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      bottom:  { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      left:    { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      right:   { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: borderCol },
      insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: borderCol },
    },
    rows: dataRows.map((row, rowIdx) => {
      const cells   = row.split('|').slice(1, -1).map(c => c.trim())
      const isHead  = rowIdx === 0
      const isAlt   = !isHead && rowIdx % 2 === 0
      const fill    = isHead ? primary : isAlt ? altRow : 'FFFFFF'
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
  if (docStyle.agencyName) parts.push(new TextRun({ text: docStyle.agencyName, font, size, color: muted }))
  if (docStyle.footerText) {
    if (parts.length) parts.push(new TextRun({ text: '    ', font, size }))
    parts.push(new TextRun({ text: docStyle.footerText, font, size, color: muted }))
  }
  parts.push(new TextRun({ text: '\t', font, size }))
  parts.push(new TextRun({ children: [PageNumber.CURRENT], font, size, color: muted }))
  parts.push(new TextRun({ text: ' / ', font, size, color: muted }))
  parts.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size, color: muted }))
  return new Footer({ children: [new Paragraph({ children: parts, tabStops: [{ type: 'right', position: 9360 }] })] })
}

function buildCoverSection(docStyle: DocStyle, assetName: string, clientName: string, verticalName: string): (Paragraph | Table)[] {
  const primary = hexNoHash(docStyle.primaryColor)
  const coverItems: (Paragraph | Table)[] = []

  // Logo
  if (docStyle.logoDataUrl) {
    try {
      const logoType = imageTypeFromDataUrl(docStyle.logoDataUrl)
      if (logoType) {
        const logoData = dataUrlToArrayBuffer(docStyle.logoDataUrl)
        coverItems.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 720, after: 480 },
          children: [new ImageRun({ data: logoData, type: logoType, transformation: { width: 200, height: 80 } })],
        }))
      }
    } catch { /* skip on error */ }
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
        top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
      rows: [new TableRow({
        height: { value: convertInchesToTwip(9.5), rule: HeightRule.EXACT },
        children: [new TableCell({
          shading: { fill: primary, type: ShadingType.SOLID, color: primary },
          children: coverItems as Paragraph[],
        })],
      })],
    }),
  ]
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

    if      (line.startsWith('# '))   children.push(new Paragraph({ style: 'Heading1', children: [new TextRun(sanitize(line.slice(2)))] }))
    else if (line.startsWith('## '))  children.push(new Paragraph({ style: 'Heading2', children: [new TextRun(sanitize(line.slice(3)))] }))
    else if (line.startsWith('### ')) children.push(new Paragraph({ style: 'Heading3', children: [new TextRun(sanitize(line.slice(4)))] }))
    else if (line.startsWith('#### '))children.push(new Paragraph({ style: 'Heading4', children: [new TextRun(sanitize(line.slice(5)))] }))
    else if (/^[-*] /.test(line))     children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2), bodyFont, 22, bodyColor) }))
    else if (line.startsWith('> '))   children.push(new Paragraph({ indent: { left: 720 }, children: parseInlineRuns(line.slice(2), bodyFont, 22, bodyColor) }))
    else if (/^---+$|^===+$/.test(line.trim())) children.push(buildHRule(docStyle.primaryColor))
    else if (line.trim() === '')      children.push(new Paragraph({}))
    else                              children.push(new Paragraph({ children: parseInlineRuns(line, bodyFont, 22, bodyColor) }))
  }
  flushTable()

  const hasCover = docStyle.includeCoverPage && !!meta?.assetName
  const coverChildren = hasCover
    ? buildCoverSection(docStyle, meta!.assetName!, meta!.clientName ?? '', meta!.verticalName ?? '')
    : []

  const footers = docStyle.includePageNumbers
    ? { default: buildFooterElement(docStyle) }
    : undefined

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

export async function markdownToPptxBlob(markdown: string, docStyle: DocStyle = DEFAULT_STYLE): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const prs = new PptxGenJS()
  prs.layout = 'LAYOUT_WIDE'

  const primary   = docStyle.primaryColor
  const secondary = docStyle.secondaryColor
  const headFont  = docStyle.headingFont
  const bodyFont  = docStyle.bodyFont
  const titleColor = primary.replace('#', '')

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

      const slide = prs.addSlide()

      if (isCover || isDivider) {
        // Full colored background for cover and section dividers
        slide.background = { color: primary.replace('#', '') }
        slide.addText(sanitize(title), {
          x: 0.4, y: 3.0, w: 12.2, h: 1.2,
          fontSize: 28, bold: true, color: 'FFFFFF', fontFace: headFont,
          align: 'center', valign: 'middle',
        })
      } else {
        // Content slides: white background with primary accent bar at top
        slide.background = { color: 'FFFFFF' }
        slide.addShape(prs.ShapeType.rect, {
          x: 0, y: 0, w: '100%', h: 0.11,
          fill: { color: primary.replace('#', '') },
          line: { color: primary.replace('#', ''), width: 0 },
        })
        slide.addText(sanitize(title), {
          x: 0.4, y: 0.18, w: 10.5, h: 0.75,
          fontSize: 22, bold: true, color: titleColor, fontFace: headFont,
        })

        if (bodyLines.length) {
          const textItems = bodyLines.map(l => {
            const isBullet = /^[-*] /.test(l)
            const raw = sanitize(isBullet ? l.slice(2) : l).trim()
            const isBold = raw.startsWith('**') && raw.endsWith('**')
            return {
              text: isBold ? raw.slice(2, -2) : raw,
              options: { bullet: isBullet, bold: isBold, color: '1A1A14', fontFace: bodyFont },
            }
          })
          slide.addText(textItems, { x: 0.4, y: 1.05, w: 12.2, h: 5.65, fontSize: 13, valign: 'top', wrap: true })
        }
      }

      // Logo on every slide
      if (docStyle.logoDataUrl) {
        try {
          slide.addImage({ data: docStyle.logoDataUrl, x: 11.3, y: 6.7, w: 1.5, h: 0.6, sizing: { type: 'contain', w: 1.5, h: 0.6 } })
        } catch { /* skip on error */ }
      }

      // Accent elements in secondary color (table-like rows / callout boxes)
      // Applied via text color on bullet items that look like headers
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

  let result = html.includes('</head>')
    ? html.replace('</head>', styleOverride + '\n</head>')
    : styleOverride + html

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
      img.style.cssText = 'height:36px;max-width:140px;object-fit:contain;vertical-align:middle;margin-right:12px;display:inline-block;';
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
