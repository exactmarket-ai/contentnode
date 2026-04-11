import { FieldGroup } from '../shared'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'

const PRESETS = [
  // Social
  { value: 'instagram-square',    label: 'Instagram Square (1080×1080)',    category: 'Social' },
  { value: 'instagram-portrait',  label: 'Instagram Portrait (1080×1350)',   category: 'Social' },
  { value: 'instagram-landscape', label: 'Instagram Landscape (1080×566)',   category: 'Social' },
  { value: 'facebook-linkedin',   label: 'Facebook / LinkedIn (1200×630)',   category: 'Social' },
  { value: 'twitter-x',           label: 'Twitter / X (1200×675)',           category: 'Social' },
  { value: 'pinterest',           label: 'Pinterest (1000×1500)',            category: 'Social' },
  // Video
  { value: 'youtube-thumbnail',   label: 'YouTube Thumbnail (1280×720)',     category: 'Video' },
  // Web
  { value: 'blog-thumbnail',      label: 'Blog / CMS Thumbnail (400×300)',   category: 'Web' },
  { value: 'open-graph',          label: 'Open Graph Preview (1200×630)',    category: 'Web' },
  { value: 'article-card',        label: 'Article Card (800×450)',           category: 'Web' },
  { value: 'avatar',              label: 'Avatar / Profile (200×200)',       category: 'Web' },
  // General
  { value: 'full-hd',             label: 'Full HD (1920×1080)',              category: 'General' },
  { value: 'custom',              label: 'Custom…',                          category: 'General' },
]

const CATEGORIES = ['Social', 'Video', 'Web', 'General']

const FIT_OPTIONS = [
  { value: 'cover',   label: 'Cover — crop to fill (no letterbox)' },
  { value: 'contain', label: 'Contain — letterbox to fit' },
  { value: 'fill',    label: 'Fill — stretch to fit exactly' },
  { value: 'inside',  label: 'Inside — shrink only, never upscale' },
]

const FORMAT_OPTIONS = [
  { value: 'same',  label: 'Same as input' },
  { value: 'jpeg',  label: 'JPEG' },
  { value: 'png',   label: 'PNG' },
  { value: 'webp',  label: 'WebP' },
]

export function ImageResizeConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const preset  = (config.preset  as string) ?? 'instagram-square'
  const fit     = (config.fit     as string) ?? 'cover'
  const format  = (config.format  as string) ?? 'same'
  const quality = (config.quality as number) ?? 85
  const width   = (config.width   as number) ?? 800
  const height  = (config.height  as number) ?? 600

  const isCustom = preset === 'custom'
  const showQuality = format === 'jpeg' || format === 'webp'

  return (
    <>
      <FieldGroup label="Size Preset">
        <Select value={preset} onValueChange={(v) => onChange('preset', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectGroup key={cat}>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {cat}
                </SelectLabel>
                {PRESETS.filter((p) => p.category === cat).map((p) => (
                  <SelectItem key={p.value} value={p.value} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {isCustom && (
        <FieldGroup label="Dimensions (px)">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              placeholder="Width"
              value={width}
              onChange={(e) => onChange('width', Number(e.target.value))}
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              placeholder="Height"
              value={height}
              onChange={(e) => onChange('height', Number(e.target.value))}
            />
          </div>
        </FieldGroup>
      )}

      <FieldGroup label="Fit">
        <Select value={fit} onValueChange={(v) => onChange('fit', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      <FieldGroup label="Output Format">
        <Select value={format} onValueChange={(v) => onChange('format', v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMAT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {showQuality && (
        <FieldGroup label={`Quality — ${quality}%`}>
          <Slider
            min={1}
            max={100}
            step={1}
            value={[quality]}
            onValueChange={([v]) => onChange('quality', v)}
          />
          <p className="text-[11px] text-muted-foreground">
            Higher quality = larger file size. 85% is a good default.
          </p>
        </FieldGroup>
      )}
    </>
  )
}
