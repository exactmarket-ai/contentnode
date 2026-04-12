import * as Icons from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '../shared'
import { assetUrl } from '@/lib/api'

export function AudioMixConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const voiceVolume  = (config.voice_volume as number) ?? 1.0
  const musicVolume  = (config.music_volume as number) ?? 0.25
  const duckEnabled  = (config.duck_enabled as boolean) ?? true
  const fadeIn       = (config.fade_in_seconds as number) ?? 1.0
  const fadeOut      = (config.fade_out_seconds as number) ?? 2.0
  const voiceDelay   = (config.voice_delay_seconds as number) ?? 0
  const musicDelay   = (config.music_delay_seconds as number) ?? 0

  const runOutput  = nodeRunStatus?.output as Record<string, unknown> | undefined
  const hasPassed  = nodeRunStatus?.status === 'passed'
  const audioPath  = runOutput?.localPath as string | undefined
  const durationS  = runOutput?.duration_seconds as number | undefined
  const fullAudioUrl = audioPath ? assetUrl(audioPath) : null

  return (
    <div className="flex flex-col gap-4">
      {hasPassed && fullAudioUrl && (
        <>
          <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Icons.Layers className="h-3.5 w-3.5 text-teal-700" />
              <span className="text-xs font-medium text-teal-800">Mixed audio</span>
              {durationS != null && durationS > 0 && (
                <span className="ml-auto text-[10px] font-mono text-teal-600">
                  {Math.floor(durationS / 60)}:{String(durationS % 60).padStart(2, '0')}
                </span>
              )}
            </div>
            <audio controls className="w-full" style={{ height: 36 }}>
              <source src={fullAudioUrl} />
            </audio>
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]">
                <a href={fullAudioUrl} download>
                  <Icons.Download className="h-3 w-3" />
                  Download
                </a>
              </Button>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* How to connect */}
      <div className="rounded-md border border-teal-100 bg-teal-50/40 px-3 py-2 text-[10px] text-teal-800 space-y-1">
        <p className="font-medium">How to connect</p>
        <p>Connect <strong>Voice Output → Voice</strong> handle and <strong>Music Generation → Music</strong> handle on this node.</p>
        <p>The node identifies each input automatically by its content type.</p>
      </div>

      <FieldGroup label={`Voice volume — ${Math.round(voiceVolume * 100)}%`}>
        <input type="range" min={0} max={2} step={0.05} value={voiceVolume}
          onChange={e => onChange('voice_volume', parseFloat(e.target.value))}
          className="w-full accent-teal-600" />
        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
          <span>0%</span><span>100%</span><span>200%</span>
        </div>
      </FieldGroup>

      <FieldGroup label={`Music volume — ${Math.round(musicVolume * 100)}%`}>
        <input type="range" min={0} max={1} step={0.05} value={musicVolume}
          onChange={e => onChange('music_volume', parseFloat(e.target.value))}
          className="w-full accent-teal-600" />
        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </FieldGroup>

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-xs font-medium">Auto-duck music under voice</p>
          <p className="text-[10px] text-muted-foreground">
            Music volume lowers automatically when speech is detected (sidechain compression)
          </p>
        </div>
        <button
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${duckEnabled ? 'bg-teal-600' : 'bg-input'}`}
          onClick={() => onChange('duck_enabled', !duckEnabled)}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${duckEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {!duckEnabled && (
        <>
          <FieldGroup label={`Fade in — ${fadeIn}s`}>
            <input type="range" min={0} max={5} step={0.5} value={fadeIn}
              onChange={e => onChange('fade_in_seconds', parseFloat(e.target.value))}
              className="w-full accent-teal-600" />
          </FieldGroup>
          <FieldGroup label={`Fade out — ${fadeOut}s`}>
            <input type="range" min={0} max={8} step={0.5} value={fadeOut}
              onChange={e => onChange('fade_out_seconds', parseFloat(e.target.value))}
              className="w-full accent-teal-600" />
          </FieldGroup>
        </>
      )}

      <div className="space-y-3 rounded-lg border border-border px-3 py-2.5">
        <p className="text-xs font-medium">Track timing</p>
        <FieldGroup label={`Voice starts at — ${voiceDelay}s`}>
          <input type="range" min={0} max={10} step={0.5} value={voiceDelay}
            onChange={e => onChange('voice_delay_seconds', parseFloat(e.target.value))}
            className="w-full accent-teal-600" />
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
            <span>0s — immediate</span><span>10s</span>
          </div>
        </FieldGroup>
        <FieldGroup label={`Music starts at — ${musicDelay}s`}>
          <input type="range" min={0} max={10} step={0.5} value={musicDelay}
            onChange={e => onChange('music_delay_seconds', parseFloat(e.target.value))}
            className="w-full accent-teal-600" />
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
            <span>0s — immediate</span><span>10s</span>
          </div>
        </FieldGroup>
        <p className="text-[9px] text-muted-foreground/60">Delay a track to let the other play first. e.g. start music 2s before voice.</p>
      </div>

      <div className="rounded-md border border-border px-3 py-2 text-[10px] text-muted-foreground">
        <p className="font-medium mb-0.5">Requires ffmpeg</p>
        <p>Install with: <code className="font-mono">brew install ffmpeg</code></p>
        <p className="mt-0.5">The mixed file duration follows the longest track.</p>
      </div>
    </div>
  )
}
