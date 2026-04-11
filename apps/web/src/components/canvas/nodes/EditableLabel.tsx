import { useState, useRef, useEffect } from 'react'

interface Props {
  value: string
  onSave: (value: string) => void
  color?: string
  className?: string
}

export function EditableLabel({ value, onSave, color, className }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]   = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(value)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing, value])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
          e.stopPropagation()
        }}
        onClick={(e) => e.stopPropagation()}
        className="nodrag nopan min-w-0 flex-1 bg-transparent text-[11px] font-semibold outline-none border-b border-current"
        style={{ color, width: `${Math.max(draft.length, 4)}ch` }}
      />
    )
  }

  return (
    <span
      className={`truncate text-[11px] font-semibold cursor-text ${className ?? ''}`}
      style={{ color }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
      title="Double-click to rename"
    >
      {value}
    </span>
  )
}
