import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { assetUrl } from '@/lib/api'
import { EditableLabel } from './EditableLabel'

// ─── Colors ───────────────────────────────────────────────────────────────────

const ACCENT      = '#7c3aed' // violet-700
const ACCENT_RING = 'rgba(124,58,237,0.12)'
const HEADER_BG   = '#faf5ff' // violet-50
const HEADER_BD   = '#e9d5ff' // violet-200
const BADGE_BG    = '#f3e8ff' // violet-100
const BADGE_TEXT  = '#6b21a8' // violet-900

// ─── Options ─────────────────────────────────────────────────────────────────

const SERVICES = [
  { value: 'did',       label: 'D-ID'       },
  { value: 'heygen',    label: 'HeyGen'     },
  { value: 'sadtalker', label: 'SadTalker'  },
]

const selectCss: React.CSSProperties = {
  borderColor:     HEADER_BD,
  color:           BADGE_TEXT,
  backgroundColor: HEADER_BG,
  cursor:          'pointer',
  outline:         'none',
}

// ─── Main node ────────────────────────────────────────────────────────────────

export const CharacterAnimationNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses   = useWorkflowStore(s => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)

  const status    = nodeStatuses[id]?.status ?? 'idle'
  const config    = (data.config as Record<string, unknown>) ?? {}
  const runOutput = nodeStatuses[id]?.output as Record<string, unknown> | undefined

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'
  const isSkipped = status === 'skipped'
  const isLocked  = (config.locked as boolean) ?? false

  const provider       = (config.provider as string) ?? 'did'
  const characterImage = (config.character_image as string) ?? ''

  const videoLocalPath = runOutput?.localPath as string | undefined
  const fullVideoUrl   = videoLocalPath ? assetUrl(videoLocalPath) : null

  const videoRef    = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [dropping,  setDropping]  = useState(false)
  useEffect(() => { setIsPlaying(false) }, [fullVideoUrl])

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const video = videoRef.current
    if (!video) return
    if (isPlaying) { video.pause() }
    else { video.play().catch(err => console.error('[CharacterAnimationNode] play failed:', err)) }
  }, [isPlaying])

  const set = (key: string, value: unknown) =>
    updateNodeData(id, { config: { ...config, [key]: value } })

  const loadImageFile = useCallback((file: File) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const allowedExt = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
    if (!allowed.has(file.type) && !allowedExt.has(ext)) return
    const reader = new FileReader()
    reader.onload = e => {
      const dataUri = e.target?.result as string
      if (dataUri) set('character_image', dataUri)
    }
    reader.readAsDataURL(file)
  }, [config, id, updateNodeData]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    const file = e.dataTransfer.files[0]
    if (file) loadImageFile(file)
  }, [loadImageFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropping(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadImageFile(file)
    e.target.value = ''
  }, [loadImageFile])

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
      <Handle type="target" position={Position.Left} id="audio" style={{ top: '38%' }} title="Audio input (voice or mixed)" />
      <Handle type="target" position={Position.Left} id="image" style={{ top: '62%' }} title="Character image (optional — overrides config)" />
      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="video" style={{ top: '50%' }} title="Animated video" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={{ backgroundColor: selected ? ACCENT : HEADER_BG, borderBottomColor: selected ? ACCENT : HEADER_BD }}>
        <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : ACCENT }} />
        <EditableLabel value={data.label as string} onSave={v => updateNodeData(id, { label: v })} color={selected ? '#fff' : BADGE_TEXT} />
        <span className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : BADGE_BG, color: selected ? '#fff' : BADGE_TEXT }}>
          CHAR
        </span>
        {isRunning && <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: ACCENT }} />}
        {(isPassed && !isLocked) && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />}
        {(isSkipped || (isPassed && isLocked)) && <Icons.Lock className="ml-1 h-3.5 w-3.5 shrink-0 text-amber-400" />}
        {isFailed  && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden" onChange={handleFileChange} />

      {/* Media area — full bleed, 16:9 */}
      {isPassed && fullVideoUrl ? (
        <div className="relative overflow-hidden group/vid" style={{ aspectRatio: '16 / 9' }}>
          <video
            ref={videoRef}
            src={fullVideoUrl}
            className="w-full h-full object-cover"
            style={{ backgroundColor: '#000' }}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            preload="metadata"
          />
          <div className="absolute inset-0 hidden group-hover/vid:flex items-end justify-between p-1.5">
            <button className="nodrag flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors"
              style={{ width: 26, height: 26, color: '#fff' }} onClick={togglePlay}>
              {isPlaying ? <Icons.Pause className="h-3 w-3" /> : <Icons.Play className="h-3 w-3" />}
            </button>
            <a className="nodrag flex items-center justify-center rounded bg-black/60 p-1.5 hover:bg-black/80 transition-colors"
              href={fullVideoUrl} download onClick={e => e.stopPropagation()}>
              <Icons.Download className="h-2.5 w-2.5 text-white" />
            </a>
          </div>
        </div>
      ) : characterImage ? (
        <div
          className="relative overflow-hidden group/img"
          style={{ aspectRatio: '16 / 9' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <img src={characterImage} alt="character" className="w-full h-full object-cover"
            style={{ filter: isRunning ? 'brightness(0.7)' : dropping ? 'brightness(0.5)' : 'none' }} />
          {isRunning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-medium text-white animate-pulse">Animating…</span>
            </div>
          )}
          {dropping && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
              <Icons.ImagePlus className="h-6 w-6 text-white" />
              <span className="text-[10px] font-medium text-white">Drop to replace</span>
            </div>
          )}
          {!isRunning && !dropping && (
            <div className="absolute inset-0 hidden group-hover/img:flex items-end justify-between p-1.5">
              <button className="nodrag flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white hover:bg-black/70 transition-colors"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
                <Icons.ImagePlus className="h-2.5 w-2.5" /> Replace
              </button>
              <button className="nodrag rounded bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                title="Remove image"
                onClick={e => { e.stopPropagation(); set('character_image', '') }}>
                <Icons.X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="nodrag flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
          style={{ aspectRatio: '16 / 9', backgroundColor: dropping ? ACCENT + '18' : HEADER_BG, border: dropping ? `2px dashed ${ACCENT}` : 'none' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}
        >
          {isRunning ? (
            <span className="text-[10px] animate-pulse" style={{ color: ACCENT }}>Animating character…</span>
          ) : dropping ? (
            <>
              <Icons.ImagePlus className="h-8 w-8" style={{ color: ACCENT }} />
              <span className="text-[9px] font-medium" style={{ color: ACCENT }}>Drop photo here</span>
            </>
          ) : (
            <>
              <Icons.UserRound className="h-8 w-8" style={{ color: HEADER_BD }} />
              <span className="text-[9px]" style={{ color: ACCENT + '88' }}>drop photo or click to browse</span>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div className="px-2.5 py-2 space-y-2">
        {/* Input labels */}
        <div className="flex items-center gap-3 text-[9px]" style={{ color: '#94a3b8' }}>
          <div className="flex items-center gap-1">
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '88' }} />
            <span>Audio</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '55' }} />
            <span>Image (optional)</span>
          </div>
        </div>

        {/* Inline controls */}
        <div className="rounded-md border px-2 py-1.5"
          style={{ backgroundColor: HEADER_BG + 'cc', borderColor: HEADER_BD }}>
          <div className="flex items-center gap-1.5">
            <Icons.UserRound className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <select className="nodrag nopan h-6 rounded border text-[10px] font-medium px-1 flex-1"
              style={selectCss} value={provider}
              onChange={e => { e.stopPropagation(); set('provider', e.target.value) }}
              onClick={e => e.stopPropagation()}>
              {SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {/* Skip toggle */}
            <button
              className="nodrag ml-1 flex items-center gap-1 shrink-0"
              title={isLocked ? 'Unlock — re-animate on next run' : 'Skip — reuse cached video'}
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
        </div>
      </div>
    </div>
  )
})
CharacterAnimationNode.displayName = 'CharacterAnimationNode'
