import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'

const SYNTHESIS_TARGETS = [
  { value: 'summary', label: 'General Summary' },
  { value: 'dg_s7', label: 'S7: External Intelligence (Demand Gen)' },
  { value: 'gtm_12', label: '§12: Competitive Differentiation (GTM)' },
  { value: 'raw', label: 'Raw Concatenation (no synthesis)' },
]

export function DeepWebScrapeConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  return (
    <>
      <FieldGroup label="Seed URLs" description="One URL per line — up to 3 starting points">
        <Textarea
          placeholder={'https://example.com/blog\nhttps://competitor.com/resources'}
          className="text-xs min-h-[72px] font-mono"
          value={(config.seedUrls as string) ?? ''}
          onChange={(e) => onChange('seedUrls', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Max Pages to Crawl">
        <Input
          type="number"
          min={1}
          max={20}
          className="text-xs"
          value={(config.maxPages as number) ?? 10}
          onChange={(e) => onChange('maxPages', parseInt(e.target.value, 10) || 10)}
        />
        <p className="text-[10px] text-muted-foreground mt-1">1–20 pages (default 10)</p>
      </FieldGroup>

      <FieldGroup label="Link Pattern Filter (optional)" description="Regex — only follow links matching this pattern">
        <Input
          placeholder="/blog|/article|/resource"
          className="text-xs font-mono"
          value={(config.linkPattern as string) ?? ''}
          onChange={(e) => onChange('linkPattern', e.target.value)}
        />
      </FieldGroup>

      <button
        type="button"
        onClick={() => onChange('stayOnDomain', !((config.stayOnDomain as boolean) ?? true))}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 rounded text-xs border transition-colors text-left w-full',
          (config.stayOnDomain as boolean) ?? true
            ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
            : 'border-border text-muted-foreground hover:text-foreground'
        )}
      >
        <span className={cn(
          'w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0',
          (config.stayOnDomain as boolean) ?? true ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground'
        )}>
          {((config.stayOnDomain as boolean) ?? true) && <span className="text-[8px] font-bold text-white">✓</span>}
        </span>
        Stay on same domain
      </button>

      <FieldGroup label="Synthesis Target">
        <Select
          value={(config.synthesisTarget as string) ?? 'summary'}
          onValueChange={(v) => onChange('synthesisTarget', v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNTHESIS_TARGETS.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Custom Synthesis Instructions (optional)">
        <Textarea
          placeholder="Focus on pricing signals and feature gaps vs. our offering..."
          className="text-xs min-h-[60px]"
          value={(config.synthesisInstructions as string) ?? ''}
          onChange={(e) => onChange('synthesisInstructions', e.target.value)}
        />
      </FieldGroup>
    </>
  )
}
