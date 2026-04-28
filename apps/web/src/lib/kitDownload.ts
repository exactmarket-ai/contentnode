import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx'

interface AssetForDownload {
  index: number
  name: string
  num: string
  ext: string
  content: string
}

// Replace & with 'and' — docx TextRun must not contain & directly
function sanitize(text: string): string {
  return text.replace(/&/g, 'and')
}

// Parse **bold** markdown inline markers into TextRun[]
function parseInlineRuns(text: string): TextRun[] {
  return sanitize(text)
    .split(/\*\*/)
    .filter((_, i, arr) => !(i === arr.length - 1 && arr[arr.length - 1] === ''))
    .map((part, i) => new TextRun({ text: part, bold: i % 2 === 1 }))
}

// Build a Table from consecutive | lines, skipping the separator row
function buildTable(tableLines: string[]): Table {
  const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: dataRows.map(row => {
      const cells = row.split('|').slice(1, -1).map(c => c.trim())
      return new TableRow({
        // Do NOT wrap the .map() result in an extra array — known docx bug
        children: cells.map(cell => new TableCell({
          children: [new Paragraph({ children: parseInlineRuns(cell) })],
        })),
      })
    }),
  })
}

export async function markdownToDocxBlob(markdown: string): Promise<Blob> {
  const lines = markdown.split('\n')
  const children: (Paragraph | Table)[] = []
  let tableLines: string[] = []

  function flushTable() {
    if (tableLines.length === 0) return
    const dataRows = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()))
    if (dataRows.length > 0) children.push(buildTable(tableLines))
    tableLines = []
  }

  for (const line of lines) {
    if (line.startsWith('|')) {
      tableLines.push(line)
      continue
    }
    flushTable()

    if (line.startsWith('# '))       children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(sanitize(line.slice(2)))] }))
    else if (line.startsWith('## ')) children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(sanitize(line.slice(3)))] }))
    else if (line.startsWith('### '))children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(sanitize(line.slice(4)))] }))
    else if (line.startsWith('#### '))children.push(new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun(sanitize(line.slice(5)))] }))
    else if (/^[-*] /.test(line))    children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(line.slice(2)) }))
    else if (line.startsWith('> '))  children.push(new Paragraph({ indent: { left: 720 }, children: parseInlineRuns(line.slice(2)) }))
    else if (line.trim() === '')     children.push(new Paragraph({}))
    else                             children.push(new Paragraph({ children: parseInlineRuns(line) }))
  }
  flushTable()

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}

export async function markdownToPptxBlob(markdown: string): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const prs = new PptxGenJS()
  prs.layout = 'LAYOUT_WIDE'

  // Split by ## Slide N: header — each block becomes one slide
  const slideBlocks = markdown.split(/(?=^## Slide \d+:)/m).filter(b => b.trim())

  if (slideBlocks.length === 0) {
    const slide = prs.addSlide()
    slide.addText(sanitize(markdown.substring(0, 800)), {
      x: 0.4, y: 0.5, w: 12.2, h: 6, fontSize: 12, valign: 'top', wrap: true,
    })
  } else {
    for (const block of slideBlocks) {
      const titleMatch = block.match(/^## Slide \d+:\s*(.+)/)
      const title = titleMatch ? titleMatch[1].trim() : ''
      const bodyLines = block
        .split('\n')
        .slice(1)
        .filter(l => l.trim() !== '' && !l.startsWith('##'))

      const slide = prs.addSlide()

      slide.addText(sanitize(title), {
        x: 0.4, y: 0.15, w: 12.2, h: 0.75,
        fontSize: 22, bold: true, color: '1a2744',
      })

      if (bodyLines.length > 0) {
        // Do NOT wrap the .map() result in an extra array — known pptxgenjs bug
        const textItems = bodyLines.map(l => {
          const isBullet = /^[-*] /.test(l)
          const raw = sanitize(isBullet ? l.slice(2) : l).trim()
          const isBold = raw.startsWith('**') && raw.endsWith('**')
          return {
            text: isBold ? raw.slice(2, -2) : raw,
            options: { bullet: isBullet, bold: isBold },
          }
        })
        slide.addText(textItems, {
          x: 0.4, y: 1.05, w: 12.2, h: 5.65,
          fontSize: 14, valign: 'top', wrap: true,
        })
      }
    }
  }

  const buffer = await prs.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}

export async function downloadKit(
  asset: AssetForDownload,
  clientName: string,
  verticalName: string,
): Promise<void> {
  const filename = `${clientName} ${verticalName} Kit - ${asset.num} ${asset.name}.${asset.ext}`
  let blob: Blob

  if (asset.ext === 'html') {
    blob = new Blob([asset.content], { type: 'text/html;charset=utf-8' })
  } else if (asset.ext === 'pptx') {
    blob = await markdownToPptxBlob(asset.content)
  } else {
    blob = await markdownToDocxBlob(asset.content)
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
