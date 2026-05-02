import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'

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
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
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
          'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs border transition-colors text-left w-full',
          preserveBrandVoice
            ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300'
            : 'border-border text-muted-foreground hover:text-foreground',
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
    </div>
  )
}
