import { useState, useRef, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { FieldGroup } from '../shared'
import { assetUrl } from '@/lib/api'

// ─── Metadata ────────────────────────────────────────────────────────────────

const VOICES_OPENAI = [
  { value: 'echo',    label: 'Echo — calm, professional' },
  { value: 'shimmer', label: 'Shimmer — soft, gentle' },
  { value: 'alloy',   label: 'Alloy — neutral, versatile' },
  { value: 'ash',     label: 'Ash — warm, natural' },
  { value: 'ballad',  label: 'Ballad — expressive, narrative' },
  { value: 'coral',   label: 'Coral — bright, conversational' },
  { value: 'sage',    label: 'Sage — composed, thoughtful' },
  { value: 'verse',   label: 'Verse — dynamic, clear' },
  { value: 'marin',   label: 'Marin — smooth, confident' },
  { value: 'cedar',   label: 'Cedar — deep, grounded' },
]

const VOICES_ELEVENLABS = [
  { value: 'rachel',    label: 'Rachel — warm, versatile (F)' },
  { value: 'sarah',     label: 'Sarah — soft, young (F)' },
  { value: 'emily',     label: 'Emily — calm, natural (F)' },
  { value: 'charlotte', label: 'Charlotte — warm, British (F)' },
  { value: 'matilda',   label: 'Matilda — natural, friendly (F)' },
  { value: 'dorothy',   label: 'Dorothy — pleasant, British (F)' },
  { value: 'adam',      label: 'Adam — deep, confident (M)' },
  { value: 'daniel',    label: 'Daniel — authoritative, British (M)' },
  { value: 'josh',      label: 'Josh — young, dynamic (M)' },
  { value: 'harry',     label: 'Harry — warm, grounded (M)' },
  { value: 'liam',      label: 'Liam — energetic, clear (M)' },
  { value: 'ethan',     label: 'Ethan — conversational (M)' },
]

const VOICES_LOCAL = [
  // American Female
  { value: 'af_heart',   label: 'Heart — warm, expressive (AF)' },
  { value: 'af_bella',   label: 'Bella — smooth, natural (AF)' },
  { value: 'af_aoede',   label: 'Aoede — clear, neutral (AF)' },
  { value: 'af_alloy',   label: 'Alloy — versatile, confident (AF)' },
  { value: 'af_jessica', label: 'Jessica — bright, conversational (AF)' },
  { value: 'af_kore',    label: 'Kore — composed, steady (AF)' },
  { value: 'af_nicole',  label: 'Nicole — gentle, warm (AF)' },
  { value: 'af_nova',    label: 'Nova — energetic, clear (AF)' },
  { value: 'af_river',   label: 'River — calm, measured (AF)' },
  { value: 'af_sarah',   label: 'Sarah — soft, young (AF)' },
  { value: 'af_sky',     label: 'Sky — airy, light (AF)' },
  // American Male
  { value: 'am_michael', label: 'Michael — deep, professional (AM)' },
  { value: 'am_adam',    label: 'Adam — authoritative (AM)' },
  { value: 'am_echo',    label: 'Echo — calm, steady (AM)' },
  { value: 'am_eric',    label: 'Eric — clear, neutral (AM)' },
  { value: 'am_fenrir',  label: 'Fenrir — bold, resonant (AM)' },
  { value: 'am_liam',    label: 'Liam — energetic, young (AM)' },
  { value: 'am_onyx',    label: 'Onyx — deep, rich (AM)' },
  { value: 'am_puck',    label: 'Puck — expressive, dynamic (AM)' },
  { value: 'am_santa',   label: 'Santa — warm, jolly (AM)' },
  // British Female
  { value: 'bf_alice',    label: 'Alice — crisp, British (BF)' },
  { value: 'bf_emma',     label: 'Emma — warm, British (BF)' },
  { value: 'bf_isabella', label: 'Isabella — refined, British (BF)' },
  { value: 'bf_lily',     label: 'Lily — light, British (BF)' },
  // British Male
  { value: 'bm_lewis',  label: 'Lewis — grounded, British (BM)' },
  { value: 'bm_daniel', label: 'Daniel — authoritative, British (BM)' },
  { value: 'bm_fable',  label: 'Fable — storytelling, British (BM)' },
  { value: 'bm_george', label: 'George — steady, British (BM)' },
]

// ─── Starred voices (localStorage) ───────────────────────────────────────────

const STORAGE_KEY = 'contentnode:starred_voices'

function useStarredVoices(): [Set<string>, (voice: string) => void] {
  const [starred, setStarred] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })

  const toggle = (voice: string) => {
    setStarred(prev => {
      const next = new Set(prev)
      if (next.has(voice)) next.delete(voice)
      else next.add(voice)
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  return [starred, toggle]
}

// ─── Voice picker ─────────────────────────────────────────────────────────────

function VoicePicker({
  value,
  voices,
  onChange,
}: {
  value: string
  voices: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [starred, toggleStar] = useStarredVoices()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = voices.find(v => v.value === value)
  const starredVoices = voices.filter(v => starred.has(v.value))
  const otherVoices   = voices.filter(v => !starred.has(v.value))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2.5 text-xs shadow-sm hover:bg-accent focus:outline-none"
      >
        <span className="flex items-center gap-1.5 truncate">
          {current && starred.has(current.value) && (
            <Icons.Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
          )}
          <span className="truncate">{current?.label ?? value}</span>
        </span>
        <Icons.ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground ml-1" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-[200] mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-white shadow-xl">
          {starredVoices.length > 0 && (
            <>
              <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Starred
              </div>
              {starredVoices.map(v => (
                <VoiceRow key={v.value} voice={v} selected={value === v.value} starred={true}
                  onSelect={() => { onChange(v.value); setOpen(false) }}
                  onStar={(e) => { e.stopPropagation(); toggleStar(v.value) }} />
              ))}
              <div className="mx-2 my-1 border-t border-border" />
            </>
          )}
          {otherVoices.map(v => (
            <VoiceRow key={v.value} voice={v} selected={value === v.value} starred={false}
              onSelect={() => { onChange(v.value); setOpen(false) }}
              onStar={(e) => { e.stopPropagation(); toggleStar(v.value) }} />
          ))}
        </div>
      )}
    </div>
  )
}

