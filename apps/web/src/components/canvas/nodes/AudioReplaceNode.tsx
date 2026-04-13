import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { assetUrl, downloadAsset } from '@/lib/api'
import { EditableLabel } from './EditableLabel'

// ─── Colors ───────────────────────────────────────────────────────────────────

const ACCENT      = '#7c3aed'
const ACCENT_RING = 'rgba(124,58,237,0.12)'
const HEADER_BG   = '#faf5ff'
const HEADER_BD   = '#e9d5ff'
const BADGE_BG    = '#f3e8ff'
const BADGE_TEXT  = '#6b21a8'

// ─── Main node ────────────────────────────────────────────────────────────────

export const AudioReplaceNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses   = useWorkflowStore(s => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore(s => s.updateNodeData)

  const status    = nodeStatuses[id]?.status ?? 'idle'
  const config    = (data.config as Record<string, unknown>) ?? {}
  const runOutput = nodeStatuses[id]?.output as Record<string, unknown> | undefined

  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  const mode        = (config.mode as string) ?? 'replace'
  const musicVolume = (config.music_volume as number) ?? 0.3
  const videoVolume = (config.video_volume as number) ?? 1.0

  const videoPath  = runOutput?.localPath as string | undefined
  const fullUrl    = videoPath ? assetUrl(videoPath) : null

  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${ACCENT}`, boxShadow: `0 0 0 3px ${ACCENT_RING}, 0 0 24px 6px ${ACCENT_RING}, 0 8px 32px rgba(0,0,0,0.18)`,
  } : isRunning ? {
    border: `1.5px solid ${ACCENT}`, boxShadow: `0 0 20px 4px ${ACCENT_RING}`,
  } : isPassed ? { border: `1.5px solid ${ACCENT}` }
    : isFailed  ? { border: '1.5px solid #ef4444' }
    : { border: '1px solid #e0deda' }

  return (
    <div className="relative rounded-md bg-white transition-all" style={{ ...cardStyle, width: 320 }}>
      {/* Input handles */}
      <Handle type="target" position={Position.Left} id="video" style={{ top: '35%' }} title="Video input" />
      <Handle type="target" position={Position.Left} id="audio" style={{ top: '65%' }} title="Audio input" />
      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%' }} title="Video with replaced audio" />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={{ backgroundColor: selected ? ACCENT : HEADER_BG, borderBottomColor: selected ? ACCENT : HEADER_BD }}>
        <div className="shrink-0" style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : ACCENT }} />
        <EditableLabel value={data.label as string} onSave={v => updateNodeData(id, { label: v })} color={selected ? '#fff' : '#27500a'} />
        <span className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : BADGE_BG, color: selected ? '#fff' : BADGE_TEXT }}>
          AUDIO
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
            <span>Video</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-px w-3 shrink-0" style={{ backgroundColor: ACCENT + '55' }} />
            <span>Audio</span>
          </div>
        </div>

        {/* Mode + volumes */}
        <div className="rounded-md border px-2 py-1.5 space-y-1.5" style={{ backgroundColor: HEADER_BG + 'cc', borderColor: HEADER_BD }}>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-wide" style={{ color: ACCENT + 'aa' }}>Mode</span>
            <span className="rounded-full px-1.5 py-px text-[9px] font-medium capitalize"
              style={{ backgroundColor: BADGE_BG, color: BADGE_TEXT }}>{mode}</span>
          </div>
          {/* New audio volume */}
          <div className="flex items-center gap-2">
            <Icons.ListMusic className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
            <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#27500a', width: 28 }}>
              {Math.round(musicVolume * 100)}%
            </span>
            <input type="range" min={0} max={2} step={0.05} value={musicVolume}
              className="nodrag nopan flex-1" style={{ accentColor: ACCENT }}
              onChange={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, music_volume: parseFloat(e.target.value) } }) }}
              onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
            <span className="text-[9px] shrink-0" style={{ color: '#9ca3af', width: 20 }}>new</span>
          </div>
          {/* Original video volume — only in mix mode */}
          {mode === 'mix' && (
            <div className="flex items-center gap-2">
              <Icons.Video className="h-2.5 w-2.5 shrink-0" style={{ color: ACCENT }} />
              <span className="text-[10px] shrink-0 tabular-nums" style={{ color: '#27500a', width: 28 }}>
                {Math.round(videoVolume * 100)}%
              </span>
              <input type="range" min={0} max={2} step={0.05} value={videoVolume}
                className="nodrag nopan flex-1" style={{ accentColor: ACCENT }}
                onChange={e => { e.stopPropagation(); updateNodeData(id, { config: { ...config, video_volume: parseFloat(e.target.value) } }) }}
                onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} />
              <span className="text-[9px] shrink-0" style={{ color: '#9ca3af', width: 20 }}>orig</span>
            </div>
          )}
        </div>

        {/* Post-run preview / state */}
        {isPassed && fullUrl ? (
          <div className="rounded-md border px-2 pt-1.5 pb-1.5 space-y-1.5" style={{ backgroundColor: HEADER_BG + '88', borderColor: HEADER_BD }}>
            <video controls className="w-full rounded" style={{ maxHeight: 120 }}>
              <source src={fullUrl} type="video/mp4" />
            </video>
            <div className="flex justify-end">
              <button
                className="nodrag flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium hover:opacity-80 transition-opacity"
                style={{ borderColor: HEADER_BD, color: ACCENT, backgroundColor: '#fff' }}
                onClick={e => { e.stopPropagation(); downloadAsset(fullUrl!, 'audio_replaced.mp4') }}
              >
                <Icons.Download className="h-2.5 w-2.5" />
                Download
              </button>
            </div>
          </div>
        ) : isRunning ? (
          <div className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[10px] animate-pulse"
            style={{ backgroundColor: ACCENT + '10', color: ACCENT }}>
            <Icons.ListMusic className="h-3 w-3" /> {mode === 'mix' ? 'Mixing' : 'Replacing'} audio…
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 rounded-md px-2 py-2"
            style={{ backgroundColor: HEADER_BG, color: '#a78bfa' }}>
            <Icons.ListMusic className="h-4 w-4" style={{ color: ACCENT + '55' }} />
            <span className="text-[10px]">video preview appears after run</span>
          </div>
        )}
      </div>
    </div>
  )
})
AudioReplaceNode.displayName = 'AudioReplaceNode'
