import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldGroup } from '../shared'
import { cn } from '@/lib/utils'

const PLATFORMS = [
  { value: 'trustpilot', label: 'Trustpilot', hint: 'slug = company domain (e.g. hubspot.com)' },
  { value: 'g2', label: 'G2', hint: 'slug = product slug (e.g. hubspot-crm)' },
  { value: 'capterra', label: 'Capterra', hint: 'slug = product ID (e.g. hubspot-crm)' },
  { value: 'custom_url', label: 'Custom URL', hint: 'paste the full review page URL as the slug' },
]

const SYNTHESIS_TYPES = [
  { value: 'themes', label: 'Theme Analysis' },
  { value: 'battlecard', label: 'Competitive Battlecard' },
  { value: 'objections', label: 'Objection Map' },
  { value: 'testimonials', label: 'Testimonial Extraction' },
  { value: 'all', label: 'Full Analysis' },
]

export function ReviewMinerConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const selectedPlatforms = (config.platforms as string[]) ?? ['trustpilot']

  function togglePlatform(value: string) {
    const next = selectedPlatforms.includes(value)
      ? selectedPlatforms.filter((p) => p !== value)
      : [...selectedPlatforms, value]
    onChange('platforms', next)
  }

  const activePlatform = PLATFORMS.find((p) => p.value === selectedPlatforms[0])

  return (
    <>
      <FieldGroup label="Target Company">
        <Input
          placeholder="HubSpot"
          className="text-xs"
          value={(config.companyName as string) ?? ''}
          onChange={(e) => onChange('companyName', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Company Slug / URL"
        description={activePlatform?.hint ?? 'Platform-specific identifier'}
      >
        <Input
          placeholder="hubspot.com"
          className="text-xs font-mono"
          value={(config.companySlug as string) ?? ''}
          onChange={(e) => onChange('companySlug', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Platforms">
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => togglePlatform(p.value)}
              className={cn(
                'px-2 py-1 text-xs rounded border transition-colors',
                selectedPlatforms.includes(p.value)
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Competitor Slugs (optional)" description="One per line — same slug format as above">
        <Textarea
          placeholder={'salesforce.com\nmarketo.com'}
          className="text-xs min-h-[60px] font-mono"
          value={(config.competitors as string) ?? ''}
          onChange={(e) => onChange('competitors', e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Max Reviews per Source">
        <Input
          type="number"
          min={5}
          max={50}
          className="text-xs"
          value={(config.maxReviewsPerSource as number) ?? 20}
          onChange={(e) => onChange('maxReviewsPerSource', parseInt(e.target.value, 10) || 20)}
        />
      </FieldGroup>

      <FieldGroup label="Analysis Type">
        <Select
          value={(config.synthesisType as string) ?? 'themes'}
          onValueChange={(v) => onChange('synthesisType', v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNTHESIS_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <div className="border-l-2 border-amber-400 bg-amber-50 pl-2.5 pr-2 py-2 mt-1">
        <p className="text-[10px] text-amber-700 leading-relaxed">
          Review sites use heavy JS rendering — extraction works best on Trustpilot. For G2/Capterra, results may be partial. Use "Custom URL" to target any page directly.
        </p>
      </div>
    </>
  )
}
