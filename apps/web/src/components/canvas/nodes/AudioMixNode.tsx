import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { assetUrl, downloadAsset } from '@/lib/api'
import { EditableLabel } from './EditableLabel'

// ─── Colors ───────────────────────────────────────────────────────────────────

const ACCENT      = '#7c3aed' // media violet
const ACCENT_RING = 'rgba(124,58,237,0.12)'
const HEADER_BG   = '#faf5ff'
const HEADER_BD   = '#e9d5ff'
const BADGE_BG    = '#f3e8ff'
const BADGE_TEXT  = '#6b21a8'

const selectCss: React.CSSProperties = {
  borderColor:     HEADER_BD,
  color:           '#27500a',
  backgroundColor: HEADER_BG,
  cursor:          'pointer',
  outline:         'none',
}

function formatDuration(s: number) {
  if (!s) return ''
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60 > 0 ? `${s % 60}s` : ''}` : `${s}s`
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

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
      setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.3 + Math.abs(Math.sin(i * 0.6)) * 0.5))
      return
    }
    const ctx = new AudioCtx()
    fetch(url, { mode: 'cors' })
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(audioBuffer => {
        if (cancelled) return
        const data = audioBuffer.getChannelData(0)
        const step = Math.floor(data.length / NUM_BARS)
        const samples: number[] = []
        for (let i = 0; i < NUM_BARS; i++) {
          let sum = 0
          for (let j = 0; j < step; j++) sum += Math.abs(data[i * step + j] ?? 0)
          samples.push(sum / step)
        }
        const max = Math.max(...samples, 0.001)
        setBars(samples.map(s => s / max))
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.3 + Math.abs(Math.sin(i * 0.4 + 0.5)) * 0.5))
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
            <div key={i} className="flex-1 rounded-sm animate-pulse"
              style={{ height: `${28 + Math.sin(i * 0.6) * 18}%`, backgroundColor: ACCENT + '38', animationDelay: `${(i % 10) * 60}ms` }} />
          ))
        : bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-sm transition-colors duration-200"
              style={{ height: `${Math.max(h * 100, 5)}%`, backgroundColor: isPlaying ? ACCENT : ACCENT + '77' }} />
          ))
      }
    </div>
  )
}

// ─── Main node ────────────────────────────────────────────────────────────────

export const AudioMixNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses   = useWorkflowStore(s => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)

  const status    = nodeStatuses[id]?.status ?? 'idle'
  const config    = (data.config as Record<string, unknown>) ?? {}
  const runOutput = nodeStatuses[id]?.output as Record<string, unknown> | undefined

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  const voiceVolume  = (config.voice_volume as number) ?? 1.0
  const musicVolume  = (config.music_volume as number) ?? 0.25
  const duckEnabled  = (config.duck_enabled as boolean) ?? true
  const loopMusic    = (config.loop_music as boolean) ?? true
  const voiceDelay   = (config.voice_delay_seconds as number) ?? 0
  const musicDelay   = (config.music_delay_seconds as number) ?? 0

  const audioLocalPath = runOutput?.localPath as string | undefined
  const durationSec    = runOutput?.duration_seconds as number | undefined
  const fullAudioUrl   = audioLocalPath ? assetUrl(audioLocalPath) : null

  const audioRef   = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  useEffect(() => { setIsPlaying(false) }, [fullAudioUrl])

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) { audio.pause() }
    else { audio.play().catch(err => console.error('[AudioMixNode] play failed:', err)) }
  }, [isPlaying])


  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${ACCENT}`, boxShadow: `0 0 0 3px ${ACCENT_RING}, 0 0 24px 6px ${ACCENT_RING}, 0 8px 32px rgba(0,0,0,0.18)`,
  } : isRunning ? {
    border: `1.5px solid ${ACCENT}`, boxShadow: `0 0 20px 4px ${ACCENT_RING}`,
  } : isPassed ? { border: `1.5px solid ${ACCENT}` }
    : isFailed  ? { border: '1.5px solid #ef4444' }
    : { border: '1px solid #e0deda' }

  return (
    <div className="relative rounded-md bg-white transition-all" style={{ ...cardStyle, width: 380 }}>
      {/* Input handles */}
      <Handle type="target" position={Position.Left} id="voice" style={{ top: '35%' }} title="Voice audio" />
      <Handle type="target" position={Position.Left} id="music" style={{ top: '65%' }} title="Music / ambience audio" />
      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="mixed" style={{ top: '50%' }} title="Mixed audio" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={{ backgroundColor: selected ? ACCENT : HEADER_BG, borderBottomColor: selected ? ACCENT : HEADER_BD }}>
        <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : ACCENT }} />
        <EditableLabel value={data.label as string} onSave={v => updateNodeData(id, { label: v })} color={selected ? '#fff' : '#27500a'} />
        <span className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : BADGE_BG, color: selected ? '#fff' : BADGE_TEXT }}>
          MIX
        </span>
        {isRunning && <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: ACCENT }} />}
        {isPassed  && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />}
        {isFailed  && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      {/* Body */}
      <div className="px-2.5 py-2 space-y-2">
        {/* Input labels */}
        <div className="space-y-[3px] text-[9px]" style={{ color: '#94a3b8' }}>
          <div className="flex items-center gap-1">
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '88' }} />
            <span>Voice</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '55' }} />
            <span>Music</span>
          </div>
        </div>

        {/* Mix stats + controls */}
        <div className="rounded-md border px-2 py-1.5 space-y-1.5" style={{ backgroundColor: HEADER_BG + 'cc', borderColor: HEADER_BD }}>
          <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: ACCENT + 'aa' }}>Mix</div>
          {/* Voice volume */}
          <div className="flex items-center gap-2">
            <Icons.Mic className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#27500a', width: 30 }}>
              {Math.round(voiceVolume * 100)}%
            </span>
            <input type="range" min={0} max={2} step={0.05} value={voiceVolume}
              className="nodrag nopan flex-1"
              style={{ accentColor: ACCENT }}
              onChange={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, voice_volume: parseFloat(e.target.value) } }) }}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
            <span className="text-[9px] shrink-0" style={{ color: '#9ca3af', width: 20 }}>vol</span>
          </div>
          {/* Music volume */}
          <div className="flex items-center gap-2">
            <Icons.Music className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#27500a', width: 30 }}>
              {Math.round(musicVolume * 100)}%
            </span>
            <input type="range" min={0} max={1} step={0.05} value={musicVolume}
              className="nodrag nopan flex-1"
              style={{ accentColor: ACCENT }}
              onChange={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, music_volume: parseFloat(e.target.value) } }) }}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
            <span className="text-[9px] shrink-0" style={{ color: '#9ca3af', width: 20 }}>vol</span>
          </div>
          {/* Loop + Duck toggles */}
          <div className="flex items-center gap-3">
            <button className="nodrag flex items-center gap-1 text-left"
              onClick={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, loop_music: !loopMusic } }) }}>
              <Icons.Repeat className="h-2.5 w-2.5 shrink-0" style={{ color: loopMusic ? ACCENT : '#9ca3af' }} />
              <span className="text-[10px]" style={{ color: '#27500a' }}>Loop</span>
              <div className="ml-1 relative inline-flex h-3.5 w-6 shrink-0 rounded-full border border-transparent transition-colors"
                style={{ backgroundColor: loopMusic ? ACCENT : '#d1d5db' }}>
                <span className="pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform mt-px"
                  style={{ transform: loopMusic ? 'translateX(10px)' : 'translateX(1px)' }} />
              </div>
            </button>
            <button className="nodrag flex items-center gap-1 text-left"
              onClick={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, duck_enabled: !duckEnabled } }) }}>
              <Icons.ChevronsDown className="h-2.5 w-2.5 shrink-0" style={{ color: duckEnabled ? ACCENT : '#9ca3af' }} />
              <span className="text-[10px]" style={{ color: '#27500a' }}>Auto-duck</span>
              <div className="ml-1 relative inline-flex h-3.5 w-6 shrink-0 rounded-full border border-transparent transition-colors"
                style={{ backgroundColor: duckEnabled ? ACCENT : '#d1d5db' }}>
                <span className="pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform mt-px"
                  style={{ transform: duckEnabled ? 'translateX(10px)' : 'translateX(1px)' }} />
              </div>
            </button>
          </div>
        </div>

        {/* Track timing */}
        <div className="rounded-md border px-2 py-1.5 space-y-1.5" style={{ backgroundColor: HEADER_BG + 'cc', borderColor: HEADER_BD }}>
          <div className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: ACCENT + 'aa' }}>Timing</div>
          {/* Voice delay */}
          <div className="flex items-center gap-2">
            <Icons.Mic className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#27500a', width: 30 }}>
              {voiceDelay > 0 ? `+${voiceDelay}s` : '0s'}
            </span>
            <input type="range" min={0} max={10} step={0.5} value={voiceDelay}
              className="nodrag nopan flex-1"
              style={{ accentColor: ACCENT }}
              onChange={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, voice_delay_seconds: parseFloat(e.target.value) } }) }}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
            <span className="text-[9px] shrink-0" style={{ color: '#9ca3af', width: 20 }}>voc</span>
          </div>
          {/* Music delay */}
          <div className="flex items-center gap-2">
            <Icons.Music className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#27500a', width: 30 }}>
              {musicDelay > 0 ? `+${musicDelay}s` : '0s'}
            </span>
            <input type="range" min={0} max={10} step={0.5} value={musicDelay}
              className="nodrag nopan flex-1"
              style={{ accentColor: ACCENT }}
              onChange={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, music_delay_seconds: parseFloat(e.target.value) } }) }}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
            <span className="text-[9px] shrink-0" style={{ color: '#9ca3af', width: 20 }}>mus</span>
          </div>
        </div>

        {/* Waveform / state */}
        {isPassed && fullAudioUrl ? (
          <div className="rounded-md border px-2 pt-1.5 pb-1" style={{ backgroundColor: HEADER_BG + '88', borderColor: HEADER_BD }}>
            <audio ref={audioRef} src={fullAudioUrl} onEnded={() => setIsPlaying(false)} onPause={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} preload="auto" />
            <Waveform url={fullAudioUrl} isPlaying={isPlaying} />
            <div className="mt-1 flex items-center gap-1.5">
              <button className="nodrag flex items-center justify-center rounded-full border bg-white hover:opacity-80 transition-opacity shrink-0"
                style={{ width: 22, height: 22, color: ACCENT, borderColor: HEADER_BD }} onClick={togglePlay}>
                {isPlaying ? <Icons.Pause className="h-2.5 w-2.5" /> : <Icons.Play className="h-2.5 w-2.5" />}
              </button>
              {durationSec != null && durationSec > 0 && (
                <span className="text-[9px] tabular-nums font-medium" style={{ color: ACCENT }}>
                  {formatDuration(durationSec)}
                </span>
              )}
              <button className="nodrag ml-auto flex items-center justify-center rounded border bg-white p-1 hover:opacity-80"
                style={{ borderColor: HEADER_BD, color: ACCENT }} onClick={e => { e.stopPropagation(); downloadAsset(fullAudioUrl!, 'mix.mp3') }}>
                <Icons.Download className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        ) : isRunning ? (
          <div className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[10px] animate-pulse"
            style={{ backgroundColor: ACCENT + '10', color: ACCENT }}>
            <Icons.Layers className="h-3 w-3" /> Mixing audio…
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2"
            style={{ backgroundColor: HEADER_BG, color: '#3b6d11' }}>
            <Icons.Layers className="h-4 w-4" style={{ color: ACCENT + '55' }} />
            <span className="text-[10px]">mixed waveform appears after run</span>
          </div>
        )}

        {/* Output label */}
        <div className="flex justify-end text-[9px]" style={{ color: '#94a3b8' }}>
          <div className="flex items-center gap-1">
            <span>Mixed Audio</span>
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '66' }} />
          </div>
        </div>
      </div>
    </div>
  )
})
AudioMixNode.displayName = 'AudioMixNode'
