import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'

export type ReviewStatus = 'none' | 'pending' | 'sent_to_client' | 'client_responded' | 'closed'

interface Step {
  key: ReviewStatus
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const STEPS: Step[] = [
  { key: 'none',             label: 'Generated',      icon: Icons.Sparkles },
  { key: 'pending',          label: 'Agency review',  icon: Icons.Eye },
  { key: 'sent_to_client',   label: 'Sent to client', icon: Icons.Send },
  { key: 'client_responded', label: 'Client review',  icon: Icons.MessageSquare },
  { key: 'closed',           label: 'Closed',         icon: Icons.CheckCircle2 },
]

const ORDER: ReviewStatus[] = ['none', 'pending', 'sent_to_client', 'client_responded', 'closed']

export function DeliverableStatusStepper({
  status,
  onChange,
  compact = false,
}: {
  status: ReviewStatus
  onChange?: (s: ReviewStatus) => void
  compact?: boolean
}) {
  const currentIdx = ORDER.indexOf(status)

  return (
    <div className={cn('flex items-center', compact ? 'gap-0' : 'gap-0 w-full')}>
      {STEPS.map((step, i) => {
        const stepIdx = ORDER.indexOf(step.key)
        const done    = stepIdx < currentIdx
        const active  = stepIdx === currentIdx
        const future  = stepIdx > currentIdx
        const Icon    = step.icon
        const isLast  = i === STEPS.length - 1

        return (
          <div key={step.key} className={cn('flex items-center', !isLast && 'flex-1')}>
            <button
              type="button"
              disabled={!onChange}
              onClick={() => onChange?.(step.key)}
              title={step.label}
              className={cn(
                'flex flex-col items-center gap-0.5 transition-opacity',
                compact ? 'min-w-[32px]' : 'min-w-[48px]',
                future && 'opacity-35',
                onChange && !active && 'hover:opacity-100 cursor-pointer',
                !onChange && 'cursor-default',
              )}
            >
              <div className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
                done   && 'bg-emerald-500 border-emerald-500 text-white',
                active && 'bg-blue-600 border-blue-600 text-white',
                future && 'bg-background border-border text-muted-foreground',
              )}>
                {done
                  ? <Icons.Check className="h-3 w-3" />
                  : <Icon className="h-3 w-3" />
                }
              </div>
              {!compact && (
                <span className={cn(
                  'text-[9px] leading-tight text-center whitespace-nowrap',
                  active ? 'text-blue-600 font-semibold' : done ? 'text-emerald-600' : 'text-muted-foreground',
                )}>
                  {step.label}
                </span>
              )}
            </button>

            {!isLast && (
              <div className={cn(
                'h-px flex-1 transition-colors mx-1',
                stepIdx < currentIdx ? 'bg-emerald-400' : 'bg-border',
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}
