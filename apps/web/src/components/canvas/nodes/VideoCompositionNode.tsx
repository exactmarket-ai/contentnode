import { memo, useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { assetUrl, downloadAsset, compressImageFile } from '@/lib/api'
import { EditableLabel } from './EditableLabel'

// ─── Colors ───────────────────────────────────────────────────────────────────

const ACCENT      = '#7c3aed' // media violet
const ACCENT_RING = 'rgba(124,58,237,0.12)'
const HEADER_BG   = '#faf5ff'
const HEADER_BD   = '#e9d5ff'
const BADGE_BG    = '#f3e8ff'
const BADGE_TEXT  = '#6b21a8'

const OVERLAY_LABELS: Record<string, string> = {
  lower_third: 'Lower Third',
  title_card:  'Title Card',
  pill_badge:  'Pill Badge',
  fullscreen:  'Fullscreen',
}

const selectCss: React.CSSProperties = {
  borderColor:     HEADER_BD,
  color:           BADGE_TEXT,
  backgroundColor: HEADER_BG,
  cursor:          'pointer',
  outline:         'none',
}

// ─── Duration slider popup ────────────────────────────────────────────────────

const MIN_DUR = 1
const MAX_DUR = 120
const TICK_VALUES = [1, 15, 30, 60, 90, 120]

function DurationSliderPopup({
  value,
  onChange,
  anchorRef,
  onClose,
}: {
  value:     number
  onChange:  (v: number) => void
  anchorRef: React.RefObject<HTMLButtonElement>
  onClose:   () => void
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  // Position centred above the anchor button
  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const POPUP_H = 220
    const POPUP_W = 58
    setPos({
      top:  rect.top - POPUP_H - 8,
      left: rect.left + rect.width / 2 - POPUP_W / 2,
    })
  }, [anchorRef])

  // Close on outside mousedown (capture phase, same as voice picker)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [onClose])

  // Percentage of the way through the range (for tick positioning)
  const pct = (v: number) => ((v - MIN_DUR) / (MAX_DUR - MIN_DUR)) * 100

  const popup = (
    <div
      ref={popupRef}
      onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
      style={{
        position:     'fixed',
        top:          pos.top,
        left:         pos.left,
        width:        58,
        height:       220,
        zIndex:       99999,
        background:   '#fff',
        border:       `1.5px solid ${HEADER_BD}`,
        borderRadius: 10,
        boxShadow:    `0 8px 24px rgba(124,58,237,0.18), 0 2px 8px rgba(0,0,0,0.10)`,
        display:      'flex',
        flexDirection:'column',
        alignItems:   'center',
        padding:      '10px 0 10px',
        gap:          0,
        userSelect:   'none',
      }}
    >
      {/* Current value badge */}
      <div style={{
        background:   BADGE_BG,
        color:        BADGE_TEXT,
        borderRadius: 99,
        fontSize:     11,
        fontWeight:   700,
        padding:      '2px 8px',
        marginBottom: 8,
        letterSpacing: '-0.3px',
      }}>
        {value}s
      </div>

      {/* Slider track area */}
      <div style={{ position: 'relative', flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        {/* Tick marks — positioned along the rotated axis */}
        <div style={{ position: 'absolute', top: 0, left: 4, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
          {[...TICK_VALUES].reverse().map(v => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <div style={{ width: 4, height: 1, background: value === v ? ACCENT : HEADER_BD }} />
              <span style={{ fontSize: 8, color: value === v ? BADGE_TEXT : '#c4b5fd', fontWeight: value === v ? 700 : 400, lineHeight: 1 }}>
                {v}
              </span>
            </div>
          ))}
        </div>

        {/* Vertical range input (rotated horizontal range) */}
        <div style={{ width: 20, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible', marginLeft: 18 }}>
          <input
            type="range"
            min={MIN_DUR}
            max={MAX_DUR}
            step={1}
            value={value}
            onChange={e => onChange(Number(e.target.value))}
            onMouseDown={e => e.stopPropagation()}
            style={{
              width:        160,
              height:       4,
              transform:    'rotate(-90deg)',
              cursor:       'pointer',
              accentColor:  ACCENT,
              transformOrigin: 'center center',
            }}
          />
        </div>
      </div>

      {/* Bottom label */}
      <div style={{ fontSize: 8, color: '#c4b5fd', marginTop: 4 }}>seconds</div>
    </div>
  )

  return createPortal(popup, document.body)
}

// ─── Main node ────────────────────────────────────────────────────────────────

export const VideoCompositionNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses   = useWorkflowStore(s => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)

  const status    = nodeStatuses[id]?.status ?? 'idle'
  const config    = (data.config as Record<string, unknown>) ?? {}
  const runOutput = nodeStatuses[id]?.output as Record<string, unknown> | undefined

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  const renderMode   = (config.render_mode as string) ?? 'local'
  const outputFormat = (config.output_format as string) ?? 'video'
  const duration     = (config.duration as number) ?? 10
  const bgImage      = (config.background_url as string) ?? ''

  const videoLocalPath  = runOutput?.localPath as string | undefined
  const fullVideoUrl    = videoLocalPath ? assetUrl(videoLocalPath) : null
  const cloudUrl        = runOutput?.cloudUrl as string | undefined
  const outputIsImage   = (runOutput?.outputFormat ?? runOutput?.type) === 'image'

  const videoRef      = useRef<HTMLVideoElement | null>(null)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const durationBtnRef = useRef<HTMLButtonElement>(null)

  const [isPlaying,      setIsPlaying]      = useState(false)
  const [dropping,       setDropping]       = useState(false)
  const [sliderOpen,     setSliderOpen]     = useState(false)

  useEffect(() => { setIsPlaying(false) }, [fullVideoUrl])

  const set = (key: string, value: unknown) =>
    updateNodeData(id, { config: { ...config, [key]: value } })

  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoRef.current
    if (!v) return
    if (isPlaying) v.pause()
    else v.play().catch(err => console.error('[VideoCompositionNode] play failed:', err))
  }, [isPlaying])

  const loadBgFile = useCallback((file: File) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp'])
    if (!allowed.has(file.type)) return
    compressImageFile(file).then(uri => set('background_url', uri)).catch(() => {
      const reader = new FileReader()
      reader.onload = e => { const d = e.target?.result as string; if (d) set('background_url', d) }
      reader.readAsDataURL(file)
    })
  }, [config, id, updateNodeData]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <Handle type="target" position={Position.Left} id="image"  style={{ top: '30%' }} title="Background image" />
      <Handle type="target" position={Position.Left} id="text"   style={{ top: '50%' }} title="Text content" />
      <Handle type="target" position={Position.Left} id="audio"  style={{ top: '70%' }} title="Audio (optional)" />
      {/* Output */}
      <Handle type="source" position={Position.Right} id="video" style={{ top: '50%' }} title="Composed video" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={{ backgroundColor: selected ? ACCENT : HEADER_BG, borderBottomColor: selected ? ACCENT : HEADER_BD }}>
        <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : ACCENT }} />
        <EditableLabel value={data.label as string} onSave={v => updateNodeData(id, { label: v })} color={selected ? '#fff' : BADGE_TEXT} />
        <span className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : BADGE_BG, color: selected ? '#fff' : BADGE_TEXT }}>
          COMP
        </span>
        {isRunning && <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: ACCENT }} />}
        {isPassed  && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />}
        {isFailed  && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) loadBgFile(f); e.target.value = '' }} />

      {/* Media area — 16:9 */}
      {isPassed && fullVideoUrl && outputIsImage ? (
        // Image output preview
        <div className="relative overflow-hidden group/img" style={{ aspectRatio: '16 / 9' }}>
          <img src={fullVideoUrl} alt="composition" className="w-full h-full object-cover" />
          <div className="absolute inset-0 hidden group-hover/img:flex items-end justify-end p-1.5">
            <button className="nodrag flex items-center justify-center rounded bg-black/60 p-1.5 hover:bg-black/80 transition-colors"
              onClick={e => { e.stopPropagation(); downloadAsset(fullVideoUrl!, 'composition.jpg') }}>
              <Icons.Download className="h-2.5 w-2.5 text-white" />
            </button>
          </div>
        </div>
      ) : isPassed && fullVideoUrl ? (
        <div className="relative overflow-hidden group/vid" style={{ aspectRatio: '16 / 9' }}>
          <video ref={videoRef} src={fullVideoUrl} className="w-full h-full object-cover"
            style={{ backgroundColor: '#000' }}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            preload="metadata" />
          <div className="absolute inset-0 hidden group-hover/vid:flex items-end justify-between p-1.5">
            <button className="nodrag flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 transition-colors"
              style={{ width: 26, height: 26, color: '#fff' }} onClick={togglePlay}>
              {isPlaying ? <Icons.Pause className="h-3 w-3" /> : <Icons.Play className="h-3 w-3" />}
            </button>
            <button className="nodrag flex items-center justify-center rounded bg-black/60 p-1.5 hover:bg-black/80 transition-colors"
              onClick={e => { e.stopPropagation(); downloadAsset(fullVideoUrl!, 'composition.mp4') }}>
              <Icons.Download className="h-2.5 w-2.5 text-white" />
            </button>
          </div>
        </div>
      ) : bgImage ? (
        <div className="relative overflow-hidden" style={{ aspectRatio: '16 / 9' }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); setDropping(false); const f = e.dataTransfer.files[0]; if (f) loadBgFile(f) }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}>
          <img src={bgImage} alt="background" className="w-full h-full object-cover"
            style={{ filter: isRunning ? 'brightness(0.6)' : dropping ? 'brightness(0.5)' : 'none' }} />
          {isRunning && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-medium text-white animate-pulse">Compositing…</span>
            </div>
          )}
          {!isRunning && !dropping && (
            <div className="absolute inset-0 hidden hover:flex items-end justify-between p-1.5 group/bg">
              <button className="nodrag flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white hover:bg-black/70"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
                <Icons.ImagePlus className="h-2.5 w-2.5" /> Replace
              </button>
              <button className="nodrag rounded bg-black/50 p-1 text-white hover:bg-black/70"
                onClick={e => { e.stopPropagation(); set('background_url', '') }}>
                <Icons.X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="nodrag flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
          style={{ aspectRatio: '16 / 9', backgroundColor: dropping ? ACCENT + '18' : HEADER_BG, border: dropping ? `2px dashed ${ACCENT}` : 'none' }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); setDropping(false); const f = e.dataTransfer.files[0]; if (f) loadBgFile(f) }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropping(true) }}
          onDragLeave={() => setDropping(false)}
          onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
          {isRunning ? (
            <span className="text-[10px] animate-pulse" style={{ color: ACCENT }}>Compositing…</span>
          ) : dropping ? (
            <>
              <Icons.ImagePlus className="h-8 w-8" style={{ color: ACCENT }} />
              <span className="text-[9px] font-medium" style={{ color: ACCENT }}>Drop background image</span>
            </>
          ) : (
            <>
              <Icons.Film className="h-8 w-8" style={{ color: HEADER_BD }} />
              <span className="text-[9px]" style={{ color: ACCENT + '88' }}>drop background or click to browse</span>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div className="px-2.5 py-2 space-y-2">
        <div className="flex items-center gap-3 text-[9px]" style={{ color: '#94a3b8' }}>
          <div className="flex items-center gap-1"><div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '88' }} /><span>Image</span></div>
          <div className="flex items-center gap-1"><div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '66' }} /><span>Text</span></div>
          <div className="flex items-center gap-1"><div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '44' }} /><span>Audio (opt)</span></div>
        </div>

        <div className="rounded-md border px-2 py-1.5"
          style={{ backgroundColor: HEADER_BG + 'cc', borderColor: HEADER_BD }}>
          <div className="flex items-center gap-1.5">
            <Icons.Film className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <select className="nodrag nopan h-6 rounded border text-[10px] font-medium px-1 flex-1 min-w-0"
              style={selectCss} value={(config.overlay_style as string) ?? 'lower_third'}
              onChange={e => { e.stopPropagation(); set('overlay_style', e.target.value) }}
              onClick={e => e.stopPropagation()}>
              {Object.entries(OVERLAY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="nodrag nopan h-6 rounded border text-[10px] font-medium px-1 shrink-0"
              style={{ ...selectCss, width: 74 }}
              value={renderMode}
              onChange={e => { e.stopPropagation(); set('render_mode', e.target.value) }}
              onClick={e => e.stopPropagation()}>
              <option value="local">Local</option>
              <option value="cloud">Shotstack</option>
            </select>
            {/* Duration button — only shown in video mode; opens vertical slider popup */}
            {outputFormat !== 'image' && (
              <button
                ref={durationBtnRef}
                className="nodrag nopan shrink-0 flex items-center gap-0.5 rounded border px-1.5 h-6 text-[10px] font-semibold transition-colors"
                style={{
                  borderColor:     sliderOpen ? ACCENT : HEADER_BD,
                  backgroundColor: sliderOpen ? BADGE_BG : HEADER_BG,
                  color:           BADGE_TEXT,
                  cursor:          'pointer',
                  outline:         'none',
                }}
                onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                onClick={e => { e.stopPropagation(); setSliderOpen(o => !o) }}
                title="Set duration"
              >
                <Icons.Clock className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
                {duration}s
              </button>
            )}
            {/* VID/IMG toggle */}
            <button
              className="nodrag nopan shrink-0 flex items-center gap-0.5 rounded border px-1.5 h-6 text-[10px] font-bold transition-colors"
              style={{
                borderColor:     HEADER_BD,
                backgroundColor: outputFormat === 'image' ? BADGE_BG : HEADER_BG,
                color:           outputFormat === 'image' ? BADGE_TEXT : '#94a3b8',
                cursor:          'pointer',
                outline:         'none',
              }}
              onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
              onClick={e => { e.stopPropagation(); const next = outputFormat === 'image' ? 'video' : 'image'; set('output_format', next); if (next === 'image') setSliderOpen(false) }}
              title={outputFormat === 'image' ? 'Output: JPEG image — click for video' : 'Output: MP4 video — click for image'}
            >
              {outputFormat === 'image' ? <Icons.Image className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} /> : <Icons.Film className="h-2.5 w-2.5 shrink-0" style={{ color: '#94a3b8' }} />}
              {outputFormat === 'image' ? 'IMG' : 'VID'}
            </button>
          </div>

          {cloudUrl && (
            <p className="mt-1 text-[9px] truncate" style={{ color: ACCENT }}>
              ☁ {cloudUrl}
            </p>
          )}
        </div>
      </div>

      {/* Duration slider portal */}
      {sliderOpen && (
        <DurationSliderPopup
          value={duration}
          onChange={v => set('duration', v)}
          anchorRef={durationBtnRef}
          onClose={() => setSliderOpen(false)}
        />
      )}
    </div>
  )
})
VideoCompositionNode.displayName = 'VideoCompositionNode'
