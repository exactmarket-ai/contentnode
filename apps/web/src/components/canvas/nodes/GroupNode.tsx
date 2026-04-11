import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from 'reactflow'
import { useWorkflowStore } from '@/store/workflowStore'

export const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const label = (data.label as string) ?? 'Group'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(label) }, [label])

  const commitLabel = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim() || 'Group'
    if (trimmed !== label) updateNodeData(id, { label: trimmed })
  }, [draft, label, id, updateNodeData])

  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={100}
        isVisible={selected}
        lineStyle={{ borderColor: 'rgba(162,0,238,0.4)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, backgroundColor: '#e9b8ff', borderColor: '#a200ee' }}
      />

      {/* Purple background fill */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(162,0,238,0.06)',
          border: `1.5px ${selected ? 'solid' : 'dashed'} rgba(162,0,238,${selected ? '0.45' : '0.25'})`,
          borderRadius: 8,
          pointerEvents: 'none',
        }}
      />

      {/* Label bar */}
      <div
        className="nodrag"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 28,
          background: 'rgba(162,0,238,0.10)',
          borderBottom: '1px solid rgba(162,0,238,0.2)',
          borderRadius: '6px 6px 0 0',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 10,
          cursor: 'text',
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
            className="w-full bg-transparent text-xs font-semibold outline-none"
            style={{ color: '#7a00b4', caretColor: '#a200ee' }}
          />
        ) : (
          <span
            className="select-none truncate text-xs font-semibold"
            style={{ color: 'rgba(122,0,180,0.8)' }}
            title="Double-click to rename"
          >
            {label}
          </span>
        )}
      </div>
    </>
  )
})

GroupNode.displayName = 'GroupNode'
