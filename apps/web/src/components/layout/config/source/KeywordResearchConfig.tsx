import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'
import { cn, stripMarkdown } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'
import { MarkdownContent } from '@/components/ui/markdown-content'

const FUNNEL_STAGE_OPTIONS = [
  { value: 'all',           label: 'All stages (default)' },
  { value: 'awareness',     label: 'Awareness — informational queries' },
  { value: 'consideration', label: 'Consideration — comparison and evaluation' },
  { value: 'decision',      label: 'Decision — transactional and high-intent' },
]

export function KeywordResearchConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const [copied, setCopied] = useState(false)
  const seedTopic          = (config.seedTopic         as string)   ?? ''
  const targetAudience     = (config.targetAudience    as string)   ?? ''
  const funnelStages       = ((config.funnelStages     as string[]) ?? ['all'])
  const outputVolume       = (config.outputVolume      as string)   ?? 'focused'
  const includeIntentLabels = (config.includeIntentLabels as boolean) ?? true

  const toggleStage = (value: string) => {
    if (value === 'all') {
      onChange('funnelStages', ['all'])
      return
    }
    const withoutAll = funnelStages.filter((s) => s !== 'all')
    const next = withoutAll.includes(value)
      ? withoutAll.filter((s) => s !== value)
      : [...withoutAll, value]
    onChange('funnelStages', next.length === 0 ? ['all'] : next)
  }

  return (
    <>
      <FieldGroup label="Seed Topic or Keyword" description="The topic or keyword to build a map from">
        <Input
          placeholder="e.g. B2B SaaS onboarding"
          className="text-xs"
          value={seedTopic}
          onChange={(e) => onChange('seedTopic', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Target Audience" description="Optional — tailors the keyword language to this audience">
        <Input
          placeholder="e.g. B2B SaaS marketing managers"
          className="text-xs"
          value={targetAudience}
          onChange={(e) => onChange('targetAudience', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Funnel Stage Focus">
        <div className="flex flex-col gap-1.5">
          {FUNNEL_STAGE_OPTIONS.map((opt) => {
            const checked = opt.value === 'all'
              ? funnelStages.includes('all') || funnelStages.length === 0
              : funnelStages.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleStage(opt.value)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors',
                  checked
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-border text-muted-foreground hover:border-muted-foreground',
                )}
              >
                <span className={cn(
                  'h-3.5 w-3.5 shrink-0 rounded-sm border-2',
                  checked ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground',
                )}>
                  {checked && <span className="flex items-center justify-center text-[8px] font-bold text-white leading-none">✓</span>}
                </span>
                <span className="text-foreground">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </FieldGroup>

      <FieldGroup label="Output Volume">
        <div className="flex gap-2">
          {[
            { value: 'focused',       label: 'Focused',       desc: '15–20 keywords' },
            { value: 'comprehensive', label: 'Comprehensive', desc: '40–60 keywords' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('outputVolume', opt.value)}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-xs transition-colors text-center',
                outputVolume === opt.value
                  ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <p className="font-medium text-foreground">{opt.label}</p>
              <p className="text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
      </FieldGroup>

      <button
        type="button"
        onClick={() => onChange('includeIntentLabels', !includeIntentLabels)}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors text-left w-full',
          includeIntentLabels
            ? 'border-l-2 border-amber-400 bg-amber-50 text-amber-700'
            : 'rounded border border-border text-muted-foreground hover:text-foreground',
        )}
      >
        <span className={cn(
          'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
          includeIntentLabels ? 'bg-blue-500 border-blue-500' : 'border-muted-foreground',
        )}>
          {includeIntentLabels && <span className="text-[8px] font-bold text-white">✓</span>}
        </span>
        Include search intent labels (Informational / Commercial / Transactional / Navigational)
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
                onClick={() => downloadDocx(outputText, 'keyword-research')}
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
    </>
  )
}
