import { memo, useState } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { getNodeSpec } from '@/lib/nodeColors'
import { assetUrl } from '@/lib/api'
import { NodeUploadZone, type ReferenceFile } from './NodeUploadZone'
import { downloadAsset, makeFilename } from '@/lib/downloadAsset'
import { EditableLabel } from './EditableLabel'

const GENERATION_SUBTYPES = new Set(['image-generation', 'video-generation'])

const IMAGE_PROVIDERS = [
  { value: 'dalle3',        label: 'DALL-E 3' },
  { value: 'stability',     label: 'Stability AI' },
  { value: 'fal',           label: 'Fal.ai' },
  { value: 'comfyui',       label: 'ComfyUI (local)' },
  { value: 'automatic1111', label: 'A1111 (local)' },
]

const VIDEO_PROVIDERS = [
  { value: 'runway',              label: 'Runway Gen-3' },
  { value: 'kling',               label: 'Kling AI' },
  { value: 'luma',                label: 'Luma Dream Machine' },
  { value: 'pika',                label: 'Pika Labs' },
  { value: 'stability',           label: 'Stability (SVD)' },
  { value: 'veo2',                label: 'Google Veo 2' },
  { value: 'comfyui-animatediff', label: 'AnimateDiff (local)' },
  { value: 'cogvideox',           label: 'CogVideoX (local)' },
  { value: 'wan21',               label: 'Wan 2.1 (local)' },
]

const VIDEO_DURATIONS = [3,4,5,6,7,8,9,10,11,12,13,14,15]

function estimateCost(subtype: string, provider: string, config: Record<string, unknown>): string | null {
  if (subtype === 'image-generation') {
    const count = (config.num_outputs as number) ?? 1
    const quality = (config.quality as string) ?? 'standard'
    const rateMap: Record<string, number> = {
      dalle3: quality === 'high' ? 0.08 : 0.04,
      stability: 0.003,
      fal: 0.005,
    }
    const rate = rateMap[provider]
    if (!rate) return 'Local'
    return `~$${(rate * count).toFixed(2)}`
  }
  if (subtype === 'video-generation') {
    const dur = (config.duration_seconds as number) ?? 5
    const rateMap: Record<string, number> = {
      runway: 0.05, kling: 0.03, luma: 0.04, pika: 0.016, veo2: 0.10,
    }
    const rate = rateMap[provider]
    if (!rate) return 'Local'
    return `~$${(rate * dur).toFixed(2)}`
  }
  return null
}

interface HistoryEntry { localPath: string; type: 'image' | 'video'; timestamp: string }

// Shared style for inline select controls on the node
const selectStyle: React.CSSProperties = {
  borderColor: '#e0deda',
  color: '#1a1a14',
  backgroundColor: '#fafaf8',
  cursor: 'pointer',
}

