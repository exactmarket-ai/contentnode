import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { FieldGroup } from '../shared'
import { assetUrl } from '@/lib/api'

const MUSIC_DURATIONS = [10,15,20,30,45,60,90,120,180,300]
const SFX_DURATIONS   = [3,5,8,10,15,20,30]

function formatDuration(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60 > 0 ? `${s % 60}s` : ''}` : `${s}s`
}

export function MusicGenerationConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown }
}) {
  const service          = (config.service as string) ?? 'music'
  const prompt           = (config.prompt as string) ?? ''
  const duration         = (config.duration_seconds as number) ?? 30
  const forceInstrumental = (config.force_instrumental as boolean) ?? true
  const promptInfluence  = (config.prompt_influence as number) ?? 0.3
  const durations        = service === 'sfx' ? SFX_DURATIONS : MUSIC_DURATIONS

  const isLocked   = (config.locked as boolean) ?? false

  const runOutput  = nodeRunStatus?.output as Record<string, unknown> | undefined
  const isSkipped  = nodeRunStatus?.status === 'skipped'
  const hasPassed  = nodeRunStatus?.status === 'passed'
  const storedOut  = config.stored_output as Record<string, unknown> | undefined
  const activeOut  = runOutput ?? (isSkipped ? storedOut : undefined)
  const audioPath  = activeOut?.localPath as string | undefined
  const hasStored  = !!storedOut?.localPath

  const fullAudioUrl = audioPath ? assetUrl(audioPath) : null

  return (
    <div className="flex flex-col gap-4">
      {/* ── Skip / lock toggle ──────────────────────────────────────────── */}
      <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${isLocked ? 'border-amber-400/60 bg-amber-950/20' : 'border-border bg-muted/20'}`}>
        <div className="flex items-center gap-2">
          <Icons.Lock className={`h-3.5 w-3.5 ${isLocked ? 'text-amber-400' : 'text-muted-foreground'}`} />
          <div>
            <p className="text-xs font-medium">Skip on next run</p>
            <p className="text-[10px] text-muted-foreground">
              {isLocked
                ? hasStored ? 'Cached audio will be passed downstream — no API call' : 'Run once to generate, then subsequent runs will skip'
                : 'Node will regenerate on every run'}
            </p>
          </div>
        </div>
        <button
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isLocked ? 'bg-amber-500' : 'bg-input'}`}
          onClick={() => onChange('locked', !isLocked)}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${isLocked ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {(hasPassed || isSkipped) && fullAudioUrl && (
        <>
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Icons.Music className="h-3.5 w-3.5 text-violet-600" />
              <span className="text-xs font-medium text-violet-800">Generated audio</span>
              <span className="ml-auto text-[10px] text-violet-500">{formatDuration(duration)}</span>
            </div>
            <audio controls className="w-full" style={{ height: 36 }}>
              <source src={fullAudioUrl} />
            </audio>
          </div>
          <Separator />
        </>
      )}

      <FieldGroup label="Service">
        <Select value={service} onValueChange={v => onChange('service', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="music"  className="text-xs">ElevenLabs Music — full score, up to 10 min</SelectItem>
            <SelectItem value="sfx"    className="text-xs">ElevenLabs Sound Effects — ambient textures, up to 30s</SelectItem>
            <SelectItem value="local"  className="text-xs">Local MusicGen — free, runs on your machine</SelectItem>
          </SelectContent>
        </Select>
        {service === 'local' ? (
          <div className="mt-1 rounded-md border border-amber-200 bg-amber-950/10 px-2 py-1.5 text-[10px] text-amber-700 space-y-0.5">
            <p className="font-medium">Local MusicGen setup</p>
            <p>1. <code className="font-mono">pip install transformers torch scipy numpy fastapi uvicorn</code></p>
            <p>2. <code className="font-mono">python scripts/musicgen_server.py</code></p>
            <p className="text-[9px] text-muted-foreground mt-0.5">First run downloads ~1.5 GB. CPU: ~2 min per 10s. Apple Silicon: set <code className="font-mono">MUSICGEN_DEVICE=mps</code> for ~5× speedup.</p>
          </div>
        ) : (
          <p className="mt-0.5 text-[9px] text-muted-foreground/60">
            Requires <code className="font-mono">ELEVENLABS_API_KEY</code> in worker .env.
          </p>
        )}
      </FieldGroup>

      <FieldGroup label="Duration">
        <Select value={String(duration)} onValueChange={v => onChange('duration_seconds', Number(v))}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {durations.map(d => (
              <SelectItem key={d} value={String(d)} className="text-xs">{formatDuration(d)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {service === 'music' && (
          <p className="mt-0.5 text-[9px] text-muted-foreground/60">
            ElevenLabs Music supports 3s–10min. Longer tracks cost more credits.
          </p>
        )}
      </FieldGroup>

      <FieldGroup label="Prompt">
        <textarea
          className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-400"
          rows={4}
          placeholder={service === 'music'
            ? 'e.g. Calm cinematic piano score, slow tempo, hopeful and warm, no drums, subtle strings'
            : 'e.g. Gentle rain on leaves, distant thunder, soft café background noise'}
          value={prompt}
          onChange={e => onChange('prompt', e.target.value)}
        />
        <p className="mt-0.5 text-[9px] text-muted-foreground/60">
          Or connect a Text Input node upstream to generate the prompt dynamically.
        </p>
      </FieldGroup>

      {service === 'music' && (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <p className="text-xs font-medium">Instrumental only</p>
            <p className="text-[10px] text-muted-foreground">No vocals in the generated track</p>
          </div>
          <button
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${forceInstrumental ? 'bg-violet-500' : 'bg-input'}`}
            onClick={() => onChange('force_instrumental', !forceInstrumental)}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${forceInstrumental ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      )}

      {service === 'sfx' && (
        <FieldGroup label={`Prompt influence — ${promptInfluence.toFixed(2)}`}>
          <input type="range" min={0} max={1} step={0.05} value={promptInfluence}
            onChange={e => onChange('prompt_influence', parseFloat(e.target.value))}
            className="w-full accent-violet-500" />
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
            <span>0 — creative</span>
            <span>1.0 — strict</span>
          </div>
        </FieldGroup>
      )}
    </div>
  )
}
