import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { FieldGroup, modelLabel, defaultModelForProvider, modelsForProvider, HUMANIZER_MONTHLY_LIMIT } from '../shared'

const HUMANIZER_MODES = [
  { value: 'executive-natural',  label: 'Executive Natural' },
  { value: 'conversational',     label: 'Conversational' },
  { value: 'confident-expert',   label: 'Confident Expert' },
  { value: 'premium-brand',      label: 'Premium Brand' },
  { value: 'founder-voice',      label: 'Founder Voice' },
  { value: 'sales-polished',     label: 'Sales Polished' },
  { value: 'journalistic-clean', label: 'Journalistic Clean' },
  { value: 'social-native',      label: 'Social Native' },
  { value: 'custom',             label: 'Custom' },
]

const HUMANIZER_SLIDERS: { key: string; label: string }[] = [
  { key: 'naturalness', label: 'Naturalness' },
  { key: 'energy',      label: 'Energy' },
  { key: 'precision',   label: 'Precision' },
  { key: 'formality',   label: 'Formality' },
  { key: 'boldness',    label: 'Boldness' },
  { key: 'compression', label: 'Compression' },
  { key: 'personality', label: 'Personality' },
  { key: 'safety',      label: 'Safety' },
]

const HUMANIZER_MODE_PRESETS: Record<string, Record<string, number>> = {
  'executive-natural':  { naturalness: 70, energy: 55, precision: 75, formality: 65, boldness: 60, compression: 55, personality: 45, safety: 80 },
  'conversational':     { naturalness: 85, energy: 65, precision: 50, formality: 25, boldness: 50, compression: 45, personality: 70, safety: 70 },
  'confident-expert':   { naturalness: 65, energy: 60, precision: 80, formality: 55, boldness: 80, compression: 60, personality: 55, safety: 65 },
  'premium-brand':      { naturalness: 75, energy: 50, precision: 70, formality: 70, boldness: 55, compression: 60, personality: 50, safety: 85 },
  'founder-voice':      { naturalness: 80, energy: 80, precision: 55, formality: 35, boldness: 85, compression: 50, personality: 80, safety: 55 },
  'sales-polished':     { naturalness: 70, energy: 75, precision: 65, formality: 55, boldness: 75, compression: 65, personality: 60, safety: 75 },
  'journalistic-clean': { naturalness: 80, energy: 55, precision: 85, formality: 60, boldness: 65, compression: 75, personality: 35, safety: 80 },
  'social-native':      { naturalness: 90, energy: 85, precision: 40, formality: 15, boldness: 80, compression: 80, personality: 85, safety: 60 },
  'custom':             { naturalness: 70, energy: 60, precision: 65, formality: 50, boldness: 55, compression: 40, personality: 60, safety: 80 },
}

export function HumanizerConfig({
  config,
  onChange,
  workflowModel,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
}) {
  const mode = (config.mode as string) ?? 'executive-natural'
  const modelCfg = (config.model_config as Record<string, unknown> | null) ?? null
  const [usage, setUsage] = useState<Record<string, number>>({})

  useEffect(() => {
    apiFetch('/api/v1/usage/humanizer')
      .then((r) => r.json())
      .then((json) => { if (json.data) setUsage(json.data as Record<string, number>) })
      .catch(() => {})
  }, [])
  const overrideEnabled = modelCfg !== null
  const targetedRewrite = (config.targeted_rewrite as boolean) ?? true

  const overrideProvider = (modelCfg?.provider as string) ?? 'anthropic'
  const overrideModel = (modelCfg?.model as string) ?? 'claude-sonnet-4-5'
  const inheritedLabel = `${modelLabel(workflowModel.provider, workflowModel.model)} (default)`

  const handleModeChange = (newMode: string) => {
    onChange('mode', newMode)
    // Apply preset slider values when mode changes
    const preset = HUMANIZER_MODE_PRESETS[newMode]
    if (preset) {
      for (const [key, value] of Object.entries(preset)) {
        onChange(key, value)
      }
    }
  }

  const fmt = (n: number) => n.toLocaleString()
  const pct = (n: number) => Math.min(100, Math.round((n / HUMANIZER_MONTHLY_LIMIT) * 100))

  return (
    <>
      {/* Usage */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <Label className="text-xs text-muted-foreground">Monthly Claude Usage</Label>
        {(() => {
          const used = usage['claude'] ?? 0
          return (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Claude (humanizer)</span>
              <span className="tabular-nums">{fmt(used)} words</span>
            </div>
          )
        })()}
        {[
          { key: 'undetectable', label: 'Undetectable.ai' },
          { key: 'bypassgpt', label: 'BypassGPT' },
        ].map(({ key, label }) => {
          const used = usage[key] ?? 0
          const p = pct(used)
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{fmt(used)} / {fmt(HUMANIZER_MONTHLY_LIMIT)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full transition-all', p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-blue-500')} style={{ width: `${p}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Mode */}
      <FieldGroup label="Voice Mode">
        <select
          value={mode}
          onChange={(e) => handleModeChange(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {HUMANIZER_MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </FieldGroup>

      {/* Sliders */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">Style Parameters</Label>
        {HUMANIZER_SLIDERS.map(({ key, label }) => {
          const val = (config[key] as number) ?? 50
          return (
            <div key={key} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground/80">{label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{val}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={val}
                onChange={(e) => onChange(key, parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
          )
        })}
      </div>

      {/* Targeted rewrite toggle */}
      <div className="flex items-center justify-between rounded-md border border-border p-2.5">
        <div className="space-y-0.5">
          <Label className="text-xs">Targeted rewriting only</Label>
          <p className="text-[11px] text-muted-foreground">
            Rewrites only AI-flagged sentences, not the full piece
          </p>
        </div>
        <button
          onClick={() => onChange('targeted_rewrite', !targetedRewrite)}
          className={cn(
            'ml-3 h-5 w-9 shrink-0 rounded-full border transition-colors',
            targetedRewrite ? 'border-blue-600 bg-blue-600' : 'border-border bg-muted',
          )}
        >
          <span
            className={cn(
              'block h-3.5 w-3.5 rounded-full bg-white transition-transform',
              targetedRewrite ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {/* Model override */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Model Override</Label>
        <p className="text-xs text-muted-foreground/60">Inherited: {inheritedLabel}</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={overrideEnabled}
            onChange={(e) =>
              onChange('model_config', e.target.checked ? { provider: 'anthropic', model: 'claude-sonnet-4-5' } : null)
            }
            className="accent-blue-500"
          />
          <span className="text-xs">Override model for this node</span>
        </label>

        {overrideEnabled && (
          <div className="space-y-2 rounded-md border border-border p-2.5">
            <FieldGroup label="Provider">
              <Select
                value={overrideProvider}
                onValueChange={(v) => onChange('model_config', { provider: v, model: defaultModelForProvider(v) })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic" className="text-xs">Anthropic</SelectItem>
                  <SelectItem value="openai" className="text-xs">OpenAI</SelectItem>
                  <SelectItem value="ollama" className="text-xs">Ollama (local)</SelectItem>
                </SelectContent>
              </Select>
            </FieldGroup>
            <FieldGroup label="Model">
              <Select
                value={overrideModel}
                onValueChange={(v) => onChange('model_config', { ...modelCfg, model: v })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modelsForProvider(overrideProvider).map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldGroup>
          </div>
        )}
      </div>
    </>
  )
}
