import * as Icons from 'lucide-react'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '../shared'
import { assetUrl, downloadAsset } from '@/lib/api'

// ─── Preset definitions (mirrors worker) ──────────────────────────────────────

const PRESETS = [
  { value: 'reels',       label: '9:16',  sub: 'Reels / TikTok / Shorts', w: 1080, h: 1920 },
  { value: 'square',      label: '1:1',   sub: 'Instagram / Facebook',     w: 1080, h: 1080 },
  { value: 'instagram45', label: '4:5',   sub: 'Instagram Feed',           w: 1080, h: 1350 },
  { value: 'landscape',   label: '16:9',  sub: 'YouTube / LinkedIn',       w: 1920, h: 1080 },
  { value: 'custom',      label: 'Custom',sub: 'Set your own dimensions',  w: 0,    h: 0    },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function VideoResizeConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const preset  = (config.preset  as string) ?? 'reels'
  const customW = (config.width   as number) ?? 1080
  const customH = (config.height  as number) ?? 1920
  const crf     = (config.crf     as number) ?? 23

  const runOutput = nodeRunStatus?.output as Record<string, unknown> | undefined
  const hasPassed = nodeRunStatus?.status === 'passed'
  const videoPath = runOutput?.localPath as string | undefined
  const fullUrl   = videoPath ? assetUrl(videoPath) : null

  const selected  = PRESETS.find(p => p.value === preset)
  const displayW  = preset === 'custom' ? customW : (selected?.w ?? 1080)
  const displayH  = preset === 'custom' ? customH : (selected?.h ?? 1920)

  return (
    <div className="flex flex-col gap-4">

      {/* Post-run preview */}
      {hasPassed && fullUrl && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Icons.Maximize2 className="h-3.5 w-3.5 text-violet-700" />
            <span className="text-xs font-medium text-violet-800">Resized video</span>
            <span className="ml-auto text-[9px] text-violet-600 font-medium font-mono">
              {(runOutput?.width as number | undefined) ?? displayW}×{(runOutput?.height as number | undefined) ?? displayH}
            </span>
          </div>
          <video controls className="w-full rounded" style={{ maxHeight: 200 }}>
            <source src={fullUrl} type="video/mp4" />
          </video>
          <div className="flex justify-end">
            <button
              className="flex items-center gap-1 rounded border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 transition-colors"
              onClick={() => downloadAsset(fullUrl!, `resized_${runOutput?.preset ?? preset}.mp4`)}
            >
              <Icons.Download className="h-3 w-3" />
              Download
            </button>
          </div>
        </div>
      )}

      {/* How to connect */}
      <div className="rounded-md border border-violet-100 bg-violet-50/40 px-3 py-2 text-[10px] text-violet-800 space-y-1">
        <p className="font-medium">How to connect</p>
        <p>Connect any video node (Upload, Composition, Generation, Trimmer) to the input handle.</p>
      </div>

      {/* Preset picker */}
      <FieldGroup label="Aspect ratio">
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => onChange('preset', p.value)}
              className={`flex flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors ${preset === p.value ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-border bg-background text-foreground hover:bg-muted'}`}
            >
              <span className="text-xs font-bold leading-tight">{p.label}</span>
              <span className="text-[9px] text-muted-foreground leading-tight mt-0.5">{p.sub}</span>
              {p.w > 0 && (
                <span className="text-[8px] font-mono text-muted-foreground/70 mt-0.5">{p.w}×{p.h}</span>
              )}
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* Custom dimensions */}
      {preset === 'custom' && (
        <FieldGroup label="Custom dimensions">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[9px] text-muted-foreground">Width (px)</label>
              <Input
                type="number" min={2} step={2}
                value={customW}
                onChange={e => onChange('width', Math.max(2, parseInt(e.target.value) || 2))}
                className="h-7 text-xs font-mono"
              />
            </div>
            <Icons.X className="h-3 w-3 text-muted-foreground mt-4 shrink-0" />
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[9px] text-muted-foreground">Height (px)</label>
              <Input
                type="number" min={2} step={2}
                value={customH}
                onChange={e => onChange('height', Math.max(2, parseInt(e.target.value) || 2))}
                className="h-7 text-xs font-mono"
              />
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground mt-1">Both dimensions must be even numbers.</p>
        </FieldGroup>
      )}

      {/* Output summary */}
      <div className="rounded-md bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
        Output: <span className="font-mono font-medium text-foreground">{displayW}×{displayH}</span>
        {' '}— smart center-crop then scale
      </div>

      {/* Quality */}
      <FieldGroup label={`Quality (CRF ${crf} — lower = better)`}>
        <input
          type="range" min={15} max={40} step={1}
          value={crf}
          onChange={e => onChange('crf', parseInt(e.target.value))}
          className="w-full accent-violet-600"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
          <span>15 (best)</span><span>40 (smallest)</span>
        </div>
      </FieldGroup>

      <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
        <p className="font-medium mb-0.5">Smart crop</p>
        <p>Scales up to fill the frame, then center-crops to exact dimensions. Requires ffmpeg.</p>
      </div>
    </div>
  )
}
