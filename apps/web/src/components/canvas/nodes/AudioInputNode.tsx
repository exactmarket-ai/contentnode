import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { assetUrl, apiFetch } from '@/lib/api'
import { EditableLabel } from './EditableLabel'

// ─── Colors ───────────────────────────────────────────────────────────────────

const ACCENT      = '#185fa5' // input blue
const ACCENT_RING = 'rgba(24,95,165,0.12)'
const HEADER_BG   = '#f0f6fd'
const HEADER_BD   = '#b8d8f5'
const BADGE_BG    = '#e6f1fb'
const BADGE_TEXT  = '#0c447c'

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
      setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.55)) * 0.55))
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
          setBars(Array.from({ length: NUM_BARS }, (_, i) => 0.3 + Math.abs(Math.sin(i * 0.35 + 0.5)) * 0.5))
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
              style={{ height: `${25 + Math.sin(i * 0.5) * 20}%`, backgroundColor: ACCENT + '38', animationDelay: `${(i % 12) * 50}ms` }} />
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

interface StoredAudio {
  storageKey: string
  localPath:  string
  filename:   string
  sizeBytes:  number
}

export const AudioInputNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses   = useWorkflowStore(s => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)

  const status = nodeStatuses[id]?.status ?? 'idle'
  const config = (data.config as Record<string, unknown>) ?? {}

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  const storedAudio  = config.stored_audio as StoredAudio | undefined
  const fullAudioUrl = storedAudio?.localPath ? assetUrl(storedAudio.localPath) : null

  const audioRef   = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dropping,  setDropping]  = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setIsPlaying(false) }, [fullAudioUrl])

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) { audio.pause() }
    else { audio.play().catch(err => console.error('[AudioInputNode] play failed:', err)) }
  }, [isPlaying])

  const uploadFile = useCallback(async (file: File) => {
    const allowed = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'audio/flac', 'audio/x-flac'])
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const allowedExt = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac'])
    if (!allowed.has(file.type) && !allowedExt.has(ext)) {
      alert(`Unsupported file type. Please upload an MP3, WAV, M4A, OGG, or FLAC file.`)
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await apiFetch('/api/v1/documents', { method: 'POST', body: form })
      const json = await res.json() as { data: { id: string; filename: string; storageKey: string; sizeBytes: number } }
      const { storageKey, filename, sizeBytes } = json.data
      const localPath = `/files/doc/${storageKey}`
      updateNodeData(id, {
        config: {
          ...config,
          stored_audio: { storageKey, localPath, filename, sizeBytes },
        },
      })
    } catch (err) {
      console.error('[AudioInputNode] upload failed', err)
    } finally {
      setUploading(false)
    }
  }, [config, id, updateNodeData])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    e.target.value = ''
  }, [uploadFile])

  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${ACCENT}`, boxShadow: `0 0 0 3px ${ACCENT_RING}, 0 0 24px 6px ${ACCENT_RING}, 0 8px 32px rgba(0,0,0,0.18)`,
  } : isRunning ? {
    border: `1.5px solid ${ACCENT}`, boxShadow: `0 0 20px 4px ${ACCENT_RING}`,
  } : isPassed ? { border: `1.5px solid ${ACCENT}` }
    : isFailed  ? { border: '1.5px solid #ef4444' }
    : { border: '1px solid #e0deda' }

  return (
    <div className="relative rounded-md bg-white transition-all" style={{ ...cardStyle, width: 340 }}>
      <Handle type="source" position={Position.Right} id="audio" style={{ top: '50%' }} title="Audio output" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={{ backgroundColor: selected ? ACCENT : HEADER_BG, borderBottomColor: selected ? ACCENT : HEADER_BD }}>
        <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : ACCENT }} />
        <EditableLabel value={data.label as string} onSave={v => updateNodeData(id, { label: v })} color={selected ? '#e6f1fb' : '#0c447c'} />
        <span className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : BADGE_BG, color: selected ? '#fff' : BADGE_TEXT }}>
          AUDIO IN
        </span>
        {isRunning && <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: ACCENT }} />}
        {isPassed  && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />}
        {isFailed  && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      {/* Body */}
      <div className="px-2.5 py-2 space-y-2">
        {fullAudioUrl && storedAudio ? (
          /* Audio loaded */
          <div className="rounded-md border px-2 pt-1.5 pb-1" style={{ backgroundColor: HEADER_BG + '88', borderColor: HEADER_BD }}>
            <audio ref={audioRef} src={fullAudioUrl} onEnded={() => setIsPlaying(false)} onPause={() => setIsPlaying(false)} onPlay={() => setIsPlaying(true)} preload="auto" />
            <Waveform url={fullAudioUrl} isPlaying={isPlaying} />
            <div className="mt-1 flex items-center gap-1.5">
              <button className="nodrag flex items-center justify-center rounded-full border bg-white hover:opacity-80 transition-opacity shrink-0"
                style={{ width: 22, height: 22, color: ACCENT, borderColor: HEADER_BD }} onClick={togglePlay}>
                {isPlaying ? <Icons.Pause className="h-2.5 w-2.5" /> : <Icons.Play className="h-2.5 w-2.5" />}
              </button>
              <span className="text-[9px] truncate font-medium flex-1 min-w-0" style={{ color: '#0c447c' }} title={storedAudio.filename}>
                {storedAudio.filename}
              </span>
              <button className="nodrag shrink-0 text-[9px] px-1.5 rounded hover:opacity-70"
                style={{ color: '#6b7280' }}
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
                title="Replace file">
                replace
              </button>
            </div>
          </div>
        ) : uploading ? (
          /* Uploading */
          <div className="flex items-center justify-center gap-1.5 rounded-md px-2 py-3 text-[10px] animate-pulse"
            style={{ backgroundColor: ACCENT + '10', color: ACCENT }}>
            <Icons.Upload className="h-3 w-3" /> Uploading…
          </div>
        ) : (
          /* Drop zone */
          <div
            className="nodrag nopan flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-2 py-3 cursor-pointer transition-colors"
            style={{
              borderColor: dropping ? ACCENT : HEADER_BD,
              backgroundColor: dropping ? ACCENT + '10' : HEADER_BG,
            }}
            onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropping(true) }}
            onDragLeave={e => { e.stopPropagation(); setDropping(false) }}
            onDrop={handleDrop}
          >
            <Icons.Upload className="h-4 w-4" style={{ color: ACCENT + '88' }} />
            <span className="text-[10px]" style={{ color: '#6b7280' }}>
              Drop audio or <span style={{ color: ACCENT }} className="font-medium">click to browse</span>
            </span>
            <span className="text-[9px]" style={{ color: '#9ca3af' }}>MP3, WAV, M4A, OGG, FLAC</span>
          </div>
        )}

        {/* Output label */}
        <div className="flex justify-end text-[9px]" style={{ color: '#94a3b8' }}>
          <div className="flex items-center gap-1">
            <span>Audio</span>
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '66' }} />
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" className="hidden"
        accept=".mp3,.wav,.m4a,.ogg,.flac,audio/*"
        onChange={handleFileChange} />
    </div>
  )
})
AudioInputNode.displayName = 'AudioInputNode'
