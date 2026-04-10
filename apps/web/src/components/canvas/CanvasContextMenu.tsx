import { useEffect, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { PALETTE_NODES, type NodeCategory, useWorkflowStore } from '@/store/workflowStore'
import { NODE_SPEC } from '@/lib/nodeColors'
import { cn } from '@/lib/utils'

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  source: 'Source', logic: 'Logic', output: 'Output', insight: 'Insight',
}

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

const CATEGORY_ICONS: Record<string, IconComponent> = {
  source: Icons.Database,
  logic:  Icons.GitBranch,
  output: Icons.Share2,
}

const CATEGORY_SPEC: Record<NodeCategory, typeof NODE_SPEC[keyof typeof NODE_SPEC]> = {
  source:  NODE_SPEC['input'],
  logic:   NODE_SPEC['ai-model'],
  output:  NODE_SPEC['transform'],
  insight: NODE_SPEC['ai-model'],
}

interface Props {
  x: number
  y: number
  onClose: () => void
}

const CATEGORIES: NodeCategory[] = ['source', 'logic', 'output']

export function CanvasContextMenu({ x, y, onClose }: Props) {
  const addNodeBySubtype = useWorkflowStore((s) => s.addNodeBySubtype)
  const menuRef = useRef<HTMLDivElement>(null)
  const [hoveredCat, setHoveredCat] = useState<NodeCategory | null>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x, y })

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
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

  const handleSelect = (subtype: string) => {
    addNodeBySubtype(subtype, { x, y })
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[999] min-w-[160px] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="py-1">
        {CATEGORIES.map((cat) => {
          const nodes = PALETTE_NODES.filter((n) => n.category === cat)
          const CatIcon = CATEGORY_ICONS[cat] ?? Icons.Box
          const spec = CATEGORY_SPEC[cat]
          const isHovered = hoveredCat === cat

          return (
            <div
              key={cat}
              className="relative"
              onMouseEnter={() => setHoveredCat(cat)}
              onMouseLeave={() => setHoveredCat(null)}
            >
              {/* Category row */}
              <div
                className={cn(
                  'flex cursor-default items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors select-none',
                  isHovered ? 'bg-accent' : 'hover:bg-accent',
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

              {/* Flyout submenu */}
              {isHovered && (
                <div
                  className="absolute left-full top-0 z-[1000] min-w-[200px] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
                  style={{ marginLeft: 2 }}
                >
                  <div className="py-1">
                    {nodes.map((def) => {
                      const Icon = (Icons as unknown as Record<string, IconComponent>)[def.icon] ?? Icons.Box
                      return (
                        <button
                          key={def.subtype}
                          onClick={() => handleSelect(def.subtype)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                        >
                          <div
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                            style={{ backgroundColor: spec.badgeBg, border: `1px solid ${spec.headerBorder}` }}
                          >
                            <Icon className="h-3 w-3" style={{ color: spec.accent }} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium leading-none" style={{ color: spec.badgeText }}>{def.label}</p>
                            <p className="mt-0.5 truncate text-muted-foreground">{def.description}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Hint footer */}
      <div className="border-t border-border px-3 py-1.5">
        <p className="text-[10px] text-muted-foreground">Click to add at cursor position</p>
      </div>
    </div>
  )
}
