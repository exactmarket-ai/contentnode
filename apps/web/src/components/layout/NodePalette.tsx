import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { PALETTE_NODES, type NodeCategory, type PaletteNodeDef, useWorkflowStore } from '@/store/workflowStore'
import { InsightsSidebar } from '@/components/insights/InsightsSidebar'
import { NODE_SPEC } from '@/lib/nodeColors'
import { apiFetch } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  source: 'Source', logic: 'Logic', output: 'Output', insight: 'Insight',
}

const CATEGORY_SPEC: Record<NodeCategory, typeof NODE_SPEC[keyof typeof NODE_SPEC]> = {
  source:  NODE_SPEC['input'],     // blue
  logic:   NODE_SPEC['ai-model'],  // orange
  output:  NODE_SPEC['transform'], // green
  insight: NODE_SPEC['ai-model'],  // orange (fallback)
}

function PaletteItem({ def }: { def: PaletteNodeDef }) {
  const spec = CATEGORY_SPEC[def.category]
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[def.icon] ?? Icons.Box

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/contentnode-subtype', def.subtype)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex cursor-grab items-start gap-2.5 rounded-md border p-2.5 transition-colors active:cursor-grabbing hover:bg-accent"
      style={{ borderColor: spec.headerBorder, backgroundColor: spec.headerBg }}
    >
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ backgroundColor: spec.badgeBg, border: `1px solid ${spec.headerBorder}` }}
      >
        <IconComp className="h-3.5 w-3.5" style={{ color: spec.accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium" style={{ color: spec.badgeText }}>{def.label}</p>
        <p className="mt-0.5 line-clamp-1 text-xs" style={{ color: '#b4b2a9' }}>{def.description}</p>
      </div>
    </div>
  )
}

function ClientIndicator() {
  const workflow = useWorkflowStore((s) => s.workflow)
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow)
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    apiFetch('/api/v1/clients?status=active')
      .then((r) => r.json())
      .then(({ data }) => setClients(data ?? []))
      .catch(() => {})
  }, [])

  if (clients.length === 0) return null

  const activeClient = clients.find((c) => c.id === workflow.clientId)

  const handleChange = async (value: string) => {
    const newClientId = value === 'none' ? null : value
    setWorkflow({ clientId: newClientId })
    if (workflow.id) {
      apiFetch(`/api/v1/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: newClientId }),
      }).catch(() => {})
    }
  }

  return (
    <div className="px-3 pt-3 pb-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#b4b2a9' }}>Client</p>
      <Select value={workflow.clientId ?? 'none'} onValueChange={handleChange}>
        <SelectTrigger
          className="h-8 w-full text-xs font-medium focus:ring-0 border"
          style={activeClient
            ? { backgroundColor: '#fdf5ff', borderColor: '#a200ee', color: '#7a00b4' }
            : { backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--muted-foreground)' }
          }
        >
          <Icons.Building2 className="h-3 w-3 shrink-0 mr-1" />
          <SelectValue>
            {activeClient ? activeClient.name : 'No client assigned'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none" className="text-xs text-muted-foreground">No client</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ClientTemplatesSection() {
  const workflow = useWorkflowStore((s) => s.workflow)
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    if (!workflow.clientId) { setTemplates([]); return }
    apiFetch(`/api/v1/workflows?clientId=${workflow.clientId}&limit=50`)
      .then((r) => r.json())
      .then(({ data }) => setTemplates(data ?? []))
      .catch(() => {})
  }, [workflow.clientId])

  return (
    <div className="px-3 pt-2 pb-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#b4b2a9' }}>Client Templates</p>
      <Select
        value=""
        onValueChange={(id) => { if (id) navigate(`/workflows/${id}`) }}
        disabled={templates.length === 0}
      >
        <SelectTrigger className="h-8 w-full text-xs focus:ring-0">
          <Icons.LayoutTemplate className="h-3 w-3 shrink-0 mr-1" />
          <SelectValue placeholder={templates.length === 0 ? 'No templates' : 'Load template…'} />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function NodesPalette() {
  const [search, setSearch] = useState('')

  const filtered = PALETTE_NODES.filter(
    (n) =>
      n.label.toLowerCase().includes(search.toLowerCase()) ||
      n.description.toLowerCase().includes(search.toLowerCase())
  )

  const byCategory = (cat: NodeCategory) => filtered.filter((n) => n.category === cat)

  return (
    <>
      {/* Client indicator */}
      <ClientIndicator />

      {/* Client templates */}
      <ClientTemplatesSection />

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

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 px-3 py-3">
          {(['source', 'logic', 'output'] as NodeCategory[]).map((cat) => {
            const items = byCategory(cat)
            if (items.length === 0) return null
            return (
              <div key={cat}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#b4b2a9' }}>
                  {CATEGORY_LABELS[cat]}
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
    </>
  )
}

type Tab = 'nodes' | 'insights'

export function NodePalette() {
  const [tab, setTab] = useState<Tab>('nodes')

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
      {/* Header with tabs */}
      <div className="flex items-center border-b border-border">
        <button
          onClick={() => setTab('nodes')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors',
            tab === 'nodes'
              ? 'text-foreground border-b-2 border-foreground'
              : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'
          )}
        >
          <Icons.Layers className="h-3.5 w-3.5" />
          Nodes
        </button>
        <button
          onClick={() => setTab('insights')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors',
            tab === 'insights'
              ? 'text-yellow-600 border-b-2 border-yellow-500'
              : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'
          )}
        >
          <Icons.Lightbulb className="h-3.5 w-3.5" />
          Insights
        </button>
      </div>

      {tab === 'nodes' ? <NodesPalette /> : <InsightsSidebar />}
    </div>
  )
}
