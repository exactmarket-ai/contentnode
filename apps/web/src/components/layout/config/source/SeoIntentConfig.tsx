import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'

const DATA_SOURCES = [
  { value: 'claude', label: 'Claude (no API key needed)' },
  { value: 'google_autocomplete', label: 'Google Autocomplete + Claude' },
  { value: 'dataforseo', label: 'DataForSEO (volume data)' },
]

export function SeoIntentConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const dataSource = (config.dataSource as string) ?? 'claude'

  return (
    <>
      <FieldGroup label="Topic" description="Broad subject area to research">
        <Input
          placeholder="B2B SaaS onboarding"
          className="text-xs"
          value={(config.topic as string) ?? ''}
          onChange={(e) => onChange('topic', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Seed Keywords" description="One per line — specific terms to expand from">
        <Textarea
          placeholder={'customer onboarding software\nuser activation\nonboarding automation'}
          className="text-xs min-h-[72px] font-mono"
          value={(config.seedKeywords as string) ?? ''}
          onChange={(e) => onChange('seedKeywords', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Target Keyword Count">
        <Input
          type="number"
          min={10}
          max={60}
          className="text-xs"
          value={(config.expandCount as number) ?? 30}
          onChange={(e) => onChange('expandCount', parseInt(e.target.value, 10) || 30)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">10–60 keywords</p>
      </FieldGroup>

      <FieldGroup label="Data Source">
        <Select
          value={dataSource}
          onValueChange={(v) => onChange('dataSource', v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_SOURCES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {dataSource === 'dataforseo' && (
        <FieldGroup
          label="DataForSEO API Key Env Var"
          description="Env var holding your DataForSEO credentials (login:password)"
        >
          <Input
            placeholder="DATAFORSEO_KEY"
            className="text-xs font-mono"
            value={(config.apiKeyRef as string) ?? ''}
            onChange={(e) => onChange('apiKeyRef', e.target.value)}
          />
        </FieldGroup>
      )}

      <button
        type="button"
        onClick={() => onChange('funnelMapping', !((config.funnelMapping as boolean) ?? true))}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs border transition-colors text-left w-full',
          (config.funnelMapping as boolean) ?? true
            ? 'bg-violet-900/40 border-violet-700 text-violet-300'
            : 'border-border text-muted-foreground hover:text-foreground'
        )}
      >
        <span className={cn(
          'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
          (config.funnelMapping as boolean) ?? true ? 'bg-violet-500 border-violet-500' : 'border-muted-foreground'
        )}>
          {((config.funnelMapping as boolean) ?? true) && <span className="text-[8px] font-bold text-white">✓</span>}
        </span>
        Map to funnel stages (Awareness / Consideration / Decision)
      </button>
    </>
  )
}
