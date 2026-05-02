import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'

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

export function FactCheckerConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const checkMode  = (config.checkMode  as string) ?? 'claims_statistics'
  const action     = (config.action     as string) ?? 'annotate'
  const sensitivity = (config.sensitivity as string) ?? 'medium'

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
    </div>
  )
}
