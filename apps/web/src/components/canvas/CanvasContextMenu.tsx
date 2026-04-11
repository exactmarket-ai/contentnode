import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import * as Icons from 'lucide-react'
import { PALETTE_NODES, type NodeCategory, useWorkflowStore } from '@/store/workflowStore'
import { NODE_SPEC } from '@/lib/nodeColors'
import { cn } from '@/lib/utils'

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  source: 'Source', logic: 'Logic', output: 'Output', insight: 'Insight', canvas: 'Canvas',
}

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

const CATEGORY_ICONS: Record<string, IconComponent> = {
  source: Icons.Database,
  logic:  Icons.GitBranch,
  output: Icons.Share2,
  canvas: Icons.RectangleHorizontal,
}

const CATEGORY_SPEC: Record<NodeCategory, typeof NODE_SPEC[keyof typeof NODE_SPEC]> = {
  source:  NODE_SPEC['input'],
  logic:   NODE_SPEC['ai-model'],
  output:  NODE_SPEC['transform'],
  insight: NODE_SPEC['ai-model'],
  canvas:  NODE_SPEC['input'],
}

const MENU_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  boxShadow: '0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
}

interface Props {
  x: number
  y: number
  onClose: () => void
}

const CATEGORIES: NodeCategory[] = ['source', 'logic', 'output', 'canvas']

export function CanvasContextMenu({ x, y, onClose }: Props) {
  const addNodeBySubtype = useWorkflowStore((s) => s.addNodeBySubtype)
  const menuRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hoveredCat, setHoveredCat] = useState<NodeCategory | null>(null)
  const [flyoutPos, setFlyoutPos] = useState<{ x: number; y: number } | null>(null)
  const [flyoutVisible, setFlyoutVisible] = useState(false)
  const [adjustedPos, setAdjustedPos] = useState({ x, y })

  // Close on outside click (check both menu and flyout)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const inMenu = menuRef.current?.contains(target)
      const inFlyout = flyoutRef.current?.contains(target)
      if (!inMenu && !inFlyout) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Adjust position so menu doesn't overflow the viewport
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

  const handleCatEnter = useCallback((cat: NodeCategory, el: HTMLElement) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    const rect = el.getBoundingClientRect()
    setHoveredCat(cat)
    setFlyoutVisible(false)
    setFlyoutPos({ x: rect.right + 2, y: rect.top })
  }, [])

  // After flyout renders (invisible), measure it and clamp to viewport
  useLayoutEffect(() => {
    if (!flyoutRef.current || !flyoutPos || flyoutVisible) return
    const rect = flyoutRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let { x, y } = flyoutPos
    if (x + rect.width > vw) x = flyoutPos.x - rect.width - 4  // flip left
    if (y + rect.height > vh) y = Math.max(8, vh - rect.height - 8)  // clamp up

    setFlyoutPos({ x, y })
    setFlyoutVisible(true)
  }, [flyoutPos, flyoutVisible])

  const handleCatLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => setHoveredCat(null), 80)
  }, [])

  const handleFlyoutEnter = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
  }, [])

  const handleFlyoutLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => { setHoveredCat(null); setFlyoutVisible(false) }, 80)
  }, [])

  const handleSelect = (subtype: string) => {
    addNodeBySubtype(subtype, { x, y })
    onClose()
  }

  const flyoutNodes = hoveredCat ? PALETTE_NODES.filter((n) => n.category === hoveredCat) : []
  const flyoutSpec = hoveredCat ? CATEGORY_SPEC[hoveredCat] : null
  const FlyoutCatIcon = hoveredCat ? (CATEGORY_ICONS[hoveredCat] ?? Icons.Box) : null

  return createPortal(
    <>
      {/* ── Main menu ──────────────────────────────────────────────────────── */}
      <div
        ref={menuRef}
        className="fixed z-[9999] min-w-[160px] rounded-lg border border-border"
        style={{ ...MENU_STYLE, left: adjustedPos.x, top: adjustedPos.y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="py-1 rounded-lg overflow-hidden">
          {CATEGORIES.map((cat) => {
            const CatIcon = CATEGORY_ICONS[cat] ?? Icons.Box
            const spec = CATEGORY_SPEC[cat]
            const isOpen = hoveredCat === cat

            return (
              <div
                key={cat}
                onMouseEnter={(e) => handleCatEnter(cat, e.currentTarget)}
                onMouseLeave={handleCatLeave}
              >
                <div
                  className={cn(
                    'flex cursor-default items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors select-none',
                    isOpen ? 'bg-accent' : 'hover:bg-accent',
                  )}
                >
                  <div
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                    style={{ backgroundColor: spec.badgeBg, border: `1px solid ${spec.headerBorder}` }}
                  >
                    <CatIcon className="h-3 w-3" style={{ color: spec.accent }} />
                  </div>
                  <span style={{ color: spec.badgeText }}>{CATEGORY_LABELS[cat]}</span>
                  <Icons.ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
            )
          })}
        </div>

        {/* Hint footer */}
        <div className="border-t border-border px-3 py-1.5">
          <p className="text-[10px] text-muted-foreground">Click to add at cursor position</p>
        </div>
      </div>

      {/* ── Flyout submenu ─────────────────────────────────────────────────── */}
      {hoveredCat && flyoutPos && flyoutSpec && FlyoutCatIcon && (
        <div
          ref={flyoutRef}
          className="fixed z-[10000] min-w-[200px] overflow-hidden rounded-lg border border-border"
          style={{ ...MENU_STYLE, left: flyoutPos.x, top: flyoutPos.y, visibility: flyoutVisible ? 'visible' : 'hidden' }}
          onMouseEnter={handleFlyoutEnter}
          onMouseLeave={handleFlyoutLeave}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
            style={{ backgroundColor: flyoutSpec.headerBg }}
          >
            <FlyoutCatIcon className="h-3.5 w-3.5" style={{ color: flyoutSpec.accent }} />
            <span className="text-xs font-semibold" style={{ color: flyoutSpec.badgeText }}>
              {CATEGORY_LABELS[hoveredCat]}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">drag or click</span>
          </div>

          {/* Node list */}
          <div className="py-1">
            {flyoutNodes.map((def) => {
              const Icon = (Icons as unknown as Record<string, IconComponent>)[def.icon] ?? Icons.Box
              return (
                <button
                  key={def.subtype}
                  onClick={() => handleSelect(def.subtype)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                >
                  <div
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                    style={{ backgroundColor: flyoutSpec.badgeBg, border: `1px solid ${flyoutSpec.headerBorder}` }}
                  >
                    <Icon className="h-3 w-3" style={{ color: flyoutSpec.accent }} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium leading-none" style={{ color: flyoutSpec.badgeText }}>{def.label}</p>
                    <p className="mt-0.5 truncate text-muted-foreground">{def.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
