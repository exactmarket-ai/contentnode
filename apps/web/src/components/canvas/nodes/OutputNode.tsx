import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeSpec } from '@/lib/nodeColors'
import { assetUrl } from '@/lib/api'
import { NodeUploadZone, type ReferenceFile } from './NodeUploadZone'
import { downloadAsset, makeFilename } from '@/lib/downloadAsset'
import { EditableLabel } from './EditableLabel'

const GENERATION_SUBTYPES = new Set(['image-generation', 'video-generation'])

export const OutputNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const status = nodeStatuses[id]?.status ?? 'idle'
  const subtype = (data.subtype as string) ?? (data.config as Record<string, unknown>)?.subtype as string
  const spec = getNodeSpec('output', subtype)
  const isGeneration = GENERATION_SUBTYPES.has(subtype)

  const isRunning  = status === 'running'
  const isPassed   = status === 'passed'
  const isFailed   = status === 'failed'
  const isSkipped  = status === 'skipped'

  // Connected upstream nodes (for multi-input display)
  const incomingEdges = edges.filter((e) => e.target === id)
  const connectedSources = incomingEdges.map((e) => {
    const src = nodes.find((n) => n.id === e.source)
    return src?.data?.label as string || 'Source'
  }).filter(Boolean)

  // Reference files stored in node config
  const config = (data.config as Record<string, unknown>) ?? {}
  const isLocked   = config.locked === true
  const referenceFiles = (config.reference_files as ReferenceFile[]) ?? []

  const handleAddRef = (file: ReferenceFile) => {
    const current = (config.reference_files as ReferenceFile[]) ?? []
    updateNodeData(id, { config: { ...config, reference_files: [...current, file] } })
  }
  const handleRemoveRef = (localPath: string) => {
    const current = (config.reference_files as ReferenceFile[]) ?? []
    updateNodeData(id, { config: { ...config, reference_files: current.filter((f) => f.localPath !== localPath) } })
  }

  const handleRerun = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Unlock and clear stored assets so the runner will re-generate this node
    updateNodeData(id, { config: { ...config, locked: false, stored_assets: undefined } })
  }

  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${spec.accent}`,
    boxShadow: `0 0 0 3px ${spec.activeRing}`,
  } : isRunning ? {
    border: `1.5px solid ${spec.accent}`,
    boxShadow: `0 0 20px 4px ${spec.activeRing}`,
  } : isPassed ? {
    border: `1.5px solid ${spec.accent}`,
  } : isSkipped ? {
    border: '1.5px solid #f59e0b',
  } : isFailed ? {
    border: '1.5px solid #ef4444',
  } : {
    border: '1px solid #e0deda',
  }

  const headerStyle: React.CSSProperties = selected ? {
    backgroundColor: spec.accent,
    borderBottomColor: spec.accent,
  } : {
    backgroundColor: spec.headerBg,
    borderBottomColor: spec.headerBorder,
  }

  const titleColor = selected ? spec.activeTextColor : '#1a1a14'
  const nodeWidth = isGeneration ? 240 : 200

  return (
    <div
      className="relative rounded-md bg-white transition-all"
      style={{ ...cardStyle, width: nodeWidth }}
    >
      <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />

      {/* Header */}
      <div className="flex items-center gap-2 rounded-t-md border-b px-3 py-2" style={headerStyle}>
        <div
          className="shrink-0"
          style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent }}
        />
        <EditableLabel
          value={data.label as string}
          onSave={(v) => updateNodeData(id, { label: v })}
          color={titleColor}
        />
        <span
          className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : spec.badgeBg, color: selected ? spec.activeTextColor : spec.badgeText }}
        >
          {spec.label}
        </span>
        {isRunning && (
          <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: spec.accent }} />
        )}
        {isPassed  && !isLocked && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: spec.accent }} />}
        {(isSkipped || (isPassed && isLocked)) && <Icons.Lock className="ml-1 h-3.5 w-3.5 shrink-0 text-amber-400" />}
        {isFailed  && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
        {isLocked  && !isRunning && !isFailed && (
          <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-px text-[8px] font-semibold text-amber-400">
            SKIP
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-2.5 py-1.5 space-y-1.5">

        {/* Connected sources (generation nodes) */}
        {isGeneration && connectedSources.length > 0 && (
          <div className="space-y-0.5">
            {connectedSources.map((label, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="h-px w-2 shrink-0" style={{ backgroundColor: spec.accent + '88' }} />
                <span className="text-[9px] truncate" style={{ color: spec.accent + 'cc' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Description (non-generation) */}
        {!isGeneration && (
          <p className="text-[10px] leading-[1.4] line-clamp-2" style={{ color: '#6b6a62' }}>
            {data.description as string}
          </p>
        )}

        {/* Reference file upload zone (generation nodes only) */}
        {isGeneration && (
          <NodeUploadZone
            files={referenceFiles}
            onAdd={handleAddRef}
            onRemove={handleRemoveRef}
            accentColor={spec.accent}
          />
        )}

        {/* Skip toggle — always visible on generation nodes */}
        {isGeneration && (
          <div className="flex items-center justify-between">
            <button
              className="nodrag flex items-center gap-1.5"
              title={isLocked ? 'Click to unlock — node will regenerate on next run' : 'Click to skip — node will reuse cached output'}
              onClick={(e) => {
                e.stopPropagation()
                updateNodeData(id, { config: { ...config, locked: !isLocked } })
              }}
            >
              <div
                className="relative inline-flex h-3.5 w-6 shrink-0 rounded-full border border-transparent transition-colors"
                style={{ backgroundColor: isLocked ? '#f59e0b' : '#d1d5db' }}
              >
                <span
                  className="pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform mt-px"
                  style={{ transform: isLocked ? 'translateX(10px)' : 'translateX(1px)' }}
                />
              </div>
              <span className="text-[9px]" style={{ color: isLocked ? '#f59e0b' : '#9ca3af' }}>
                {isLocked ? 'Skip' : 'Skip'}
              </span>
            </button>
            {isLocked && (
              <button
                className="nodrag flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground border border-border hover:border-foreground/40 hover:text-foreground transition-colors bg-card"
                title="Unlock and re-generate on next run"
                onClick={handleRerun}
              >
                <Icons.RotateCcw className="h-2.5 w-2.5" />
                Re-run
              </button>
            )}
          </div>
        )}

        {/* Status / timing */}
        {(isPassed || isFailed) && nodeStatuses[id]?.startedAt && (
          <p className="text-[10px]" style={{ color: '#b4b2a9' }}>
            Received {new Date(nodeStatuses[id].startedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}

        {/* Video generation: generating indicator */}
        {isRunning && subtype === 'video-generation' && (
          <p className="animate-pulse text-[10px]" style={{ color: spec.accent }}>
            Generating video…
          </p>
        )}

        {/* Video generation: looping full-width preview after completion or when cached */}
        {(isPassed || isSkipped || status === 'idle') && subtype === 'video-generation' && (() => {
          const output = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const assets = (output?.assets ?? config.stored_assets) as { localPath: string }[] | undefined
          if (!assets?.length) return null
          const label = data.label as string
          return (
            <div className="overflow-hidden rounded-sm" style={{ marginLeft: -10, marginRight: -10 }}>
              <div className="relative group">
                <video
                  src={assetUrl(assets[0].localPath)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full object-cover"
                  style={{ maxHeight: 240, display: 'block' }}
                />
                {/* Re-run button — top left on hover (generation nodes with stored assets) */}
                <div className="absolute top-1.5 left-1.5 hidden group-hover:flex">
                  <button
                    className="nodrag flex items-center gap-1 rounded px-1.5 py-1 text-[9px] font-medium bg-black/60 hover:bg-black/80 text-white transition-colors"
                    title="Clear cache and re-generate"
                    onClick={handleRerun}
                  >
                    <Icons.RotateCcw className="h-3 w-3" />
                    Re-run
                  </button>
                </div>
                {/* Download button — top right */}
                <div className="absolute top-1.5 right-1.5 hidden group-hover:flex">
                  <button
                    className="nodrag flex items-center justify-center rounded bg-black/60 p-1 hover:bg-black/80 transition-colors"
                    title="Download"
                    onClick={(e) => { e.stopPropagation(); downloadAsset(assets[0].localPath, makeFilename(label, assets[0].localPath)) }}
                  >
                    <Icons.Download className="h-3 w-3 text-white" />
                  </button>
                </div>
              </div>
              {assets.length > 1 && (
                <p className="text-center text-[9px] py-0.5" style={{ color: '#b4b2a9' }}>
                  +{assets.length - 1} more clip{assets.length > 2 ? 's' : ''}
                </p>
              )}
            </div>
          )
        })()}

        {/* Image generation: full-width thumbnail after completion or when cached */}
        {(isPassed || isSkipped || status === 'idle') && subtype === 'image-generation' && (() => {
          const output = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const assets = (output?.assets ?? config.stored_assets) as { localPath: string }[] | undefined
          if (!assets?.length) return null
          const label = data.label as string
          return (
            <div style={{ marginLeft: -10, marginRight: -10 }}>
              {/* Primary image — full width, 240px tall */}
              <div className="relative overflow-hidden group" style={{ height: 240 }}>
                <img
                  src={assetUrl(assets[0].localPath)}
                  alt="Generated"
                  draggable={false}
                  className="w-full h-full object-cover"
                />
                {/* Re-run button — top left on hover */}
                <div className="absolute top-1.5 left-1.5 hidden group-hover:flex">
                  <button
                    className="nodrag flex items-center gap-1 rounded px-1.5 py-1 text-[9px] font-medium bg-black/60 hover:bg-black/80 text-white transition-colors"
                    title="Clear cache and re-generate"
                    onClick={handleRerun}
                  >
                    <Icons.RotateCcw className="h-3 w-3" />
                    Re-run
                  </button>
                </div>
                {/* Download button — top right */}
                <div className="absolute top-1.5 right-1.5 hidden group-hover:flex">
                  <button
                    className="nodrag flex items-center justify-center rounded bg-black/60 p-1 hover:bg-black/80 transition-colors"
                    title="Download"
                    onClick={(e) => { e.stopPropagation(); downloadAsset(assets[0].localPath, makeFilename(label, assets[0].localPath)) }}
                  >
                    <Icons.Download className="h-3 w-3 text-white" />
                  </button>
                </div>
              </div>
              {/* Additional images as small strip with download on hover */}
              {assets.length > 1 && (
                <div className="flex gap-0.5 pt-0.5 px-2.5">
                  {assets.slice(1, 4).map((a, i) => (
                    <div key={i} className="relative group/thumb shrink-0">
                      <img
                        src={assetUrl(a.localPath)}
                        alt={`Generated ${i + 2}`}
                        draggable={false}
                        className="h-8 w-8 rounded-sm object-cover border"
                        style={{ borderColor: spec.accent + '44' }}
                      />
                      <div className="absolute inset-0 hidden group-hover/thumb:flex items-center justify-center rounded-sm bg-black/50">
                        <button
                          className="nodrag"
                          title="Download"
                          onClick={(e) => { e.stopPropagation(); downloadAsset(a.localPath, makeFilename(label, a.localPath, i + 1)) }}
                        >
                          <Icons.Download className="h-2.5 w-2.5 text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {assets.length > 4 && (
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border text-[9px] font-medium"
                      style={{ borderColor: spec.accent + '44', color: spec.accent }}
                    >
                      +{assets.length - 4}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Non-generation output description */}
        {!isGeneration && (isPassed || isFailed) && (
          <p className="text-[10px] leading-[1.4]" style={{ color: '#6b6a62' }}>
            {data.description as string}
          </p>
        )}
      </div>
    </div>
  )
})
OutputNode.displayName = 'OutputNode'
