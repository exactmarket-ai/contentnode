import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { assetUrl } from '@/lib/api'
import { EditableLabel } from './EditableLabel'

// ─── Color system ─────────────────────────────────────────────────────────────

const ACCENT      = '#7c3aed' // media violet
const ACCENT_RING = 'rgba(124,58,237,0.12)'
const HEADER_BG   = '#faf5ff'
const HEADER_BD   = '#e9d5ff'
const BADGE_BG    = '#f3e8ff'
const BADGE_TEXT  = '#6b21a8'

// ─── Provider / voice options ────────────────────────────────────────────────

const VOICES_OPENAI = [
  { value: 'alloy',   label: 'Alloy'   },
  { value: 'echo',    label: 'Echo'    },
  { value: 'fable',   label: 'Fable'   },
  { value: 'onyx',    label: 'Onyx'    },
  { value: 'nova',    label: 'Nova'    },
  { value: 'shimmer', label: 'Shimmer' },
]

const VOICES_ELEVENLABS = [
  { value: 'rachel',    label: 'Rachel (F)'    },
  { value: 'sarah',     label: 'Sarah (F)'     },
  { value: 'emily',     label: 'Emily (F)'     },
  { value: 'charlotte', label: 'Charlotte (F)' },
  { value: 'matilda',   label: 'Matilda (F)'   },
  { value: 'dorothy',   label: 'Dorothy (F)'   },
  { value: 'adam',      label: 'Adam (M)'      },
  { value: 'daniel',    label: 'Daniel (M)'    },
  { value: 'josh',      label: 'Josh (M)'      },
  { value: 'harry',     label: 'Harry (M)'     },
  { value: 'liam',      label: 'Liam (M)'      },
  { value: 'ethan',     label: 'Ethan (M)'     },
]

const VOICES_LOCAL = [
  { value: 'af_heart',   label: 'Heart'    },
  { value: 'af_bella',   label: 'Bella'    },
  { value: 'af_aoede',   label: 'Aoede'    },
  { value: 'af_alloy',   label: 'Alloy'    },
  { value: 'af_jessica', label: 'Jessica'  },
  { value: 'af_kore',    label: 'Kore'     },
  { value: 'af_nicole',  label: 'Nicole'   },
  { value: 'af_nova',    label: 'Nova'     },
  { value: 'af_river',   label: 'River'    },
  { value: 'af_sarah',   label: 'Sarah'    },
  { value: 'af_sky',     label: 'Sky'      },
  { value: 'am_michael', label: 'Michael'  },
  { value: 'am_adam',    label: 'Adam'     },
  { value: 'am_echo',    label: 'Echo'     },
  { value: 'am_eric',    label: 'Eric'     },
  { value: 'am_fenrir',  label: 'Fenrir'   },
  { value: 'am_liam',    label: 'Liam'     },
  { value: 'am_onyx',    label: 'Onyx'     },
  { value: 'am_puck',    label: 'Puck'     },
  { value: 'am_santa',   label: 'Santa'    },
  { value: 'bf_alice',    label: 'Alice'   },
  { value: 'bf_emma',     label: 'Emma'    },
  { value: 'bf_isabella', label: 'Isabella'},
  { value: 'bf_lily',     label: 'Lily'    },
  { value: 'bm_lewis',   label: 'Lewis'    },
  { value: 'bm_daniel',  label: 'Daniel'   },
  { value: 'bm_fable',   label: 'Fable'    },
  { value: 'bm_george',  label: 'George'   },
]

const SPEEDS = [
  { value: 0.5,  label: '0.5×'  },
  { value: 0.75, label: '0.75×' },
  { value: 1.0,  label: '1.0×'  },
  { value: 1.25, label: '1.25×' },
  { value: 1.5,  label: '1.5×'  },
  { value: 2.0,  label: '2.0×'  },
]

