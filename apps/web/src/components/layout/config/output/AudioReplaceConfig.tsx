import * as Icons from 'lucide-react'
import { FieldGroup } from '../shared'
import { assetUrl, downloadAsset } from '@/lib/api'

export function AudioReplaceConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const mode         = (config.mode              as string)  ?? 'replace'
  const videoVolume  = (config.video_volume      as number)  ?? 1.0
  const musicVolume  = (config.music_volume      as number)  ?? 0.3
  const loopAudio    = (config.loop_audio        as boolean) ?? true
  const fadeIn       = (config.fade_in_seconds   as number)  ?? 1.0
  const fadeOut      = (config.fade_out_seconds  as number)  ?? 2.0

  const runOutput  = nodeRunStatus?.output as Record<string, unknown> | undefined
  const hasPassed  = nodeRunStatus?.status === 'passed'
  const videoPath  = runOutput?.localPath as string | undefined
  const fullUrl    = videoPath ? assetUrl(videoPath) : null

  return (
    <div className="flex flex-col gap-4">

      {/* Post-run preview */}
      {hasPassed && fullUrl && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Icons.ListMusic className="h-3.5 w-3.5 text-violet-700" />
            <span className="text-xs font-medium text-violet-800">
              {mode === 'mix' ? 'Mixed' : 'Replaced'} audio
            </span>
          </div>
          <video controls className="w-full rounded" style={{ maxHeight: 200 }}>
            <source src={fullUrl} type="video/mp4" />
          </video>
          <div className="flex justify-end">
            <button
              className="flex items-center gap-1 rounded border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 transition-colors"
              onClick={() => downloadAsset(fullUrl!, `audio_replaced.mp4`)}
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
        <p>Connect any <strong>video node</strong> (Character Animation, Video Composition, etc.) and any <strong>audio node</strong> (Music Generation, Audio Mix, Voice Output) to the input handles.</p>
      </div>

      {/* Mode picker */}
      <FieldGroup label="Audio mode">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { value: 'replace', label: 'Replace', sub: 'Swap out original audio' },
            { value: 'mix',     label: 'Mix',     sub: 'Blend with original audio' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange('mode', opt.value)}
              className={`flex flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors ${
                mode === opt.value
                  ? 'border-violet-400 bg-violet-50 text-violet-900'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              <span className="text-xs font-bold leading-tight">{opt.label}</span>
              <span className="text-[9px] text-muted-foreground leading-tight mt-0.5">{opt.sub}</span>
            </button>
          ))}
        </div>
      </FieldGroup>

      {/* New audio volume */}
      <FieldGroup label={`New audio volume — ${Math.round(musicVolume * 100)}%`}>
        <input
          type="range" min={0} max={2} step={0.05}
          value={musicVolume}
          onChange={e => onChange('music_volume', parseFloat(e.target.value))}
          className="w-full accent-violet-600"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
          <span>0%</span><span>100%</span><span>200%</span>
        </div>
      </FieldGroup>

      {/* Original audio volume — only relevant in mix mode */}
      {mode === 'mix' && (
        <FieldGroup label={`Original video audio — ${Math.round(videoVolume * 100)}%`}>
          <input
            type="range" min={0} max={2} step={0.05}
            value={videoVolume}
            onChange={e => onChange('video_volume', parseFloat(e.target.value))}
            className="w-full accent-violet-600"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
            <span>0%</span><span>100%</span><span>200%</span>
          </div>
        </FieldGroup>
      )}

      {/* Loop toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-xs font-medium">Loop audio to fill video</p>
          <p className="text-[10px] text-muted-foreground">
            Repeat the audio if it's shorter than the video
          </p>
        </div>
        <button
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${loopAudio ? 'bg-violet-500' : 'bg-input'}`}
          onClick={() => onChange('loop_audio', !loopAudio)}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${loopAudio ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Fades */}
      <FieldGroup label={`Fade in — ${fadeIn}s`}>
        <input
          type="range" min={0} max={5} step={0.5}
          value={fadeIn}
          onChange={e => onChange('fade_in_seconds', parseFloat(e.target.value))}
          className="w-full accent-violet-600"
        />
      </FieldGroup>
      <FieldGroup label={`Fade out — ${fadeOut}s`}>
        <input
          type="range" min={0} max={8} step={0.5}
          value={fadeOut}
          onChange={e => onChange('fade_out_seconds', parseFloat(e.target.value))}
          className="w-full accent-violet-600"
        />
      </FieldGroup>

      <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
        <p className="font-medium mb-0.5">Output</p>
        <p>Video codec is copied unchanged — only the audio track is re-encoded (AAC 192k). Fast, no quality loss on the video.</p>
      </div>
    </div>
  )
}
