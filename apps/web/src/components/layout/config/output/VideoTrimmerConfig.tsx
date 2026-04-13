import * as Icons from 'lucide-react'
import { FieldGroup } from '../shared'
import { assetUrl, downloadAsset } from '@/lib/api'

// ─── Component ────────────────────────────────────────────────────────────────

export function VideoTrimmerConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const trimMode  = (config.trim_mode  as string) ?? 'duration'
  const startTime = (config.start_time as number) ?? 0
  const duration  = (config.duration   as number) ?? 10
  const endTime   = (config.end_time   as number) ?? 10

  const runOutput  = nodeRunStatus?.output as Record<string, unknown> | undefined
  const hasPassed  = nodeRunStatus?.status === 'passed'
  const videoPath  = runOutput?.localPath as string | undefined
  const fullUrl    = videoPath ? assetUrl(videoPath) : null

  const effectiveEnd = trimMode === 'end_time' ? endTime : startTime + duration

  return (
    <div className="flex flex-col gap-4">

      {/* Post-run preview */}
      {hasPassed && fullUrl && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Icons.Scissors className="h-3.5 w-3.5 text-violet-700" />
            <span className="text-xs font-medium text-violet-800">Trimmed clip</span>
            <span className="ml-auto text-[9px] text-violet-600 font-medium">
              {(runOutput?.startSec as number | undefined) ?? 0}s → {(((runOutput?.startSec as number | undefined) ?? 0) + ((runOutput?.durationSec as number | undefined) ?? 0)).toFixed(1)}s
            </span>
          </div>
          <video controls className="w-full rounded" style={{ maxHeight: 180 }}>
            <source src={fullUrl} type="video/mp4" />
          </video>
          <div className="flex justify-end">
            <button
              className="flex items-center gap-1 rounded border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 transition-colors"
              onClick={() => downloadAsset(fullUrl!, 'trimmed.mp4')}
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
        <p>Connect a <strong>Video Upload</strong>, <strong>Video Composition</strong>, or <strong>Video Generation</strong> node to the input handle.</p>
      </div>

      {/* Trim mode */}
      <FieldGroup label="Trim mode">
        <div className="flex gap-1.5">
          {(['duration', 'end_time'] as const).map(m => (
            <button
              key={m}
              onClick={() => onChange('trim_mode', m)}
              className={`flex-1 rounded border py-1 text-[10px] font-semibold transition-colors ${trimMode === m ? 'border-violet-400 bg-violet-100 text-violet-800' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
            >
              {m === 'duration' ? 'Start + Duration' : 'Start → End time'}
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* Start time */}
      <FieldGroup label={`Start time — ${startTime}s`}>
        <input
          type="range" min={0} max={3600} step={0.5}
          value={startTime}
          onChange={e => onChange('start_time', parseFloat(e.target.value))}
          className="w-full accent-violet-600"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <input
            type="number" min={0} step={0.1}
            value={startTime}
            onChange={e => onChange('start_time', Math.max(0, parseFloat(e.target.value) || 0))}
            className="h-7 w-24 rounded border border-input bg-background px-2 text-xs font-mono"
          />
          <span className="text-[10px] text-muted-foreground">seconds from start</span>
        </div>
      </FieldGroup>

      {/* Duration or End time */}
      {trimMode === 'duration' ? (
        <FieldGroup label={`Duration — ${duration}s`}>
          <input
            type="range" min={1} max={300} step={0.5}
            value={duration}
            onChange={e => onChange('duration', parseFloat(e.target.value))}
            className="w-full accent-violet-600"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="number" min={0.1} step={0.1}
              value={duration}
              onChange={e => onChange('duration', Math.max(0.1, parseFloat(e.target.value) || 0.1))}
              className="h-7 w-24 rounded border border-input bg-background px-2 text-xs font-mono"
            />
            <span className="text-[10px] text-muted-foreground">seconds to keep</span>
          </div>
        </FieldGroup>
      ) : (
        <FieldGroup label={`End time — ${endTime}s`}>
          <input
            type="range" min={0} max={3600} step={0.5}
            value={endTime}
            onChange={e => onChange('end_time', parseFloat(e.target.value))}
            className="w-full accent-violet-600"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="number" min={0} step={0.1}
              value={endTime}
              onChange={e => onChange('end_time', Math.max(0, parseFloat(e.target.value) || 0))}
              className="h-7 w-24 rounded border border-input bg-background px-2 text-xs font-mono"
            />
            <span className="text-[10px] text-muted-foreground">seconds from start</span>
          </div>
        </FieldGroup>
      )}

      {/* Summary */}
      <div className="rounded-md bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
        Output clip: <span className="font-mono font-medium text-foreground">{startTime}s – {effectiveEnd.toFixed(1)}s</span>
        {' '}({(effectiveEnd - startTime).toFixed(1)}s)
      </div>

      <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
        <p className="font-medium mb-0.5">Stream copy — no quality loss</p>
        <p>Uses <code className="font-mono">-c copy</code> — no re-encoding. Fast and lossless. Requires ffmpeg.</p>
      </div>
    </div>
  )
}