const selectCss: React.CSSProperties = {
  borderColor:     HEADER_BD,
  color:           '#27500a',
  backgroundColor: HEADER_BG,
  cursor:          'pointer',
  outline:         'none',
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ─── Waveform component ───────────────────────────────────────────────────────

const NUM_BARS = 48

function Waveform({ url, isPlaying }: { url: string; isPlaying: boolean }) {
  const [bars, setBars] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBars([])

    const AudioCtx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      setLoading(false)
      setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.55)) * 0.55))
      return
    }

    const ctx = new AudioCtx()
    fetch(url, { mode: 'cors' })
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audioBuffer) => {
        if (cancelled) return
        const channelData = audioBuffer.getChannelData(0)
        const step = Math.floor(channelData.length / NUM_BARS)
        const samples: number[] = []
        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0
          for (let j = 0; j < step; j++) sum += Math.abs(channelData[i * step + j] ?? 0)
          samples.push(sum / step)
        }
        const max = Math.max(...samples, 0.001)
        setBars(samples.map((s) => s / max))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.2 + Math.abs(Math.sin(i * 0.45 + 0.3)) * 0.6))
          setLoading(false)
        }
      })
      .finally(() => ctx.close().catch(() => {}))

    return () => { cancelled = true }
  }, [url])

  return (
    <div className="flex items-end" style={{ height: 28, gap: 1 }}>
      {loading
        ? Array.from({ length: NUM_BARS }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm animate-pulse"
              style={{
                height:          `${28 + Math.sin(i * 0.7) * 18}%`,
                backgroundColor: ACCENT + '38',
                animationDelay:  `${(i % 10) * 60}ms`,
              }}
            />
          ))
        : bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm transition-colors duration-200"
              style={{
                height:          `${Math.max(h * 100, 5)}%`,
                backgroundColor: isPlaying ? ACCENT : ACCENT + '80',
              }}
            />
          ))
      }
    </div>
  )
}

// ─── Main node ────────────────────────────────────────────────────────────────

