import { memo, useState, useRef, useEffect } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'
import { getNodeSpec } from '@/lib/nodeColors'
import { EditableLabel } from './EditableLabel'
import { CONTENT_ROLES } from '@/components/layout/config/shared'

const selectStyle: React.CSSProperties = {
  borderColor: '#e0deda',
  color: '#1a1a14',
  backgroundColor: '#fafaf8',
  cursor: 'pointer',
}

export const SourceNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeStatuses = useWorkflowStore((s) => s.nodeRunStatuses)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const hasIncomingEdge = useWorkflowStore((s) => s.edges.some((e) => e.target === id))
  const status = nodeStatuses[id]?.status ?? 'idle'
  const [dropping, setDropping] = useState(false)
  const [uploading, setUploading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const handler = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', handler)
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[data.icon as string] ?? Icons.Box

  const subtype = (data.subtype as string) ?? (data.config as Record<string, unknown>)?.subtype as string
  const isTextInput = subtype === 'text-input'
  const isDocSource = subtype === 'document-source' || subtype === 'file-upload'
  const isTranscription = subtype === 'transcription'
  const isVideoUpload = subtype === 'video-upload'
  const acceptsFiles = isDocSource || isTranscription || isVideoUpload

  const fileKey = isTranscription ? 'audio_files' : isVideoUpload ? 'video_files' : 'uploaded_files'
  const existingConfig = (data.config as Record<string, unknown>) ?? {}
  const fileCount = ((existingConfig[fileKey] as unknown[]) ?? []).length
  const libraryRefs = (existingConfig.library_refs as Array<{ name?: string; label?: string }> | undefined) ?? []

  const spec = getNodeSpec('source', subtype)
  const isRunning = status === 'running'
  const isPassed  = status === 'passed'
  const isFailed  = status === 'failed'

  // Warn if source node has no content configured
  const hasContent = (() => {
    // Integration-based sources fetch from external APIs — no local content needed
    if (subtype === 'wrike_source' || subtype === 'deep_web_scrape' || subtype === 'review_miner' ||
        subtype === 'seo_intent' || subtype === 'audience_signal') return true
    const cfg = (data.config as Record<string, unknown>) ?? {}
    if (cfg.text || cfg.inlineText || cfg.pasted_text) return true
    if (Array.isArray(cfg.uploaded_files) && (cfg.uploaded_files as unknown[]).length > 0) return true
    if (Array.isArray(cfg.audio_files) && (cfg.audio_files as unknown[]).length > 0) return true
    if (Array.isArray(cfg.video_files) && (cfg.video_files as unknown[]).length > 0) return true
    if (Array.isArray(cfg.library_refs) && (cfg.library_refs as unknown[]).length > 0) return true
    if (cfg.documentId) return true
    if (cfg.url) return true  // web-scrape / api-fetch
    if (cfg.raw_text) return true  // instruction-translator
    return false
  })()
  const needsContent = !hasContent && status === 'idle' && !hasIncomingEdge

  const handleDragOver = (e: React.DragEvent) => {
    if (!acceptsFiles || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    setDropping(true)
  }

  const handleDragLeave = () => setDropping(false)

  const handleDrop = async (e: React.DragEvent) => {
    if (!acceptsFiles) return
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    setUploading(true)
    const results: Array<{ id: string; name: string; size: number; storageKey: string; uploaded: boolean }> = []
    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await apiFetch('/api/v1/documents', { method: 'POST', body: fd })
        if (res.ok) {
          const json = await res.json()
          results.push({ id: json.data.id, name: file.name, size: file.size, storageKey: json.data.storageKey, uploaded: true })
        } else {
          results.push({ id: crypto.randomUUID(), name: file.name, size: file.size, storageKey: '', uploaded: false })
        }
      } catch {
        results.push({ id: crypto.randomUUID(), name: file.name, size: file.size, storageKey: '', uploaded: false })
      }
    }
    useWorkflowStore.setState(state => {
      const updatedNodes = state.nodes.map(n => {
        if (n.id !== id) return n
        const cfg = (n.data.config as Record<string, unknown>) ?? {}
        const existing = (cfg[fileKey] as unknown[]) ?? []
        // Video upload: replace (only one video at a time); others: append
        const merged = isVideoUpload ? results.slice(-1) : [...existing, ...results]
        const newCfg = { ...cfg, [fileKey]: merged }
        return { ...n, data: { ...n.data, ...newCfg, config: newCfg } }
      })
      const wfId = state.workflow.id
      if (wfId) {
        const updatedNode = updatedNodes.find(n => n.id === id)
        const cfg = (updatedNode?.data.config as Record<string, unknown>) ?? {}
        const clientId = state.workflow.clientId ?? ''
        apiFetch(`/api/v1/workflows/${wfId}/files/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ clientId, files: { [fileKey]: cfg[fileKey] } }),
        }).catch(() => {})
      }
      return { nodes: updatedNodes }
    })
    setUploading(false)
  }

  // Card border/shadow
  const cardStyle: React.CSSProperties = selected ? {
    border: `2px solid ${spec.accent}`,
    boxShadow: `0 0 0 3px ${spec.activeRing}, 0 0 24px 6px ${spec.activeRing}, 0 8px 32px rgba(0,0,0,0.18)`,
  } : isRunning ? {
    border: `1.5px solid ${spec.accent}`,
    boxShadow: `0 0 20px 4px ${spec.activeRing}`,
  } : isPassed ? {
    border: `1.5px solid ${spec.accent}`,
  } : isFailed ? {
    border: '1.5px solid #ef4444',
  } : dropping ? {
    border: `1.5px solid ${spec.accent}`,
  } : needsContent ? {
    border: '1.5px dashed #f59e0b',
  } : {
    border: '1px solid #e0deda',
  }

  // Header bg/border
  const headerStyle: React.CSSProperties = selected ? {
    backgroundColor: spec.accent,
    borderBottomColor: spec.accent,
  } : {
    backgroundColor: spec.headerBg,
    borderBottomColor: spec.headerBorder,
  }

  const titleColor = selected ? spec.activeTextColor : '#1a1a14'
  const iconColor  = selected ? spec.activeTextColor : spec.accent

  return (
    <div
      className="relative rounded-md bg-white transition-all"
      style={{ ...cardStyle, width: isTextInput ? 380 : 200 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-md border-b px-3 py-2"
        style={headerStyle}
      >
        {/* Spec dot: 7×7px, border-radius 2px */}
        <div
          className="shrink-0"
          style={{
            width: 7, height: 7, borderRadius: 2,
            backgroundColor: selected ? 'rgba(255,255,255,0.7)' : spec.accent,
          }}
        />
        <EditableLabel
          value={data.label as string}
          onSave={(v) => updateNodeData(id, { label: v })}
          color={titleColor}
        />
        {/* Type badge */}
        <span
          className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold"
          style={{ backgroundColor: selected ? 'rgba(255,255,255,0.2)' : spec.badgeBg, color: selected ? spec.activeTextColor : spec.badgeText }}
        >
          {spec.label}
        </span>
        {isRunning && (
          <div className="h-1.5 w-1.5 animate-pulse rounded-full ml-1" style={{ backgroundColor: iconColor }} />
        )}
        {isPassed && <Icons.CheckCircle2 className="ml-1 h-3.5 w-3.5 shrink-0" style={{ color: spec.accent }} />}
        {isFailed && <Icons.XCircle className="ml-1 h-3.5 w-3.5 shrink-0 text-red-500" />}
      </div>

      {/* Body */}
      {isTextInput ? (
        <div>
          {/* Inline textarea — full bleed */}
          <textarea
            ref={textareaRef}
            className="nodrag nopan w-full resize-none border-0 border-b bg-white px-3 py-2.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/50"
            style={{ borderColor: spec.headerBorder, minHeight: 140, display: 'block' }}
            placeholder="Enter text or use {{variable}} templates…"
            value={(existingConfig.text as string) ?? ''}
            onChange={(e) => {
              e.stopPropagation()
              updateNodeData(id, { config: { ...existingConfig, text: e.target.value } })
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {/* Footer row: content role + template indicator */}
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <select
              className="nodrag nopan h-6 flex-1 rounded border text-[10px] px-1 outline-none min-w-0"
              style={selectStyle}
              value={(existingConfig.content_role as string) ?? 'source-material'}
              onChange={(e) => { e.stopPropagation(); updateNodeData(id, { config: { ...existingConfig, content_role: e.target.value } }) }}
              onClick={(e) => e.stopPropagation()}
            >
              {CONTENT_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {(existingConfig.prompt_template_name as string | undefined) && (
              <span className="flex items-center gap-1 text-[9px] truncate shrink-0 max-w-[120px]" style={{ color: '#a200ee' }}>
                <Icons.ScrollText className="h-2.5 w-2.5 shrink-0" />
                {existingConfig.prompt_template_name as string}
              </span>
            )}
            {isPassed && (
              <span className="shrink-0 text-[9px]" style={{ color: '#b4b2a9' }}>
                {nodeStatuses[id]?.startedAt && new Date(nodeStatuses[id].startedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="px-2.5 py-1.5">
          {dropping ? (
            <p className="text-[10px]" style={{ color: spec.accent }}>
              {isVideoUpload ? 'Drop to upload video' : 'Drop to add files'}
            </p>
          ) : uploading ? (
            <p className="flex items-center gap-1 text-[10px]" style={{ color: spec.accent }}>
              <Icons.Loader2 className="h-3 w-3 animate-spin" />Uploading…
            </p>
          ) : acceptsFiles && fileCount > 0 ? (
            <p className="text-[10px]" style={{ color: spec.accent }}>
              {fileCount} file{fileCount !== 1 ? 's' : ''} attached
            </p>
          ) : libraryRefs.length > 0 ? (
            <p className="text-[10px] truncate" style={{ color: spec.accent }}>
              <Icons.Library className="inline h-3 w-3 mr-0.5 shrink-0" />
              {libraryRefs.length === 1
                ? (libraryRefs[0].label ?? libraryRefs[0].name ?? 'Library file')
                : `${libraryRefs.length} library files`}
            </p>
          ) : needsContent ? (
            <p className="flex items-center gap-1 text-[10px] text-amber-600">
              <Icons.AlertTriangle className="h-3 w-3 shrink-0" />
              No content — click to configure
            </p>
          ) : (
            <>
              <p className="text-[10px] leading-[1.4] line-clamp-2" style={{ color: '#6b6a62' }}>
                {data.description as string}
              </p>
              {(existingConfig.prompt_template_name as string | undefined) && (
                <p className="mt-1 flex items-center gap-1 text-[10px] truncate" style={{ color: '#a200ee' }}>
                  <Icons.ScrollText className="h-3 w-3 shrink-0" />
                  {existingConfig.prompt_template_name as string}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Input handle — only for transcription: lets it receive audio/video from upstream */}
      {isTranscription && (
        <Handle type="target" position={Position.Left} id="input" style={{ top: '50%' }} />
      )}

      {/* Output handle */}
      <Handle type="source" position={Position.Right} id="output" style={{ top: '50%' }} />
    </div>
  )
})
SourceNode.displayName = 'SourceNode'
