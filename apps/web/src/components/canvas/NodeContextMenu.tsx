import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Icons from 'lucide-react'
import { PALETTE_NODES, useWorkflowStore } from '@/store/workflowStore'
import { triggerRun } from '@/lib/runWorkflow'

const ITEM_CLS = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100'

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

  const isGroup = subtype === 'group'
  const def = PALETTE_NODES.find((n) => n.subtype === subtype)
  const canRunToHere = !isGroup && !def?.requiresManualInput

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

  const handleDuplicate = () => {
    useWorkflowStore.getState().duplicateNodes([nodeId])
    onClose()
  }

  const handleUngroup = () => {
    useWorkflowStore.getState().ungroupNode(nodeId)
    onClose()
  }

  const handleRunToHere = async () => {
    onClose()
    if (runStatus === 'running') return
    await triggerRun(nodeId)
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-lg border"
      style={{
        left: adjustedPos.x,
        top: adjustedPos.y,
        backgroundColor: '#ffffff',
        borderColor: '#e5e7eb',
        boxShadow: '0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
        color: '#111827',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="py-1">
        {/* Duplicate — always shown */}
        <button onClick={handleDuplicate} className={ITEM_CLS}>
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: '#eff6ff', border: '1px solid #93c5fd' }}
          >
            <Icons.Copy className="h-3 w-3" style={{ color: '#2563eb' }} />
          </div>
          <div>
            <p className="font-medium text-xs leading-none" style={{ color: '#111827' }}>Duplicate</p>
            <p className="mt-0.5 text-[11px]" style={{ color: '#6b7280' }}>Copy node with offset (Cmd+D)</p>
          </div>
        </button>

        {/* Ungroup — groups only */}
        {isGroup && (
          <button onClick={handleUngroup} className={ITEM_CLS}>
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
              style={{ backgroundColor: '#fdf5ff', border: '1px solid #e9b8ff' }}
            >
              <Icons.Ungroup className="h-3 w-3" style={{ color: '#a200ee' }} />
            </div>
            <div>
              <p className="font-medium text-xs leading-none" style={{ color: '#111827' }}>Ungroup</p>
              <p className="mt-0.5 text-[11px]" style={{ color: '#6b7280' }}>Release nodes and remove frame</p>
            </div>
          </button>
        )}

        {/* Run to here — non-group nodes only */}
        {canRunToHere && (
          <button onClick={handleRunToHere} disabled={runStatus === 'running'} className={ITEM_CLS + ' disabled:opacity-40 disabled:cursor-not-allowed'}>
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
              style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}
            >
              <Icons.Play className="h-3 w-3" style={{ color: '#16a34a' }} />
            </div>
            <div>
              <p className="font-medium text-xs leading-none" style={{ color: '#111827' }}>Run to here</p>
              <p className="mt-0.5 text-[11px]" style={{ color: '#6b7280' }}>Run ancestors + stop at this node</p>
            </div>
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