function VoiceRow({
  voice, selected, starred, onSelect, onStar,
}: {
  voice: { value: string; label: string }
  selected: boolean
  starred: boolean
  onSelect: () => void
  onStar: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center justify-between px-2 py-1.5 text-xs hover:bg-gray-100 ${selected ? 'bg-gray-100 font-medium' : ''}`}
    >
      <span className="flex items-center gap-1.5 truncate">
        {selected && <Icons.Check className="h-3 w-3 shrink-0 text-primary" />}
        {!selected && <span className="w-3" />}
        <span className="truncate">{voice.label}</span>
      </span>
      <button
        type="button"
        onClick={onStar}
        className="ml-2 shrink-0 rounded p-0.5 hover:bg-background"
        title={starred ? 'Unstar' : 'Star this voice'}
      >
        <Icons.Star className={`h-3 w-3 ${starred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40 hover:text-amber-400'}`} />
      </button>
    </div>
  )
}

const ELEVENLABS_MODELS = [
  { value: 'eleven_flash_v2_5',      label: 'Flash v2.5 — ultra-fast, lowest latency' },
  { value: 'eleven_turbo_v2_5',      label: 'Turbo v2.5 — fast, high quality' },
  { value: 'eleven_turbo_v2',        label: 'Turbo v2 — fast, good quality' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 — best quality, slower' },
  { value: 'eleven_monolingual_v1',  label: 'Monolingual v1 — English only, stable' },
]

const FORMATS = [
  { value: 'mp3',  label: 'MP3 — universal, smallest file size' },
  { value: 'wav',  label: 'WAV — lossless, largest file size' },
  { value: 'opus', label: 'Opus — best quality-to-size for speech' },
]

const MERGE_MODES = [
  { value: 'concatenate', label: 'Concatenate — join all inputs as one script' },
  { value: 'script-only', label: 'Script only — use Script handle; others are context' },
]

// ─── Main config panel ───────────────────────────────────────────────────────

export function VoiceOutputConfig({
  config,
  onChange,
  nodeRunStatus,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  nodeRunStatus?: { status?: string; output?: unknown; error?: string }
}) {
  const provider      = (config.provider as string) ?? 'openai'
  const voice         = (config.voice as string) ?? 'echo'
  const model         = (config.model as string) ?? 'tts-1'
  const speed         = (config.speed as number) ?? 1.0
  const format        = (config.format as string) ?? 'mp3'
  const direction     = (config.direction as string) ?? ''
  const mergeMode     = (config.merge_mode as string) ?? 'concatenate'
  const enableSsml    = (config.enable_ssml as boolean) ?? false
  const elModel       = (config.elevenlabs_model as string) ?? 'eleven_turbo_v2_5'
  const stability     = (config.stability as number) ?? 0.5
  const similarity    = (config.similarity_boost as number) ?? 0.75
  const styleExag     = (config.style_exaggeration as number) ?? 0.0

  const voiceOptions =
    provider === 'elevenlabs' ? VOICES_ELEVENLABS
    : provider === 'local'   ? VOICES_LOCAL
    : VOICES_OPENAI

  const isLocked   = (config.locked as boolean) ?? false

  const runOutput  = nodeRunStatus?.output as Record<string, unknown> | undefined
  const isSkipped  = nodeRunStatus?.status === 'skipped'
  const hasPassed  = nodeRunStatus?.status === 'passed'
  const storedOut  = config.stored_output as Record<string, unknown> | undefined
  const activeOut  = runOutput ?? (isSkipped ? storedOut : undefined)
  const audioPath  = activeOut?.localPath as string | undefined
  const transcript = activeOut?.transcript as string | undefined
  const durationS  = activeOut?.duration_estimate_seconds as number | undefined
  const wordCount  = activeOut?.word_count as number | undefined
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

      {/* ── Post-run result ──────────────────────────────────────────────── */}
      {(hasPassed || isSkipped) && fullAudioUrl && (
        <>
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/50 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <Icons.AudioWaveform className="h-3.5 w-3.5 text-cyan-600" />
              <span className="text-xs font-medium text-cyan-800">Generated audio</span>
              {durationS != null && (
                <span className="ml-auto text-[10px] font-mono text-cyan-600">
                  ~{Math.floor(durationS / 60)}:{String(durationS % 60).padStart(2, '0')}
                </span>
              )}
              {wordCount != null && (
                <span className="text-[10px] text-cyan-500">{wordCount.toLocaleString()} words</span>
              )}
            </div>
            {/* Native audio player for config panel */}
            <audio controls className="w-full" style={{ height: 36 }}>
              <source src={fullAudioUrl} />
            </audio>
            {transcript && (
              <p className="text-[10px] leading-relaxed line-clamp-4 text-muted-foreground">
                {transcript}
              </p>
            )}
          </div>
          <Separator />
        </>
      )}

      {/* ── Provider ──────────────────────────────────────────────────────── */}
      <FieldGroup label="Provider">
        <Select value={provider} onValueChange={(v) => { onChange('provider', v); onChange('voice', v === 'elevenlabs' ? 'rachel' : v === 'local' ? 'af_heart' : 'echo') }}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="openai" className="text-xs">OpenAI TTS</SelectItem>
            <SelectItem value="elevenlabs" className="text-xs">ElevenLabs</SelectItem>
            <SelectItem value="local" className="text-xs">Local (kokoro-fastapi)</SelectItem>
          </SelectContent>
        </Select>
        {provider === 'local' && (
          <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
            Requires <code className="font-mono">TTS_BASE_URL</code> in worker .env (default: <code>http://localhost:8880</code>).
            <br />
            Run: <code className="font-mono text-[9px] break-all">docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest</code>
          </div>
        )}
        {provider === 'elevenlabs' && (
          <p className="mt-1 text-[9px] text-muted-foreground/60">
            Requires <code className="font-mono">ELEVENLABS_API_KEY</code> in worker .env.
          </p>
        )}
        {provider === 'openai' && (
          <p className="mt-1 text-[9px] text-muted-foreground/60">
            Uses <code className="font-mono">OPENAI_API_KEY</code> from worker .env.
          </p>
        )}
      </FieldGroup>

      {/* ── Voice ─────────────────────────────────────────────────────────── */}
      <FieldGroup label="Voice">
        <VoicePicker value={voice} voices={voiceOptions} onChange={(v) => onChange('voice', v)} />
        {provider === 'elevenlabs' && (
          <p className="mt-0.5 text-[9px] text-muted-foreground/60">
            Or paste a custom ElevenLabs voice ID directly into the node selector.
          </p>
        )}
      </FieldGroup>

      {/* ── Model (provider-specific) ────────────────────────────────────── */}
      {provider === 'openai' && (
        <FieldGroup label="Model quality">
          <Select value={model} onValueChange={(v) => onChange('model', v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tts-1"    className="text-xs">tts-1 — optimised for speed</SelectItem>
              <SelectItem value="tts-1-hd" className="text-xs">tts-1-hd — optimised for quality</SelectItem>
            </SelectContent>
          </Select>
        </FieldGroup>
      )}

      {provider === 'elevenlabs' && (
        <FieldGroup label="ElevenLabs model">
          <Select value={elModel} onValueChange={(v) => onChange('elevenlabs_model', v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ELEVENLABS_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>
      )}

      {/* ── Speed ─────────────────────────────────────────────────────────── */}
      <FieldGroup label={`Speed — ${speed}×`}>
        <input
          type="range" min="0.5" max="2.0" step="0.25"
          value={speed}
          onChange={(e) => onChange('speed', parseFloat(e.target.value))}
          className="w-full accent-cyan-500"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
          <span>0.5× slow</span>
          <span>1.0×</span>
          <span>2.0× fast</span>
        </div>
      </FieldGroup>

      {/* ── ElevenLabs voice tuning ──────────────────────────────────────── */}
      {provider === 'elevenlabs' && (
        <>
          <FieldGroup label={`Stability — ${stability.toFixed(2)}`}>
            <input
              type="range" min="0" max="1" step="0.05"
              value={stability}
              onChange={(e) => onChange('stability', parseFloat(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
              <span>0 — expressive</span>
              <span>1.0 — consistent</span>
            </div>
          </FieldGroup>

          <FieldGroup label={`Similarity boost — ${similarity.toFixed(2)}`}>
            <input
              type="range" min="0" max="1" step="0.05"
              value={similarity}
              onChange={(e) => onChange('similarity_boost', parseFloat(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
              <span>0 — creative</span>
              <span>1.0 — close to original</span>
            </div>
          </FieldGroup>

          <FieldGroup label={`Style exaggeration — ${styleExag.toFixed(2)}`}>
            <input
              type="range" min="0" max="1" step="0.05"
              value={styleExag}
              onChange={(e) => onChange('style_exaggeration', parseFloat(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-0.5">
              <span>0 — neutral</span>
              <span>1.0 — maximum style</span>
            </div>
          </FieldGroup>
        </>
      )}

      {/* ── Output format ─────────────────────────────────────────────────── */}
      <FieldGroup label="Output format">
        <Select value={format} onValueChange={(v) => onChange('format', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FORMATS.map((f) => (
              <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* ── Multi-input merge mode ────────────────────────────────────────── */}
      <FieldGroup label="Multiple inputs — merge mode">
        <Select value={mergeMode} onValueChange={(v) => onChange('merge_mode', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MERGE_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-0.5 text-[9px] text-muted-foreground/60">
          In "script only" mode, SFX Notes and Score inputs are shown in the direction field but not spoken.
        </p>
      </FieldGroup>

      {/* ── Voice direction ───────────────────────────────────────────────── */}
      <FieldGroup label="Voice direction / notes">
        <textarea
          className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs leading-relaxed placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-400"
          rows={3}
          placeholder="e.g. Warm, measured. Slight pause before key points. Conversational, not broadcast."
          value={direction}
          onChange={(e) => onChange('direction', e.target.value)}
        />
        <p className="mt-0.5 text-[9px] text-muted-foreground/60">
          Shown on the node card. Reminder of intent — does not affect TTS API output.
        </p>
      </FieldGroup>

      {/* ── SSML toggle ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-xs font-medium">SSML tags in script</p>
          <p className="text-[10px] text-muted-foreground">
            Strip &lt;break&gt;, &lt;emphasis&gt; tags before sending to TTS
          </p>
        </div>
        <button
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enableSsml ? 'bg-cyan-500' : 'bg-input'}`}
          onClick={() => onChange('enable_ssml', !enableSsml)}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${enableSsml ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

    </div>
  )
}
