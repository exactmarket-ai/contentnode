import { useEffect, useRef, useState } from 'react'
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
  source:  NODE_SPEC['input'],
  logic:   NODE_SPEC['ai-model'],
  output:  NODE_SPEC['transform'],
  insight: NODE_SPEC['ai-model'],
}

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

// Icons for each category in the collapsed toolbar
const CATEGORY_TOOLBAR_ICONS: Record<string, IconComponent> = {
  source: Icons.Database,
  logic:  Icons.GitBranch,
  output: Icons.Share2,
}

// ─── PaletteItem ──────────────────────────────────────────────────────────────

function PaletteItem({ def, onClick }: { def: PaletteNodeDef; onClick?: () => void }) {
  const spec = CATEGORY_SPEC[def.category]
  const IconComp = (Icons as unknown as Record<string, IconComponent>)[def.icon] ?? Icons.Box

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/contentnode-subtype', def.subtype)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'flex cursor-grab items-start gap-2.5 rounded-md border p-2.5 transition-colors active:cursor-grabbing hover:bg-accent',
        onClick && 'cursor-pointer active:cursor-pointer',
      )}
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

// ─── ClientIndicator ──────────────────────────────────────────────────────────

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

// ─── ClientTemplatesSection ───────────────────────────────────────────────────

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

// ─── NodesPalette (expanded) ──────────────────────────────────────────────────

function NodesPalette() {
  const [search, setSearch] = useState('')
  const addNodeBySubtype = useWorkflowStore((s) => s.addNodeBySubtype)

  const filtered = PALETTE_NODES.filter(
    (n) =>
      n.label.toLowerCase().includes(search.toLowerCase()) ||
      n.description.toLowerCase().includes(search.toLowerCase())
  )

  const byCategory = (cat: NodeCategory) => filtered.filter((n) => n.category === cat)

  return (
    <>
      <ClientIndicator />
      <ClientTemplatesSection />

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
                    <PaletteItem
                      key={def.subtype}
                      def={def}
                      onClick={() => addNodeBySubtype(def.subtype)}
                    />
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

      <div className="border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">Drag or click nodes to add</p>
      </div>
    </>
  )
}

// ─── CollapsedToolbar ─────────────────────────────────────────────────────────

function CollapsedToolbar({ onExpand }: { onExpand: () => void }) {
  const addNodeBySubtype = useWorkflowStore((s) => s.addNodeBySubtype)
  const [openCat, setOpenCat] = useState<NodeCategory | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)

  // Close submenu when clicking outside both toolbar and submenu
  useEffect(() => {
    if (!openCat) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        toolbarRef.current?.contains(target) ||
        submenuRef.current?.contains(target)
      ) return
      setOpenCat(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openCat])

  const categories: NodeCategory[] = ['source', 'logic', 'output']

  return (
    <div ref={toolbarRef} className="relative flex h-full flex-col items-center py-2 gap-1">
      {/* Expand button */}
      <button
        onClick={onExpand}
        title="Expand palette"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icons.PanelLeftOpen className="h-4 w-4" />
      </button>

      <div className="my-1 h-px w-7 bg-border" />

      {/* Category icon buttons */}
      {categories.map((cat) => {
        const CatIcon = CATEGORY_TOOLBAR_ICONS[cat] ?? Icons.Box
        const spec = CATEGORY_SPEC[cat]
        const isOpen = openCat === cat

        return (
          <button
            key={cat}
            title={CATEGORY_LABELS[cat]}
            onClick={() => setOpenCat(isOpen ? null : cat)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
              isOpen
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
            style={isOpen ? { backgroundColor: spec.headerBg, color: spec.accent, border: `1px solid ${spec.headerBorder}` } : {}}
          >
            <CatIcon className="h-4 w-4" />
          </button>
        )
      })}

      {/* Insights button */}
      <button
        title="Insights"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-yellow-500"
      >
        <Icons.Lightbulb className="h-4 w-4" />
      </button>

      {/* Floating submenu */}
      {openCat && (
        <div
          ref={submenuRef}
          className="fixed z-50 min-w-[220px] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
          style={{ left: 52, top: (() => {
            if (!toolbarRef.current) return 80
            const btnIndex = categories.indexOf(openCat)
            const rect = toolbarRef.current.getBoundingClientRect()
            // Approximate: expand button (36) + divider (20) + (btnIndex * 40) + offset
            return rect.top + 68 + btnIndex * 40
          })() }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
            style={{ backgroundColor: CATEGORY_SPEC[openCat].headerBg }}
          >
            {(() => {
              const CatIcon = CATEGORY_TOOLBAR_ICONS[openCat] ?? Icons.Box
              const SubmenuCatIcon = CATEGORY_TOOLBAR_ICONS[openCat] ?? Icons.Box
              return <SubmenuCatIcon className="h-3.5 w-3.5" style={{ color: CATEGORY_SPEC[openCat].accent }} />
            })()}
            <span className="text-xs font-semibold" style={{ color: CATEGORY_SPEC[openCat].badgeText }}>
              {CATEGORY_LABELS[openCat]}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">drag or click</span>
          </div>

          {/* Node list */}
          <div className="max-h-[60vh] overflow-y-auto py-1.5 px-2 space-y-1">
            {PALETTE_NODES.filter((n) => n.category === openCat).map((def) => (
              <PaletteItem
                key={def.subtype}
                def={def}
                onClick={() => {
                  addNodeBySubtype(def.subtype)
                  setOpenCat(null)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── NodePalette (main export) ────────────────────────────────────────────────

type Tab = 'nodes' | 'insights'

export function NodePalette() {
  const [tab, setTab] = useState<Tab>('nodes')
  const [collapsed, setCollapsed] = useState(false)

  // Collapsed icon-bar mode
  if (collapsed) {
    return (
      <div className="flex h-full w-[52px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
        <CollapsedToolbar onExpand={() => setCollapsed(false)} />
      </div>
    )
  }

  // Expanded mode
  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-border bg-card">
      {/* Header with tabs + collapse button */}
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
        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse palette"
          className="flex h-full items-center px-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
        >
          <Icons.PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {tab === 'nodes' ? <NodesPalette /> : <InsightsSidebar />}
    </div>
  )
}