function DisplayInlineOutput({ id, text, accentColor }: { id: string; text: string; accentColor: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="space-y-1" style={{ marginLeft: -10, marginRight: -10 }}>
      <div
        className="px-2.5 py-2 text-[10px] leading-[1.5] line-clamp-3 select-none"
        style={{ backgroundColor: accentColor + '0d', color: '#1a1a14', borderTop: `1px solid ${accentColor}22` }}
      >
        {text}
      </div>
      <div className="flex justify-end px-2">
        <button
          className="nodrag flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium hover:bg-accent"
          style={{ color: accentColor }}
          onClick={handleCopy}
        >
          {copied ? <Icons.Check className="h-2.5 w-2.5" /> : <Icons.Copy className="h-2.5 w-2.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

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

  const incomingEdges = edges.filter((e) => e.target === id)
  const connectedSources = incomingEdges.map((e) => {
    const src = nodes.find((n) => n.id === e.source)
    return src?.data?.label as string || 'Source'
  }).filter(Boolean)

  const config = (data.config as Record<string, unknown>) ?? {}
  const isLocked = config.locked === true
  const referenceFiles = (config.reference_files as ReferenceFile[]) ?? []

  // Generation config
  const provider = (config.provider as string) ?? (subtype === 'video-generation' ? 'runway' : 'dalle3')
  const providerList = subtype === 'video-generation' ? VIDEO_PROVIDERS : IMAGE_PROVIDERS
  const costEstimate = isGeneration ? estimateCost(subtype, provider, config) : null
  const runHistory = (config.run_history as HistoryEntry[]) ?? []

  // Prompt preview from upstream source nodes
  const promptPreview = isGeneration ? (() => {
    const texts: string[] = []
    for (const edge of incomingEdges) {
      const src = nodes.find((n) => n.id === edge.source)
      if (!src) continue
      const cfg = (src.data?.config as Record<string, unknown>) ?? {}
      const text = (cfg.text as string) || (cfg.inlineText as string) || (cfg.pasted_text as string) || ''
      if (text.trim()) texts.push(text.trim())
    }
    return texts.length > 0 ? texts.join(' · ') : null
  })() : null

  const set = (key: string, value: unknown) =>
    updateNodeData(id, { config: { ...config, [key]: value } })

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
    updateNodeData(id, { config: { ...config, locked: false, stored_assets: undefined } })
  }

  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${spec.accent}`,
    boxShadow: `0 0 0 3px ${spec.activeRing}, 0 0 24px 6px ${spec.activeRing}, 0 8px 32px rgba(0,0,0,0.18)`,
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
  const nodeWidth = isGeneration ? 380 : 200

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
          <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-px text-[8px] font-semibold text-amber-400">SKIP</span>
        )}
      </div>

      {/* Body */}
      <div className="px-2.5 py-2 space-y-2">

        {/* ── 16:9 preview / placeholder — shown for generation nodes ── */}
        {isGeneration && (() => {
          const output = nodeStatuses[id]?.output as Record<string, unknown> | undefined
          const assets = (output?.assets ?? config.stored_assets) as { localPath: string }[] | undefined

          if (subtype === 'video-generation') {
            if (assets?.length) {
              const label = data.label as string
              return (
                <div className="overflow-hidden rounded-sm" style={{ marginLeft: -10, marginRight: -10 }}>
                  <div className="relative group">
                    <video src={assetUrl(assets[0].localPath)} autoPlay loop muted playsInline className="w-full object-cover" style={{ maxHeight: 240, display: 'block' }} />
                    <div className="absolute top-1.5 left-1.5 hidden group-hover:flex">
                      <button className="nodrag flex items-center gap-1 rounded px-1.5 py-1 text-[9px] font-medium bg-black/60 hover:bg-black/80 text-white transition-colors" onClick={handleRerun}>
                        <Icons.RotateCcw className="h-3 w-3" />Re-run
                      </button>
                    </div>
                    <div className="absolute top-1.5 right-1.5 hidden group-hover:flex">
                      <button className="nodrag flex items-center justify-center rounded bg-black/60 p-1 hover:bg-black/80 transition-colors" title="Download" onClick={(e) => { e.stopPropagation(); downloadAsset(assets[0].localPath, makeFilename(label, assets[0].localPath)) }}>
                        <Icons.Download className="h-3 w-3 text-white" />
                      </button>
                    </div>
                  </div>
                  {assets.length > 1 && (
                    <p className="text-center text-[9px] py-0.5" style={{ color: '#b4b2a9' }}>+{assets.length - 1} more clip{assets.length > 2 ? 's' : ''}</p>
                  )}
                </div>
              )
            }
            return (
              <div
                style={{ marginLeft: -10, marginRight: -10, aspectRatio: '16 / 9', backgroundColor: '#f4f3ef', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {isRunning
                  ? <p className="animate-pulse text-[10px]" style={{ color: spec.accent }}>Generating video…</p>
                  : <Icons.Film className="h-8 w-8" style={{ color: '#d0cfc8' }} />
                }
              </div>
            )
          }

          if (subtype === 'image-generation') {
            const count = Math.min(assets?.length ?? 0, 4)
            if (count > 0) {
              const label = data.label as string
              const cellH = count === 1 ? 240 : 130
              const cols = count === 1 ? 1 : 2
              return (
                <div
                  style={{ marginLeft: -10, marginRight: -10, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}
                >
                  {assets!.slice(0, count).map((a, i) => (
                    <div key={i} className="relative overflow-hidden group/img" style={{ height: cellH }}>
                      <img src={assetUrl(a.localPath)} alt={`Generated ${i + 1}`} draggable={false} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 hidden group-hover/img:flex items-end justify-between p-1">
                        {i === 0 && (
                          <button className="nodrag flex items-center gap-1 rounded px-1.5 py-1 text-[9px] font-medium bg-black/60 hover:bg-black/80 text-white transition-colors" onClick={handleRerun}>
                            <Icons.RotateCcw className="h-2.5 w-2.5" />Re-run
                          </button>
                        )}
                        <button className="nodrag ml-auto flex items-center justify-center rounded bg-black/60 p-1 hover:bg-black/80 transition-colors" title="Download" onClick={(e) => { e.stopPropagation(); downloadAsset(a.localPath, makeFilename(label, a.localPath, i)) }}>
                          <Icons.Download className="h-2.5 w-2.5 text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
            return (
              <div
                style={{ marginLeft: -10, marginRight: -10, aspectRatio: '16 / 9', backgroundColor: '#f4f3ef', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {isRunning
                  ? <p className="animate-pulse text-[10px]" style={{ color: spec.accent }}>Generating image…</p>
                  : <Icons.Image className="h-8 w-8" style={{ color: '#d0cfc8' }} />
                }
              </div>
            )
          }

          return null
        })()}

        {/* Connected sources (generation) */}
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

        {/* Description / inline output (non-generation) */}
        {!isGeneration && (() => {
          if (subtype === 'display' && isPassed) {
            const rawOut = nodeStatuses[id]?.output
            const text = typeof rawOut === 'string' ? rawOut
              : typeof rawOut === 'object' && rawOut !== null
                ? ((rawOut as Record<string,unknown>).content as string | undefined)
                  ?? ((rawOut as Record<string,unknown>).text as string | undefined)
                  ?? JSON.stringify(rawOut)
              : null
            return text ? <DisplayInlineOutput id={id} text={text} accentColor={spec.accent} /> : null
          }
          return (
            <p className="text-[10px] leading-[1.4] line-clamp-2" style={{ color: '#6b6a62' }}>
              {data.description as string}
            </p>
          )
        })()}

        {/* Prompt preview */}
        {isGeneration && promptPreview && (
          <div
            className="rounded px-1.5 py-1 text-[9px] leading-[1.35] line-clamp-2 italic"
            style={{ backgroundColor: spec.accent + '10', color: spec.accent + 'cc' }}
          >
            &ldquo;{promptPreview}&rdquo;
          </div>
        )}

        {/* Reference files */}
        {isGeneration && (
          <NodeUploadZone
            files={referenceFiles}
            onAdd={handleAddRef}
            onRemove={handleRemoveRef}
            accentColor={spec.accent}
          />
        )}

        {/* ── Inline config controls + Skip toggle ─────────────────────── */}
        {isGeneration && (
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <div className="flex items-center gap-1">
              {/* Provider */}
              <select
                className="nodrag nopan flex-1 h-6 rounded border text-[10px] font-medium px-1 outline-none min-w-0"
                style={selectStyle}
                value={provider}
                onChange={(e) => { e.stopPropagation(); set('provider', e.target.value) }}
                onClick={(e) => e.stopPropagation()}
              >
                {providerList.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>

              {/* Image-specific */}
              {subtype === 'image-generation' && <>
                <select
                  className="nodrag nopan h-6 rounded border text-[9px] px-1 outline-none"
                  style={{ ...selectStyle, width: 44 }}
                  value={(config.aspect_ratio as string) ?? '1:1'}
                  onChange={(e) => { e.stopPropagation(); set('aspect_ratio', e.target.value) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="1:1">1:1</option>
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="4:3">4:3</option>
                </select>
                <select
                  className="nodrag nopan h-6 rounded border text-[9px] px-1 outline-none"
                  style={{ ...selectStyle, width: 44 }}
                  value={(config.quality as string) ?? 'standard'}
                  onChange={(e) => { e.stopPropagation(); set('quality', e.target.value) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="draft">Draft</option>
                  <option value="standard">Std</option>
                  <option value="high">High</option>
                </select>
                <select
                  className="nodrag nopan h-6 rounded border text-[9px] px-1 outline-none"
                  style={{ ...selectStyle, width: 34 }}
                  value={(config.num_outputs as number) ?? 1}
                  onChange={(e) => { e.stopPropagation(); set('num_outputs', Number(e.target.value)) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value={1}>×1</option>
                  <option value={2}>×2</option>
                  <option value={3}>×3</option>
                  <option value={4}>×4</option>
                </select>
              </>}

              {/* Video-specific */}
              {subtype === 'video-generation' && <>
                <select
                  className="nodrag nopan h-6 rounded border text-[9px] px-1 outline-none"
                  style={{ ...selectStyle, width: 40 }}
                  value={(config.duration_seconds as number) ?? 5}
                  onChange={(e) => { e.stopPropagation(); set('duration_seconds', Number(e.target.value)) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {VIDEO_DURATIONS.map((d) => (
                    <option key={d} value={d}>{d}s</option>
                  ))}
                </select>
                <select
                  className="nodrag nopan h-6 rounded border text-[9px] px-1 outline-none"
                  style={{ ...selectStyle, width: 52 }}
                  value={(config.resolution as string) ?? '720p'}
                  onChange={(e) => { e.stopPropagation(); set('resolution', e.target.value) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </>}

              {costEstimate && (
                <span className="shrink-0 text-[9px] tabular-nums font-medium" style={{ color: '#b4b2a9' }}>
                  {costEstimate}
                </span>
              )}

              {/* Skip toggle — inline at end of row */}
              <button
                className="nodrag ml-1 flex items-center gap-1 shrink-0"
                title={isLocked ? 'Click to unlock — node will regenerate on next run' : 'Click to skip — node will reuse cached output'}
                onClick={(e) => { e.stopPropagation(); updateNodeData(id, { config: { ...config, locked: !isLocked } }) }}
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
                <span className="text-[9px]" style={{ color: isLocked ? '#f59e0b' : '#9ca3af' }}>Skip</span>
              </button>
            </div>

            {/* Re-run button when locked */}
            {isLocked && (
              <div className="mt-1 flex justify-end">
                <button
                  className="nodrag flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground border border-border hover:border-foreground/40 hover:text-foreground transition-colors bg-card"
                  title="Unlock and re-generate on next run"
                  onClick={handleRerun}
                >
                  <Icons.RotateCcw className="h-2.5 w-2.5" />
                  Re-run
                </button>
              </div>
            )}
          </div>
        )}

        {/* Status / timing */}
        {(isPassed || isFailed) && nodeStatuses[id]?.startedAt && (
          <p className="text-[10px]" style={{ color: '#b4b2a9' }}>
            Received {new Date(nodeStatuses[id].startedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}

        {/* History filmstrip: thumbnails from previous runs */}
        {isGeneration && runHistory.length > 0 && (
          <div className="flex items-center gap-0.5" style={{ marginLeft: -10, marginRight: -10, paddingLeft: 10, paddingRight: 10 }}>
            <span className="mr-0.5 shrink-0 text-[8px]" style={{ color: '#b4b2a9' }}>prev:</span>
            {runHistory.slice(-3).map((entry, i) => (
              <div key={i} className="group/hist relative shrink-0">
                {entry.type === 'video' ? (
                  <video src={assetUrl(entry.localPath)} className="h-8 w-8 rounded-sm object-cover border" style={{ borderColor: spec.accent + '44' }} muted playsInline />
                ) : (
                  <img src={assetUrl(entry.localPath)} alt={`Run ${i + 1}`} draggable={false} className="h-8 w-8 rounded-sm object-cover border" style={{ borderColor: spec.accent + '44' }} />
                )}
                <div className="absolute inset-0 hidden group-hover/hist:flex items-center justify-center rounded-sm bg-black/50">
                  <button className="nodrag" title="Download" onClick={(e) => { e.stopPropagation(); downloadAsset(entry.localPath, makeFilename(data.label as string, entry.localPath)) }}>
                    <Icons.Download className="h-2.5 w-2.5 text-white" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

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
