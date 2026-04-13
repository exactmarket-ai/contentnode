import * as Icons from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'
import { assetUrl, downloadAsset } from '@/lib/api'
import { AttachmentZone } from '../AttachmentZone'

// ─── Constants ────────────────────────────────────────────────────────────────

const OVERLAY_STYLES = [
  { value: 'lower_third', label: 'Lower Third',  desc: 'Colored bar at bottom with title + subtitle' },
  { value: 'title_card',  label: 'Title Card',   desc: 'Full-width bar, centered text' },
  { value: 'pill_badge',  label: 'Pill Badge',   desc: 'Small badge top-left' },
  { value: 'fullscreen',  label: 'Fullscreen',   desc: 'Large centered text, no box' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function VideoCompositionConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const renderMode   = (config.render_mode as string)    ?? 'local'
  const outputFormat = (config.output_format as string)  ?? 'video'
  const overlayStyle = (config.overlay_style as string)  ?? 'lower_third'
  const brandColor   = (config.brand_color as string)    ?? '#1a73e8'
  const fontSize     = (config.font_size as number)      ?? 28
  const duration     = (config.duration as number)       ?? 10
  const bgUrl        = (config.background_url as string) ?? ''
  const textConfig   = (config.text as string)           ?? ''

  const runOutput     = nodeRunStatus?.output as Record<string, unknown> | undefined
  const hasPassed     = nodeRunStatus?.status === 'passed'
  const outputPath    = runOutput?.localPath as string | undefined
  const cloudUrl      = runOutput?.cloudUrl as string | undefined
  const fullOutputUrl = outputPath ? assetUrl(outputPath) : null
  const resultIsImage = (runOutput?.outputFormat ?? runOutput?.type) === 'image'

  const overlayMeta = OVERLAY_STYLES.find(o => o.value === overlayStyle)

  return (
    <div className="flex flex-col gap-4">

      {/* Post-run output (video or image) */}
      {hasPassed && fullOutputUrl && (
        <>
          <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-2 space-y-2">
            <div className="flex items-center gap-2">
              {resultIsImage
                ? <Icons.Image className="h-3.5 w-3.5 text-sky-700" />
                : <Icons.Film className="h-3.5 w-3.5 text-sky-700" />}
              <span className="text-xs font-medium text-sky-800">
                {resultIsImage ? 'Composed image' : 'Composed video'}
              </span>
              <span className="ml-auto text-[9px] rounded-full px-1.5 py-px font-medium"
                style={{ backgroundColor: runOutput?.renderMode === 'cloud' ? '#e0f2fe' : '#f0fdf4', color: runOutput?.renderMode === 'cloud' ? '#0369a1' : '#166534' }}>
                {runOutput?.renderMode === 'cloud' ? '☁ Cloud' : '⚙ Local'}
              </span>
            </div>
            {resultIsImage
              ? <img src={fullOutputUrl} alt="composition" className="w-full rounded" style={{ maxHeight: 200, objectFit: 'contain' }} />
              : <video controls className="w-full rounded" style={{ maxHeight: 200 }}>
                  <source src={fullOutputUrl} type="video/mp4" />
                </video>
            }
            {cloudUrl && (
              <p className="text-[9px] text-sky-600 truncate">Shotstack: {cloudUrl}</p>
            )}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]"
                onClick={() => downloadAsset(fullOutputUrl!, resultIsImage ? 'composition.jpg' : 'composition.mp4')}>
                <Icons.Download className="h-3 w-3" />
                Download
              </Button>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* How to connect */}
      <div className="rounded-md border border-sky-100 bg-sky-50/40 px-3 py-2 text-[10px] text-sky-800 space-y-1">
        <p className="font-medium">How to connect</p>
        <p>Connect <strong>Image → Image</strong>, <strong>Content/Text → Text</strong>, and optionally <strong>Audio → Audio</strong> handles.</p>
      </div>

      {/* Output format */}
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-xs font-medium">Output format</p>
          <p className="text-[10px] text-muted-foreground">
            {outputFormat === 'image' ? 'JPEG image — one still frame (use for thumbnails)' : 'MP4 video — animated output with text overlay'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <button
            onClick={() => onChange('output_format', 'video')}
            className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${outputFormat === 'video' ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-background border-border text-muted-foreground'}`}
          >
            <Icons.Film className="inline h-3 w-3 mr-0.5" />VID
          </button>
          <button
            onClick={() => onChange('output_format', 'image')}
            className={`px-2 py-1 rounded text-[10px] font-semibold border transition-colors ${outputFormat === 'image' ? 'bg-sky-100 border-sky-400 text-sky-800' : 'bg-background border-border text-muted-foreground'}`}
          >
            <Icons.Image className="inline h-3 w-3 mr-0.5" />IMG
          </button>
        </div>
      </div>

      {/* Render mode */}
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-xs font-medium">Render mode</p>
          <p className="text-[10px] text-muted-foreground">
            {renderMode === 'cloud' ? 'Shotstack cloud — falls back to local on failure' : 'Local ffmpeg — no API cost'}
          </p>
        </div>
        <button
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${renderMode === 'cloud' ? 'bg-sky-600' : 'bg-input'}`}
          onClick={() => onChange('render_mode', renderMode === 'cloud' ? 'local' : 'cloud')}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${renderMode === 'cloud' ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Overlay style */}
      <FieldGroup label="Overlay style">
        <select
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={overlayStyle}
          onChange={e => onChange('overlay_style', e.target.value)}
        >
          {OVERLAY_STYLES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {overlayMeta && (
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">{overlayMeta.desc}</p>
        )}
      </FieldGroup>

      {/* Background image */}
      <FieldGroup label="Background image">
        <AttachmentZone
          value={bgUrl}
          onChange={v => onChange('background_url', v)}
          accept="image/*"
          label="Drop image or paste URL"
          hint="Overridden by upstream Image Generation node."
        />
        {!bgUrl && (
          <Input
            className="mt-1.5 h-8 text-xs"
            placeholder="https://… or leave blank to use upstream image"
            onChange={e => onChange('background_url', e.target.value)}
          />
        )}
      </FieldGroup>

      {/* Text override */}
      <FieldGroup label="Text (override upstream)">
        <textarea
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-none"
          rows={3}
          placeholder="Populated from upstream node. First line = title, second line = subtitle."
          value={textConfig}
          onChange={e => onChange('text', e.target.value)}
        />
      </FieldGroup>

      {/* Brand color */}
      <FieldGroup label="Brand color">
        <div className="flex items-center gap-2">
          <input type="color" value={brandColor}
            onChange={e => onChange('brand_color', e.target.value)}
            className="h-8 w-10 rounded border border-input cursor-pointer" />
          <Input className="h-8 text-xs font-mono flex-1" value={brandColor}
            onChange={e => onChange('brand_color', e.target.value)} placeholder="#1a73e8" />
        </div>
      </FieldGroup>

      {/* Font size */}
      <FieldGroup label={`Font size — ${fontSize}px`}>
        <input type="range" min={14} max={72} step={2} value={fontSize}
          onChange={e => onChange('font_size', parseInt(e.target.value))}
          className="w-full accent-sky-600" />
        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
          <span>14px</span><span>72px</span>
        </div>
      </FieldGroup>

      {/* Duration — only relevant for video output */}
      {outputFormat !== 'image' && (
        <FieldGroup label={`Duration — ${duration}s`}>
          <input type="range" min={3} max={60} step={1} value={duration}
            onChange={e => onChange('duration', parseInt(e.target.value))}
            className="w-full accent-sky-600" />
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
            <span>3s</span><span>60s</span>
          </div>
        </FieldGroup>
      )}

      {/* Cloud env note */}
      {renderMode === 'cloud' && (
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground space-y-0.5">
          <p className="font-medium">Worker environment variables</p>
          <p><code className="font-mono">SHOTSTACK_API_KEY=your_key</code> — required</p>
          <p><code className="font-mono">SHOTSTACK_ENV=stage</code> — <code>stage</code> (default) or <code>production</code></p>
        </div>
      )}

      {/* Local note */}
      {renderMode === 'local' && (
        <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
          <p className="font-medium mb-0.5">Requires ffmpeg</p>
          <p>Install: <code className="font-mono">brew install ffmpeg</code></p>
        </div>
      )}
    </div>
  )
}
