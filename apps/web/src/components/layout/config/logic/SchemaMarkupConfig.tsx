import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'

const SCHEMA_TYPES = [
  { value: 'auto',            label: 'Auto-detect (recommended)' },
  { value: 'Article',         label: 'Article' },
  { value: 'FAQPage',         label: 'FAQPage' },
  { value: 'HowTo',           label: 'HowTo' },
  { value: 'Product',         label: 'Product' },
  { value: 'Organization',    label: 'Organization' },
  { value: 'BreadcrumbList',  label: 'BreadcrumbList' },
  { value: 'WebPage',         label: 'WebPage' },
]

export function SchemaMarkupConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const [copied, setCopied] = useState(false)
  const schemaType   = (config.schemaType   as string) ?? 'auto'
  const outputFormat = (config.outputFormat as string) ?? 'json-ld-only'
  const includeOpt   = (config.includeOptional as boolean) ?? false

  return (
    <div className="space-y-4 p-4">
      <FieldGroup label="Schema Type" description="Auto-detect analyses the content and picks the best type">
        <Select value={schemaType} onValueChange={(v) => onChange('schemaType', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEMA_TYPES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Output Format">
        <div className="flex flex-col gap-1.5">
          {[
            { value: 'json-ld-only', label: 'JSON-LD only', desc: 'Just the schema object' },
            { value: 'script-tag',   label: 'Full script tag', desc: 'Wrapped in <script type="application/ld+json"> — ready to paste' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('outputFormat', opt.value)}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                outputFormat === opt.value
                  ? 'border-yellow-500 bg-yellow-500/10 text-yellow-200'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <span className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                outputFormat === opt.value ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
              )} />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="ml-1 text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <button
        type="button"
        onClick={() => onChange('includeOptional', !includeOpt)}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs border transition-colors text-left w-full',
          includeOpt
            ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300'
            : 'border-border text-muted-foreground hover:text-foreground',
        )}
      >
        <span className={cn(
          'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
          includeOpt ? 'bg-yellow-500 border-yellow-500' : 'border-muted-foreground',
        )}>
          {includeOpt && <span className="text-[8px] font-bold text-white">✓</span>}
        </span>
        Include all optional fields (with [PLACEHOLDER] markers)
      </button>

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
                  navigator.clipboard.writeText(outputText)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-accent hover:text-blue-700"
              >
                {copied ? <Icons.Check className="h-3 w-3" /> : <Icons.Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={() => downloadDocx(outputText, 'schema-markup')}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Icons.Download className="h-3 w-3" />
                .docx
              </button>
            </div>
            <textarea
              readOnly
              value={outputText}
              className="w-full min-h-[140px] resize-y rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground"
            />
          </div>
        )
      })()}
    </div>
  )
}
