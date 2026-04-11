import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from 'reactflow'
import { useWorkflowStore } from '@/store/workflowStore'

export const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const label = (data.label as string) ?? 'Group'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync draft when label changes externally
  useEffect(() => { setDraft(label) }, [label])

  const commitLabel = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim() || 'Group'
    if (trimmed !== label) updateNodeData(id, { label: trimmed })
  }, [draft, label, id, updateNodeData])

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={120}
        isVisible={selected}
        lineStyle={{ borderColor: 'rgba(147,197,253,0.6)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#93c5fd', borderColor: '#3b82f6' }}
      />

      {/* Label bar at top */}
      <div
        className="nodrag absolute left-0 top-0 right-0 flex h-7 items-center px-2.5"
        style={{
          background: 'rgba(59,130,246,0.12)',
          borderBottom: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '6px 6px 0 0',
        }}
        onDoubleClick={() => { setEditing(true); setTimeout(() => inputRef.current?.select(), 10) }}
      >
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel()
              if (e.key === 'Escape') { setDraft(label); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-xs font-semibold text-blue-300 outline-none placeholder:text-blue-300/50"
            style={{ caretColor: '#93c5fd' }}
          />
        ) : (
          <span className="select-none truncate text-xs font-semibold" style={{ color: 'rgba(147,197,253,0.9)' }}>
            {label}
          </span>
        )}
      </div>
    </>
  )
})

GroupNode.displayName = 'GroupNode'
