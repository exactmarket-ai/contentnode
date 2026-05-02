import { useState } from 'react'
import * as Icons from 'lucide-react'
import { FieldGroup } from '../shared'
import { cn, stripMarkdown } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'
import { MarkdownContent } from '@/components/ui/markdown-content'

const CHECK_MODES = [
  { value: 'claims_statistics', label: 'Claims & statistics', desc: 'Numbers, attributed quotes, specific factual assertions' },
  { value: 'all_statements',    label: 'All statements',      desc: 'Broader — includes general claims about industries and events' },
  { value: 'statistics_only',   label: 'Statistics only',     desc: 'Only numerical data, percentages, and figures' },
]

const ACTIONS = [
  { value: 'annotate',    label: 'Annotate only',          desc: 'Adds [FLAG: ...] inline after flagged claims' },
  { value: 'remove',      label: 'Remove flagged claims',   desc: 'Removes unverifiable claims, notes what was removed' },
  { value: 'placeholder', label: 'Replace with placeholder', desc: 'Replaces flagged claims with [VERIFY: ...]' },
]

const SENSITIVITY_OPTIONS = [
  { value: 'low',    label: 'Low',    desc: 'Only flags clearly wrong claims' },
  { value: 'medium', label: 'Medium', desc: 'Flags unverifiable or weakly attributed claims' },
  { value: 'high',   label: 'High',   desc: 'Flags any claim without a direct citation' },
]

function parseSummary(outputText: string): { summaryText: string; flagCount: number; isClean: boolean } {
  const match = outputText.match(/##\s*FACT\s+CHECK\s+SUMMARY([\s\S]*)$/i)
  const summaryText = match?.[1]?.trim() ?? ''
  const isClean = !summaryText || summaryText.toLowerCase().includes('no issues found')
  const flagCount = isClean ? 0 : (summaryText.match(/\*\*Claim:\*\*/gi) ?? []).length
  return { summaryText, flagCount, isClean }
}

export function FactCheckerConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const [copied, setCopied] = useState(false)

  const checkMode   = (config.checkMode   as string) ?? 'claims_statistics'
  const action      = (config.action      as string) ?? 'annotate'
  const sensitivity = (config.sensitivity as string) ?? 'medium'

  const outputText = typeof nodeRunStatus?.output === 'string' ? nodeRunStatus.output : ''
  const hasSummary = nodeRunStatus?.status === 'passed' && outputText.length > 0
  const { summaryText, flagCount, isClean } = parseSummary(outputText)

  const handleCopy = () => {
    if (!summaryText) return
    navigator.clipboard.writeText(stripMarkdown(summaryText))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (!summaryText) return
    downloadDocx(summaryText, 'fact-check-summary')
  }

  return (
    <div className="space-y-4 p-4">
      <FieldGroup label="Check Mode">
        <div className="flex flex-col gap-1.5">
          {CHECK_MODES.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('checkMode', opt.value)}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                checkMode === opt.value
                  ? 'border-yellow-500 bg-yellow-500/10'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <span className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                checkMode === opt.value ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
              )} />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="ml-1 text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Action on Flagged Content">
        <div className="flex flex-col gap-1.5">
          {ACTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('action', opt.value)}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                action === opt.value
                  ? 'border-yellow-500 bg-yellow-500/10'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <span className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                action === opt.value ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
              )} />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="ml-1 text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Sensitivity">
        <div className="flex gap-2">
          {SENSITIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('sensitivity', opt.value)}
              className={cn(
                'flex-1 rounded-lg border px-2 py-2 text-center text-xs transition-colors',
                sensitivity === opt.value
                  ? 'border-yellow-500 bg-yellow-500/10 text-yellow-300'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {SENSITIVITY_OPTIONS.find((o) => o.value === sensitivity)?.desc}
        </p>
      </FieldGroup>

      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
        <p className="text-[10px] text-muted-foreground">
          Evaluation is based on Claude's training knowledge — no live web search.
        </p>
      </div>

      {/* ── Post-run results ── */}
      {hasSummary && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="rounded px-2 py-0.5 text-xs font-semibold"
                style={isClean
                  ? { backgroundColor: '#dcfce7', color: '#166534' }
                  : { backgroundColor: '#fef3c7', color: '#92400e' }
                }
              >
                {isClean ? 'Clean' : `${flagCount} flag${flagCount === 1 ? '' : 's'}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {isClean ? 'No issues found' : 'flagged claims'}
              </span>
            </div>
            {!isClean && summaryText && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-accent hover:text-blue-700"
                >
                  {copied ? <Icons.Check className="h-3 w-3" /> : <Icons.Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Icons.Download className="h-3 w-3" />
                  .docx
                </button>
              </div>
            )}
          </div>

          {!isClean && summaryText && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <MarkdownContent
                content={summaryText}
                className="text-xs leading-relaxed text-foreground prose-panel"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
