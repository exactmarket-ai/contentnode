/**
 * Lightweight markdown → HTML renderer for AI-generated content.
 * Handles the patterns Claude actually produces: headings, bold/italic,
 * bullets, horizontal rules, and paragraphs. No external dependency.
 *
 * Content is AI-generated (trusted) so dangerouslySetInnerHTML is acceptable.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function isTableRow(line: string): boolean {
  return line.trimStart().startsWith('|') && line.trimEnd().endsWith('|')
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim())
}

function parseTableRow(line: string): string[] {
  return line.split('|').slice(1, -1).map((c) => c.trim())
}

function buildTable(rows: string[]): string {
  if (rows.length === 0) return ''
  const parts: string[] = ['<table>']
  let headerEmitted = false
  let inBody = false

  for (let i = 0; i < rows.length; i++) {
    if (isTableSeparator(rows[i])) {
      if (!headerEmitted && parts.length > 1) {
        parts.splice(1, 0, '<thead>')
        parts.push('</thead>')
        headerEmitted = true
      }
      continue
    }
    const cells = parseTableRow(rows[i])
    if (headerEmitted && !inBody) {
      parts.push('<tbody>')
      inBody = true
    }
    const tag = headerEmitted ? 'td' : 'th'
    parts.push(`<tr>${cells.map((c) => `<${tag}>${renderInline(c)}</${tag}>`).join('')}</tr>`)
  }

  if (inBody) parts.push('</tbody>')
  parts.push('</table>')
  return parts.join('\n')
}

export function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  let inList = false
  let inParagraph = false
  let paragraphLines: string[] = []
  let tableRows: string[] = []

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      html.push(`<p>${paragraphLines.join('<br />')}</p>`)
      paragraphLines = []
      inParagraph = false
    }
  }

  function closeList() {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  function flushTable() {
    if (tableRows.length > 0) {
      html.push(buildTable(tableRows))
      tableRows = []
    }
  }

  for (const rawLine of lines) {
    const line = rawLine

    // Table row (including separator)
    if (isTableRow(line) || (tableRows.length > 0 && isTableSeparator(line))) {
      flushParagraph()
      closeList()
      tableRows.push(line)
      continue
    }

    // Leaving a table
    if (tableRows.length > 0) {
      flushTable()
    }

    // Heading
    const h3 = line.match(/^###\s+(.+)/)
    const h2 = line.match(/^##\s+(.+)/)
    const h1 = line.match(/^#\s+(.+)/)

    if (h1 || h2 || h3) {
      flushParagraph()
      closeList()
      if (h1) html.push(`<h1>${renderInline(h1[1])}</h1>`)
      else if (h2) html.push(`<h2>${renderInline(h2[1])}</h2>`)
      else if (h3) html.push(`<h3>${renderInline(h3[1])}</h3>`)
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^===+$/.test(line.trim())) {
      flushParagraph()
      closeList()
      html.push('<hr />')
      continue
    }

    // Bullet list item
    const bullet = line.match(/^[-*+]\s+(.+)/)
    const numbered = line.match(/^\d+\.\s+(.+)/)
    if (bullet || numbered) {
      flushParagraph()
      if (!inList) { html.push('<ul>'); inList = true }
      const text = bullet ? bullet[1] : numbered![1]
      html.push(`<li>${renderInline(text)}</li>`)
      continue
    }

    // Blank line
    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }

    // Regular text — accumulate into paragraph
    closeList()
    inParagraph = true
    paragraphLines.push(renderInline(line))
  }

  flushParagraph()
  closeList()
  flushTable()

  return html.join('\n')
}

interface MarkdownContentProps {
  content: string
  className?: string
}

/**
 * Renders AI-generated markdown as formatted HTML.
 * Apply prose styles via the `className` prop.
 */
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
    />
  )
}