export const VoiceOutputNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses   = useWorkflowStore((s) => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const status    = nodeStatuses[id]?.status ?? 'idle'
  const config    = (data.config as Record<string, unknown>) ?? {}
  const runOutput = nodeStatuses[id]?.output as Record<string, unknown> | undefined

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'
  const isSkipped = status === 'skipped'
  const isLocked  = (config.locked as boolean) ?? false

  const provider  = (config.provider as string) ?? 'openai'
  const voice     = (config.voice as string) ?? 'nova'
  const speed     = (config.speed as number) ?? 1.0
  const model     = (config.model as string) ?? 'tts-1'
  const direction = (config.direction as string) ?? ''

  const voiceOptions =
    provider === 'elevenlabs' ? VOICES_ELEVENLABS
    : provider === 'local'   ? VOICES_LOCAL
    : VOICES_OPENAI

  const audioLocalPath  = runOutput?.localPath as string | undefined
  const transcript      = runOutput?.transcript as string | undefined
  const durationSec     = runOutput?.duration_estimate_seconds as number | undefined
  const wordCount       = runOutput?.word_count as number | undefined

  const fullAudioUrl = audioLocalPath ? assetUrl(audioLocalPath) : null

  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const directionRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = directionRef.current
    if (!el) return
    const handler = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Reset playing state when audio URL changes (new run)
  useEffect(() => { setIsPlaying(false) }, [fullAudioUrl])

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      audio.play().catch((err) => console.error('[VoiceOutputNode] play failed:', err))
    }
  }, [isPlaying])

  const set = (key: string, value: unknown) =>
    updateNodeData(id, { config: { ...config, [key]: value } })

  // ── Card border/shadow ──
  const cardStyle: React.CSSProperties = selected ? {
    border:    `2px solid ${ACCENT}`,
    boxShadow: `0 0 0 3px ${ACCENT_RING}, 0 0 24px 6px ${ACCENT_RING}, 0 8px 32px rgba(0,0,0,0.18)`,
  } : isRunning ? {
    border:    `1.5px solid ${ACCENT}`,
    boxShadow: `0 0 20px 4px ${ACCENT_RING}`,
  } : isPassed ? {
    border: `1.5px solid ${ACCENT}`,
  } : isFailed ? {
    border: '1.5px solid #ef4444',
  } : {
    border: '1px solid #e0deda',
  }

  const headerBg  = selected ? ACCENT : HEADER_BG
  const headerBd  = selected ? ACCENT : HEADER_BD
  const titleClr  = selected ? '#ffffff' : '#27500a'

  return (
    <div
      className="relative rounded-md bg-white transition-all"
      style={{ ...cardStyle, width: 380 }}
    >
      {/* ── Input handles ─────────────────────────────────────────────────── */}
      <Handle type="target" position={Position.Left} id="script"
        style={{ top: '30%' }} title="Script — text to speak" />
      <Handle type="target" position={Position.Left} id="sfx"
        style={{ top: '50%' }} title="SFX Notes — sound effect direction" />
      <Handle type="target" position={Position.Left} id="score"
        style={{ top: '70%' }} title="Score — music / ambient notes" />

      {/* ── Output handles ────────────────────────────────────────────────── */}
      <Handle type="source" position={Position.Right} id="audio"
        style={{ top: '38%' }} title="Audio file URL" />
      <Handle type="source" position={Position.Right} id="transcript"
        style={{ top: '62%' }} title="Transcript text" />

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={{ backgroundColor: headerBg, borderBottomColor: headerBd }}
      >
        <div
          className="shrink-0"
          style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : ACCENT }}
        />
        <EditableLabel
          value={data.label as string}
          onSave={(v) => updateNodeData(id, { label: v })}
          color={titleClr}
        />
        <span
          className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : BADGE_BG, color: selected ? '#fff' : BADGE_TEXT }}
        >
          AUDIO
        </span>
        {isRunning && <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: ACCENT }} />}
        {(isPassed && !isLocked) && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />}
        {(isSkipped || (isPassed && isLocked)) && <Icons.Lock className="ml-1 h-3.5 w-3.5 shrink-0 text-amber-400" />}
        {isFailed  && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
        <button
          className="nodrag ml-1 flex items-center gap-1 shrink-0"
          title={isLocked ? 'Unlock — node will regenerate on next run' : 'Skip — reuse cached audio on next run'}
          onClick={(e) => { e.stopPropagation(); set('locked', !isLocked) }}
        >
          <div className="relative inline-flex h-3.5 w-6 shrink-0 rounded-full border border-transparent transition-colors"
            style={{ backgroundColor: isLocked ? '#f59e0b' : '#d1d5db' }}>
            <span className="pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform mt-px"
              style={{ transform: isLocked ? 'translateX(10px)' : 'translateX(1px)' }} />
          </div>
          <span className="text-[9px]" style={{ color: isLocked ? '#f59e0b' : '#9ca3af' }}>Skip</span>
        </button>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="px-2.5 py-2 space-y-2">

        {/* Input port labels */}
        <div className="space-y-[3px] text-[9px]" style={{ color: '#94a3b8' }}>
          {[
            { label: 'Script',    opacity: '66' },
            { label: 'SFX Notes', opacity: '44' },
            { label: 'Score',     opacity: '33' },
          ].map(({ label, opacity }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + opacity }} />
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* ── Inline controls ── */}
        <div
          className="rounded-md border px-2 py-1.5 space-y-1.5"
          style={{ backgroundColor: HEADER_BG + 'cc', borderColor: HEADER_BD }}
        >
          {/* Row 1: provider · voice · speed · model */}
          <div className="flex items-center gap-1 flex-wrap">
            <select
              className="nodrag nopan h-6 rounded border text-[10px] font-medium px-1"
              style={{ ...selectCss, width: 70 }}
              value={provider}
              onChange={(e) => { e.stopPropagation(); set('provider', e.target.value) }}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="openai">OpenAI</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="local">Local</option>
            </select>

            <select
              className="nodrag nopan h-6 rounded border text-[10px] font-medium px-1"
              style={{ ...selectCss, width: 96 }}
              value={voice}
              onChange={(e) => { e.stopPropagation(); set('voice', e.target.value) }}
              onClick={(e) => e.stopPropagation()}
            >
              {voiceOptions.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>

            <select
              className="nodrag nopan h-6 rounded border text-[10px] font-medium px-1"
              style={{ ...selectCss, width: 58 }}
              value={speed}
              onChange={(e) => { e.stopPropagation(); set('speed', parseFloat(e.target.value)) }}
              onClick={(e) => e.stopPropagation()}
            >
              {SPEEDS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            {provider === 'openai' && (
              <select
                className="nodrag nopan h-6 rounded border text-[9px] font-medium px-1"
                style={{ ...selectCss, width: 46 }}
                value={model}
                onChange={(e) => { e.stopPropagation(); set('model', e.target.value) }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="tts-1">Std</option>
                <option value="tts-1-hd">HD</option>
              </select>
            )}
          </div>

          {/* Row 2: voice direction textarea */}
          <textarea
            ref={directionRef}
            className="nodrag nopan w-full resize-none rounded border bg-white px-1.5 py-1 text-[10px] leading-[1.4] placeholder:text-slate-300 focus:outline-none"
            style={{ color: '#27500a', borderColor: HEADER_BD }}
            rows={2}
            placeholder="Voice direction — e.g. warm, measured pace, pause before key phrases…"
            value={direction}
            onChange={(e) => { e.stopPropagation(); set('direction', e.target.value) }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>

        {/* ── Waveform / player / placeholder ── */}
        {isPassed && fullAudioUrl ? (
          <div
            className="rounded-md border px-2 pt-1.5 pb-1"
            style={{ backgroundColor: HEADER_BG + '88', borderColor: HEADER_BD }}
          >
            {/* Hidden audio element — controlled via ref */}
            <audio
              ref={audioRef}
              src={fullAudioUrl}
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              preload="auto"
            />
            <Waveform url={fullAudioUrl} isPlaying={isPlaying} />
            <div className="mt-1 flex items-center gap-1.5">
              <button
                className="nodrag flex items-center justify-center rounded-full border bg-white hover:opacity-80 transition-opacity shrink-0"
                style={{ width: 22, height: 22, color: ACCENT, borderColor: HEADER_BD }}
                onClick={togglePlay}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying
                  ? <Icons.Pause className="h-2.5 w-2.5" />
                  : <Icons.Play  className="h-2.5 w-2.5" />
                }
              </button>

              {durationSec != null && (
                <span className="text-[9px] tabular-nums font-medium" style={{ color: ACCENT }}>
                  ~{formatDuration(durationSec)}
                </span>
              )}
              {wordCount != null && (
                <span className="text-[9px]" style={{ color: '#94a3b8' }}>{wordCount.toLocaleString()} words</span>
              )}

              <a
                className="nodrag ml-auto flex items-center justify-center rounded border bg-white p-1 hover:opacity-80 transition-opacity"
                style={{ borderColor: HEADER_BD, color: ACCENT }}
                href={fullAudioUrl}
                download
                onClick={(e) => e.stopPropagation()}
                title="Download audio"
              >
                <Icons.Download className="h-2.5 w-2.5" />
              </a>
            </div>
          </div>
        ) : isRunning ? (
          <div
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[10px] animate-pulse"
            style={{ backgroundColor: ACCENT + '10', color: ACCENT }}
          >
            <Icons.Mic className="h-3 w-3" />
            Generating audio…
          </div>
        ) : (
          <div
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2"
            style={{ backgroundColor: HEADER_BG, color: '#94a3b8' }}
          >
            <Icons.AudioWaveform className="h-4 w-4" style={{ color: ACCENT + '55' }} />
            <span className="text-[10px]">waveform appears after run</span>
          </div>
        )}

        {/* Output port labels */}
        <div className="flex flex-col items-end gap-[3px] text-[9px]" style={{ color: '#94a3b8' }}>
          {[
            { label: 'Audio',      opacity: '66' },
            { label: 'Transcript', opacity: '44' },
          ].map(({ label, opacity }) => (
            <div key={label} className="flex items-center gap-1">
              <span>{label}</span>
              <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + opacity }} />
            </div>
          ))}
        </div>

      </div>
    </div>
  )
})
VoiceOutputNode.displayName = 'VoiceOutputNode'
