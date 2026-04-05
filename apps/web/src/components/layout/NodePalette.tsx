import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { PALETTE_NODES, type NodeCategory, type PaletteNodeDef } from '@/store/workflowStore'

const CATEGORY_META: Record<NodeCategory, { label: string; color: string; textColor: string }> = {
  source: { label: 'Source', color: 'bg-emerald-500/10 border-emerald-500/20', textColor: 'text-emerald-400' },
  logic:  { label: 'Logic',  color: 'bg-blue-500/10 border-blue-500/20',       textColor: 'text-blue-400'   },
  output: { label: 'Output', color: 'bg-purple-500/10 border-purple-500/20',   textColor: 'text-purple-400' },
}

function PaletteItem({ def }: { def: PaletteNodeDef }) {
  const meta = CATEGORY_META[def.category]
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[def.icon] ?? Icons.Box

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/contentnode-subtype', def.subtype)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'flex cursor-grab items-start gap-2.5 rounded-md border p-2.5 transition-colors active:cursor-grabbing hover:bg-accent',
        meta.color
      )}
    >
      <div className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded', meta.color)}>
        <IconComp className={cn('h-3.5 w-3.5', meta.textColor)} />
      </div>
      <div className="min-w-0">
        <p className={cn('text-xs font-medium', meta.textColor)}>{def.label}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{def.description}</p>
      </div>
    </div>
  )
}

export function NodePalette() {
  const [search, setSearch] = useState('')

  const filtered = PALETTE_NODES.filter(
    (n) =>
      n.label.toLowerCase().includes(search.toLowerCase()) ||
      n.description.toLowerCase().includes(search.toLowerCase())
  )

  const byCategory = (cat: NodeCategory) => filtered.filter((n) => n.category === cat)

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Icons.Layers className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Nodes</span>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-8"
          />
        </div>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-3 py-3">
          {(['source', 'logic', 'output'] as NodeCategory[]).map((cat) => {
            const items = byCategory(cat)
            if (items.length === 0) return null
            const meta = CATEGORY_META[cat]
            return (
              <div key={cat}>
                <p className={cn('mb-2 text-xs font-semibold uppercase tracking-wider', meta.textColor)}>
                  {meta.label}
                </p>
                <div className="space-y-1.5">
                  {items.map((def) => (
                    <PaletteItem key={def.subtype} def={def} />
                  ))}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">No nodes match "{search}"</p>
          )}
        </div>
      </ScrollArea>

      {/* Footer hint */}
      <div className="border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">Drag nodes onto the canvas</p>
      </div>
    </div>
  )
}
