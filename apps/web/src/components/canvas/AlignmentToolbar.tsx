import * as Icons from 'lucide-react'
import { type Node } from 'reactflow'
import { useWorkflowStore } from '@/store/workflowStore'
import { cn } from '@/lib/utils'

// ─── Alignment math ───────────────────────────────────────────────────────────

type Op =
  | 'align-left' | 'align-center-h' | 'align-right'
  | 'align-top'  | 'align-middle-v' | 'align-bottom'
  | 'distribute-h' | 'distribute-v'

function w(n: Node) { return n.width  ?? 160 }
function h(n: Node) { return n.height ?? 80  }

function applyOp(nodes: Node[], selected: Node[], op: Op): Node[] {
  if (selected.length < 2) return nodes
  const patch = new Map<string, Node>()

  switch (op) {
    case 'align-left': {
      const minX = Math.min(...selected.map((n) => n.position.x))
      selected.forEach((n) => patch.set(n.id, { ...n, position: { ...n.position, x: minX } }))
      break
    }
    case 'align-center-h': {
      const avg = selected.reduce((s, n) => s + n.position.x + w(n) / 2, 0) / selected.length
      selected.forEach((n) => patch.set(n.id, { ...n, position: { ...n.position, x: avg - w(n) / 2 } }))
      break
    }
    case 'align-right': {
      const maxR = Math.max(...selected.map((n) => n.position.x + w(n)))
      selected.forEach((n) => patch.set(n.id, { ...n, position: { ...n.position, x: maxR - w(n) } }))
      break
    }
    case 'align-top': {
      const minY = Math.min(...selected.map((n) => n.position.y))
      selected.forEach((n) => patch.set(n.id, { ...n, position: { ...n.position, y: minY } }))
      break
    }
    case 'align-middle-v': {
      const avg = selected.reduce((s, n) => s + n.position.y + h(n) / 2, 0) / selected.length
      selected.forEach((n) => patch.set(n.id, { ...n, position: { ...n.position, y: avg - h(n) / 2 } }))
      break
    }
    case 'align-bottom': {
      const maxB = Math.max(...selected.map((n) => n.position.y + h(n)))
      selected.forEach((n) => patch.set(n.id, { ...n, position: { ...n.position, y: maxB - h(n) } }))
      break
    }
    case 'distribute-h': {
      const sorted = [...selected].sort((a, b) => a.position.x - b.position.x)
      const span    = sorted[sorted.length - 1].position.x + w(sorted[sorted.length - 1]) - sorted[0].position.x
      const total   = sorted.reduce((s, n) => s + w(n), 0)
      const gap     = (span - total) / (sorted.length - 1)
      let cur = sorted[0].position.x
      sorted.forEach((n) => {
        patch.set(n.id, { ...n, position: { ...n.position, x: cur } })
        cur += w(n) + gap
      })
      break
    }
    case 'distribute-v': {
      const sorted = [...selected].sort((a, b) => a.position.y - b.position.y)
      const span    = sorted[sorted.length - 1].position.y + h(sorted[sorted.length - 1]) - sorted[0].position.y
      const total   = sorted.reduce((s, n) => s + h(n), 0)
      const gap     = (span - total) / (sorted.length - 1)
      let cur = sorted[0].position.y
      sorted.forEach((n) => {
        patch.set(n.id, { ...n, position: { ...n.position, y: cur } })
        cur += h(n) + gap
      })
      break
    }
  }

  return nodes.map((n) => patch.get(n.id) ?? n)
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

interface BtnDef { op: Op; Icon: React.ComponentType<{ className?: string }>; title: string }

const H_BTNS: BtnDef[] = [
  { op: 'align-left',     Icon: Icons.AlignStartVertical,              title: 'Align left edges'         },
  { op: 'align-center-h', Icon: Icons.AlignCenterVertical,             title: 'Align centers (H)'        },
  { op: 'align-right',    Icon: Icons.AlignEndVertical,                title: 'Align right edges'        },
  { op: 'distribute-h',   Icon: Icons.AlignHorizontalDistributeCenter, title: 'Distribute horizontally'  },
]

const V_BTNS: BtnDef[] = [
  { op: 'align-top',      Icon: Icons.AlignStartHorizontal,            title: 'Align top edges'          },
  { op: 'align-middle-v', Icon: Icons.AlignCenterHorizontal,           title: 'Align middles (V)'        },
  { op: 'align-bottom',   Icon: Icons.AlignEndHorizontal,              title: 'Align bottom edges'       },
  { op: 'distribute-v',   Icon: Icons.AlignVerticalDistributeCenter,   title: 'Distribute vertically'    },
]

interface Props { workflowName?: string }

export function AlignmentToolbar({ workflowName }: Props) {
  const nodes              = useWorkflowStore((s) => s.nodes)
  const groupSelectedNodes = useWorkflowStore((s) => s.groupSelectedNodes)
  const ungroupNode        = useWorkflowStore((s) => s.ungroupNode)
  const selected           = nodes.filter((n) => n.selected)

  // ── Single group selected → Ungroup ────────────────────────────────────────
  if (selected.length === 1 && selected[0].type === 'group') {
    return (
      <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 shadow-lg">
        <button
          title="Remove group frame and release nodes"
          onClick={() => ungroupNode(selected[0].id)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icons.Ungroup className="h-3.5 w-3.5" />
          Ungroup
        </button>
      </div>
    )
  }

  // ── Fewer than 2 selected → workflow name pill ──────────────────────────────
  if (selected.length < 2) {
    if (!workflowName) return null
    return (
      <div className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        {workflowName}
      </div>
    )
  }

  // ── 2+ selected → alignment toolbar + optional Group button ────────────────
  const run = (op: Op) => {
    const next = applyOp(nodes, selected, op)
    useWorkflowStore.setState({ nodes: next })
  }

  const selectedNonGroup = selected.filter((n) => n.type !== 'group')
  const canGroup = selectedNonGroup.length >= 2

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1.5 shadow-lg">
      {/* Horizontal alignment */}
      <div className="flex items-center gap-0.5">
        {H_BTNS.map(({ op, Icon, title }) => (
          <button
            key={op}
            title={title}
            onClick={() => run(op)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Vertical alignment */}
      <div className="flex items-center gap-0.5">
        {V_BTNS.map(({ op, Icon, title }) => (
          <button
            key={op}
            title={title}
            onClick={() => run(op)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Selection count */}
      <span className="pl-1 pr-1 text-[11px] tabular-nums text-muted-foreground">
        {selected.length} selected
      </span>

      {/* Group button — only when 2+ non-group nodes are selected */}
      {canGroup && (
        <>
          <div className="h-4 w-px bg-border" />
          <button
            title="Wrap selected nodes in a group frame"
            onClick={groupSelectedNodes}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
            style={{ color: '#a200ee' }}
          >
            <Icons.Group className="h-3.5 w-3.5" />
            Group
          </button>
        </>
      )}
    </div>
  )
}
