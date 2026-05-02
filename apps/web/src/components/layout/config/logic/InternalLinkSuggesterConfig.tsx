import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'
import { cn, stripMarkdown } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'
import { MarkdownContent } from '@/components/ui/markdown-content'

const PAGE_TYPE_OPTIONS = [
  { value: 'blog',     label: 'Blog posts / articles' },
  { value: 'product',  label: 'Product pages' },
  { value: 'landing',  label: 'Landing pages' },
  { value: 'case-study', label: 'Case studies' },
  { value: 'glossary', label: 'Glossary / definition pages' },
  { value: 'pricing',  label: 'Pricing page' },
]

export function InternalLinkSuggesterConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const [copied, setCopied] = useState(false)
  const maxSuggestions = (config.maxSuggestions as number) ?? 5
  const style          = (config.style          as string) ?? 'anchor-text-only'
  const pageTypes      = ((config.pageTypes     as string[]) ?? ['blog', 'product', 'landing'])

  const togglePageType = (value: string) => {
    const next = pageTypes.includes(value)
      ? pageTypes.filter((p) => p !== value)
      : [...pageTypes, value]
    onChange('pageTypes', next)
  }

  return (
    <div className="space-y-4 p-4">
      <FieldGroup label="Max Suggestions" description="How many anchor text suggestions to identify (3–15)">
        <Input
          type="number"
          min={3}
          max={15}
          value={maxSuggestions}
          onChange={(e) => onChange('maxSuggestions', Math.min(15, Math.max(3, parseInt(e.target.value, 10) || 5)))}
          className="h-8 text-xs w-24"
        />
      </FieldGroup>

      <FieldGroup label="Suggestion Style">
        <div className="flex flex-col gap-1.5">
          {[
            { value: 'anchor-text-only', label: 'Anchor text list',   desc: 'Numbered list with anchor phrase, reason, and destination type' },
            { value: 'inline-annotated', label: 'Inline annotated',   desc: 'Full content returned with [LINK: text → destination] markers' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('style', opt.value)}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                style === opt.value
                  ? 'border-yellow-500 bg-yellow-500/10'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <span className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                style === opt.value ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
              )} />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="ml-1 text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Target Page Types" description="Which types of internal pages exist on this site">
        <div className="flex flex-col gap-1.5">
          {PAGE_TYPE_OPTIONS.map((opt) => {
            const checked = pageTypes.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => togglePageType(opt.value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors',
                  checked
                    ? 'border-yellow-500 bg-yellow-500/10'
                    : 'border-border text-muted-foreground hover:border-muted-foreground',
                )}
              >
                <span className={cn(
                  'h-3.5 w-3.5 shrink-0 rounded-sm border-2',
                  checked ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
                )}>
                  {checked && <span className="flex items-center justify-center text-[8px] font-bold text-white leading-none">✓</span>}
                </span>
                <span className="font-medium text-foreground">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </FieldGroup>
      {/* Output — shown after a successful run */}
      {nodeRunStatus?.status === 'passed' && nodeRunStatus.output != null && (() => {
        const outputText = typeof nodeRunStatus.output === 'string'
          ? nodeRunStatus.output
          : JSON.stringify(nodeRunStatus.output, null, 2)
        if (!outputText) return null
        return (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(stripMarkdown(outputText))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-accent hover:text-blue-700"
              >
                {copied ? <Icons.Check className="h-3 w-3" /> : <Icons.Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => downloadDocx(outputText, 'internal-link-suggestions')}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Icons.Download className="h-3 w-3" />
                .docx
              </button>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <MarkdownContent
                content={outputText}
                className="text-xs leading-relaxed text-foreground prose-panel"
              />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
