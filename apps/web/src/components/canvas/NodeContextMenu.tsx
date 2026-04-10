import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Icons from 'lucide-react'
import { PALETTE_NODES, useWorkflowStore } from '@/store/workflowStore'
import { triggerRun } from '@/lib/runWorkflow'

const MENU_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  boxShadow: '0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
}

interface Props {
  nodeId: string
  subtype: string
  x: number
  y: number
  onClose: () => void
}

export function NodeContextMenu({ nodeId, subtype, x, y, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x, y })
  const runStatus = useWorkflowStore((s) => s.runStatus)

  const def = PALETTE_NODES.find((n) => n.subtype === subtype)
  const canRunToHere = !def?.requiresManualInput

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Keep menu inside viewport
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let nx = x
    let ny = y
    if (x + rect.width > vw) nx = vw - rect.width - 8
    if (y + rect.height > vh) ny = vh - rect.height - 8
    if (nx !== x || ny !== y) setAdjustedPos({ x: nx, y: ny })
  }, [x, y])

  if (!canRunToHere) return null

  const handleRunToHere = async () => {
    onClose()
    if (runStatus === 'running') return
    await triggerRun(nodeId)
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] overflow-hidden rounded-lg border border-border"
      style={{ ...MENU_STYLE, left: adjustedPos.x, top: adjustedPos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="py-1">
        <button
          onClick={handleRunToHere}
          disabled={runStatus === 'running'}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}
          >
            <Icons.Play className="h-3 w-3" style={{ color: '#16a34a' }} />
          </div>
          <div>
            <p className="font-medium text-foreground leading-none">Run to here</p>
            <p className="mt-0.5 text-muted-foreground">Run ancestors + stop at this node</p>
          </div>
        </button>
      </div>
    </div>,
    document.body
  )
}
