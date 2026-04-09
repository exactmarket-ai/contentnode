import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { FieldGroup, HUMANIZER_MONTHLY_LIMIT } from '../shared'

const HUMANIZER_SERVICES = [
  { value: 'auto',         label: 'Auto (use server default)' },
  { value: 'cnHumanizer', label: 'cnHumanizer' },
  { value: 'undetectable', label: 'Undetectable.ai' },
  { value: 'bypassgpt',    label: 'BypassGPT' },
  { value: 'stealthgpt',   label: 'StealthGPT' },
  { value: 'claude',       label: 'Claude (legacy)' },
]

export function HumanizerProConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const service = (config.humanizer_service as string) ?? 'auto'
  const [usage, setUsage] = useState<Record<string, number>>({})

  useEffect(() => {
    apiFetch('/api/v1/usage/humanizer')
      .then((r) => r.json())
      .then((json) => { if (json.data) setUsage(json.data as Record<string, number>) })
      .catch(() => {})
  }, [])

  const fmt = (n: number) => n.toLocaleString()
  const pct = (n: number) => Math.min(100, Math.round((n / HUMANIZER_MONTHLY_LIMIT) * 100))

  return (
    <>
      {/* Per-service usage */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <Label className="text-xs text-muted-foreground">Monthly Usage (500k words each)</Label>
        {[
          { key: 'undetectable', label: 'Undetectable.ai' },
          { key: 'bypassgpt',    label: 'BypassGPT' },
          { key: 'stealthgpt',   label: 'StealthGPT' },
          { key: 'claude',       label: 'Claude (fallback)', noLimit: true },
        ].map(({ key, label, noLimit }) => {
          const used = usage[key] ?? 0
          const p = noLimit ? 0 : pct(used)
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {fmt(used)}{noLimit ? ' words' : ` / ${fmt(HUMANIZER_MONTHLY_LIMIT)}`}
                </span>
              </div>
              {!noLimit && <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-blue-500',
                  )}
                  style={{ width: `${p}%` }}
                />
              </div>}
            </div>
          )
        })}
      </div>

      {/* Service selector */}
      <FieldGroup label="Service">
        <select
          value={service}
          onChange={(e) => onChange('humanizer_service', e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {HUMANIZER_SERVICES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </FieldGroup>
    </>
  )
}
