import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'

const PROVIDERS = [
  { value: 'gptimage2',     label: 'GPT Image 2' },
  { value: 'gptimage15',    label: 'GPT Image 1.5' },
  { value: 'gptimage1mini', label: 'GPT Image Mini' },
  { value: 'dalle3',        label: 'DALL-E 3' },
  { value: 'ideogram',      label: 'Ideogram v2' },
  { value: 'fal',           label: 'Fal.ai (FLUX)' },
]

const QUALITY_OPTIONS = [
  { value: 'draft',    label: 'Draft (fast)' },
  { value: 'standard', label: 'Standard' },
  { value: 'high',     label: 'High quality' },
]

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 — Landscape' },
  { value: '1:1',  label: '1:1 — Square' },
  { value: '4:3',  label: '4:3 — Classic' },
  { value: '9:16', label: '9:16 — Portrait' },
]

const FRAMES_OPTIONS = [1, 2, 3, 4]

export function StoryboardFrameGenConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const provider      = (config.provider     as string) ?? 'gptimage2'
  const quality       = (config.quality      as string) ?? 'standard'
  const aspect_ratio  = (config.aspect_ratio as string) ?? '16:9'
  const framesPerScene = (config.framesPerScene as number) ?? 1
  const useCachedImages = (config.useCachedImages as boolean) ?? false

  return (
    <div className="space-y-4">
      <FieldGroup label="Image Provider">
        <Select value={provider} onValueChange={(v) => onChange('provider', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Quality">
        <Select value={quality} onValueChange={(v) => onChange('quality', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUALITY_OPTIONS.map((q) => (
              <SelectItem key={q.value} value={q.value} className="text-xs">{q.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Aspect Ratio">
        <Select value={aspect_ratio} onValueChange={(v) => onChange('aspect_ratio', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((a) => (
              <SelectItem key={a.value} value={a.value} className="text-xs">{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Frames per Scene" description="Number of images generated for each scene (1–4).">
        <Select value={String(framesPerScene)} onValueChange={(v) => onChange('framesPerScene', Number(v))}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FRAMES_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Client Name">
        <Input
          className="h-8 text-xs"
          value={(config.clientName as string) ?? ''}
          onChange={(e) => onChange('clientName', e.target.value)}
          placeholder="e.g. Acme Corp"
        />
      </FieldGroup>

      <FieldGroup label="Vertical">
        <Input
          className="h-8 text-xs"
          value={(config.verticalName as string) ?? ''}
          onChange={(e) => onChange('verticalName', e.target.value)}
          placeholder="e.g. Healthcare SaaS"
        />
      </FieldGroup>

      <FieldGroup label="Skip Image Generation" description="Return placeholder images — useful for testing the pipeline layout without burning API credits.">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={useCachedImages}
            onChange={(e) => onChange('useCachedImages', e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <span className="text-xs text-muted-foreground">Use placeholders</span>
        </label>
      </FieldGroup>
    </div>
  )
}
