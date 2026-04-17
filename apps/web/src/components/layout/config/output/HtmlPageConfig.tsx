/**
 * HtmlPageConfig.tsx
 *
 * Config panel for the HTML Page output node.
 * When a run has completed, shows an iframe preview + download button.
 * nodePILOT can iterate on the HTML output via the chat panel.
 */

import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '../shared'

// ─── Page type options ────────────────────────────────────────────────────────

const PAGE_TYPES = [
  { value: 'landing-page',  label: 'Landing Page',   desc: 'Hero + benefits + CTA' },
  { value: 'email-html',    label: 'HTML Email',      desc: 'Inline styles, 600px, email-safe' },
  { value: 'one-pager',     label: 'One-Pager',       desc: 'Clean document-style layout' },
  { value: 'case-study',    label: 'Case Study',      desc: 'Challenge → solution → results' },
  { value: 'event-page',    label: 'Event Page',      desc: 'Date, agenda, speakers, registration' },
  { value: 'product-brief', label: 'Product Brief',   desc: 'Features, use cases, specs' },
  { value: 'slide-deck',    label: 'Slide Deck',      desc: 'Reveal.js 4 presentation' },
]

// ─── Preview / output section ─────────────────────────────────────────────────

export function HtmlPageOutput({
  nodeRunStatus,
  nodeId,
}: {
  nodeRunStatus?: { status?: string; output?: unknown }
  nodeId: string
}) {
  const [previewOpen, setPreviewOpen] = useState(true)

  const output = nodeRunStatus?.output as { html?: string } | undefined
  const html = output?.html

  if (!html) return null

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `page_${nodeId.slice(0, 8)}.html`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyHtml = () => {
    void navigator.clipboard.writeText(html)
  }

  return (
    <div className="space-y-2">
      {/* Preview header */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <Icons.Globe className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1">Page Preview</span>
        <button
          onClick={handleCopyHtml}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Copy HTML source"
        >
          <Icons.Code className="h-3 w-3" />
          Copy HTML
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Download .html file"
        >
          <Icons.Download className="h-3 w-3" />
          Download
        </button>
        <button
          onClick={() => setPreviewOpen((p) => !p)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {previewOpen
            ? <Icons.ChevronUp className="h-3.5 w-3.5" />
            : <Icons.ChevronDown className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* iframe preview */}
      {previewOpen && (
        <div className="mx-4 rounded-lg border border-border overflow-hidden bg-white" style={{ height: 320 }}>
          <iframe
            srcDoc={html}
            className="w-full h-full"
            sandbox="allow-same-origin allow-scripts"
            title="HTML Page Preview"
          />
        </div>
      )}

      <div className="px-4 pb-1">
        <Button size="sm" className="w-full gap-1.5" onClick={handleDownload}>
          <Icons.Download className="h-3.5 w-3.5" />
          Download .html
        </Button>
      </div>

      <div className="border-b border-border mx-4" />
    </div>
  )
}

// ─── Config form ──────────────────────────────────────────────────────────────

export function HtmlPageConfig({
  config,
  onChange,
  nodeRunStatus,
  nodeId,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
  nodeId: string
}) {
  const pageType       = (config.pageType       as string)  ?? 'landing-page'
  const styleDirection = (config.styleDirection as string)  ?? ''
  const useBrandColors = (config.useBrandColors as boolean) ?? true

  return (
    <div className="space-y-1">
      {/* Output preview (shown after run) */}
      <HtmlPageOutput nodeRunStatus={nodeRunStatus} nodeId={nodeId} />

      {/* Page Type */}
      <FieldGroup label="Page Type">
        <div className="grid grid-cols-2 gap-1.5 px-4">
          {PAGE_TYPES.map((pt) => (
            <button
              key={pt.value}
              onClick={() => onChange('pageType', pt.value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                pageType === pt.value
                  ? 'border-violet-500 bg-violet-50'
                  : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30'
              }`}
            >
              <p className={`text-[11px] font-semibold leading-snug ${pageType === pt.value ? 'text-violet-700' : 'text-foreground'}`}>
                {pt.label}
              </p>
              <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">{pt.desc}</p>
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* Use Brand Colors */}
      <FieldGroup label="Brand">
        <div className="px-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useBrandColors}
              onChange={(e) => onChange('useBrandColors', e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-foreground">Pull colours + fonts from client brand</span>
          </label>
          {useBrandColors && (
            <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
              Uses primary colour, heading font, and body font from the client profile. Set these in Clients → Brand.
            </p>
          )}
        </div>
      </FieldGroup>

      {/* Style Direction */}
      <FieldGroup label="Style Direction" description="Optional creative direction for layout and visual mood">
        <div className="px-4">
          <textarea
            value={styleDirection}
            onChange={(e) => onChange('styleDirection', e.target.value)}
            placeholder="e.g. Dark hero with gradient, card-based layout, minimal and modern, bold typography…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-zinc-50 px-3 py-2 text-xs placeholder:text-muted-foreground focus:border-blue-400 focus:bg-white outline-none transition-colors"
          />
        </div>
      </FieldGroup>

      {/* nodePILOT hint */}
      <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
        <Icons.Compass className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-violet-700 leading-snug">
          After running, ask <b>nodePILOT</b> to refine the page — "make the hero more minimal" or attach a screenshot for visual direction.
        </p>
      </div>
    </div>
  )
}
