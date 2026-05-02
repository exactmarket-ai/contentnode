import { useState } from 'react'
import * as Icons from 'lucide-react'
import { FieldGroup } from '../shared'
import { cn, stripMarkdown } from '@/lib/utils'
import { downloadDocx } from '@/lib/downloadDocx'
import { MarkdownContent } from '@/components/ui/markdown-content'

const FORMAT_OPTIONS = [
  { value: 'linkedin_post',    label: 'LinkedIn Post',           desc: 'Hook + body + CTA, 150–300 words' },
  { value: 'twitter_thread',   label: 'X/Twitter Thread',        desc: '5–8 tweets, each under 280 chars' },
  { value: 'email_newsletter', label: 'Email Newsletter Intro',  desc: 'Subject line + preview text + 150-word intro' },
  { value: 'executive_summary',label: 'Executive Summary',       desc: '5 bullet points, one sentence each' },
  { value: 'pull_quotes',      label: 'Pull Quotes',             desc: '3–5 standalone quotes for social or design' },
  { value: 'video_script',     label: 'Short-form Video Script', desc: '60-second hook + key point + CTA' },
]

export function RepurposeConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const [copied, setCopied] = useState(false)
  const targetFormats    = ((config.targetFormats    as string[]) ?? ['linkedin_post'])
  const preserveBrandVoice = (config.preserveBrandVoice as boolean) ?? true
  const outputAs         = (config.outputAs         as string)   ?? 'combined'

  const toggleFormat = (value: string) => {
    const next = targetFormats.includes(value)
      ? targetFormats.filter((f) => f !== value)
      : [...targetFormats, value]
    onChange('targetFormats', next)
  }

  return (
    <div className="space-y-4 p-4">
      <FieldGroup label="Target Formats" description="Select one or more output formats to generate">
        <div className="flex flex-col gap-1.5">
          {FORMAT_OPTIONS.map((opt) => {
            const checked = targetFormats.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleFormat(opt.value)}
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  checked
                    ? 'border-yellow-500 bg-yellow-500/10'
                    : 'border-border text-muted-foreground hover:border-muted-foreground',
                )}
              >
                <span className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border-2',
                  checked ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
                )}>
                  {checked && <span className="flex items-center justify-center text-[8px] font-bold text-white leading-none">✓</span>}
                </span>
                <span>
                  <span className="font-medium text-foreground">{opt.label}</span>
                  <span className="ml-1 text-muted-foreground">{opt.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </FieldGroup>

      <button
        type="button"
        onClick={() => onChange('preserveBrandVoice', !preserveBrandVoice)}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors text-left w-full',
          preserveBrandVoice
            ? 'border-l-2 border-amber-400 bg-amber-50 text-amber-700'
            : 'rounded border border-border text-muted-foreground hover:text-foreground',
        )}
      >
        <span className={cn(
          'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
          preserveBrandVoice ? 'bg-yellow-500 border-yellow-500' : 'border-muted-foreground',
        )}>
          {preserveBrandVoice && <span className="text-[8px] font-bold text-white">✓</span>}
        </span>
        Preserve brand voice from source content
      </button>

      <FieldGroup label="Output As">
        <div className="flex flex-col gap-1.5">
          {[
            { value: 'combined',  label: 'Single combined document', desc: 'All formats in one output, each labeled' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange('outputAs', opt.value)}
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                outputAs === opt.value
                  ? 'border-yellow-500 bg-yellow-500/10 text-yellow-200'
                  : 'border-border text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <span className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                outputAs === opt.value ? 'border-yellow-500 bg-yellow-500' : 'border-muted-foreground',
              )} />
              <span>
                <span className="font-medium text-foreground">{opt.label}</span>
                <span className="ml-1 text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
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
                onClick={() => downloadDocx(outputText, 'repurposed-content')}
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
