import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { PALETTE_NODES, OFFLINE_COMPATIBLE_SUBTYPES, type NodeCategory, type PaletteNodeDef, useWorkflowStore } from '@/store/workflowStore'
import { InsightsSidebar } from '@/components/insights/InsightsSidebar'
import { NODE_SPEC, getNodeSpec } from '@/lib/nodeColors'
import { apiFetch } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ─── Node usage tracking (localStorage, per browser) ─────────────────────────

const USAGE_KEY = 'contentnode:nodeUsage'
const FREQUENT_THRESHOLD = 3
const FREQUENT_MAX = 5

function readUsage(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}') } catch { return {} }
}

function incrementUsage(subtype: string) {
  const usage = readUsage()
  usage[subtype] = (usage[subtype] ?? 0) + 1
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)) } catch { /* ignore */ }
}

function useNodeUsage() {
  const [usage, setUsage] = useState<Record<string, number>>(readUsage)
  const track = useCallback((subtype: string) => {
    incrementUsage(subtype)
    setUsage(readUsage())
  }, [])
  return { usage, track }
}

// Sort palette nodes alphabetically within a category
const sortedByLabel = (nodes: PaletteNodeDef[]) =>
  [...nodes].sort((a, b) => a.label.localeCompare(b.label))

// Category display order — Output listed after Media
const CATEGORY_ORDER: NodeCategory[] = ['source', 'logic', 'media', 'video', 'output']

// Number of nodes shown when a category section is collapsed
const COLLAPSED_PREVIEW = 3

// Persist collapsed state across sessions
const COLLAPSED_KEY = 'contentnode:collapsedCats'
function readCollapsed(): Set<NodeCategory> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')) } catch { return new Set() }
}
function writeCollapsed(cats: Set<NodeCategory>) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...cats])) } catch { /* ignore */ }
}

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  source: 'Source', logic: 'Logic', output: 'Output', media: 'Media', video: 'Video', insight: 'Insight', canvas: 'Canvas',
}

const CATEGORY_SPEC: Record<NodeCategory, typeof NODE_SPEC[keyof typeof NODE_SPEC]> = {
  source:  NODE_SPEC['input'],
  logic:   NODE_SPEC['ai-model'],
  output:  NODE_SPEC['transform'],
  media:   NODE_SPEC['media'],
  video:   NODE_SPEC['media'],
  insight: NODE_SPEC['ai-model'],
  canvas:  NODE_SPEC['input'],
}

type IconComponent = React.ComponentType<{ className?: string; style?: React.CSSProperties }>

// Icons for each category in the collapsed toolbar
const CATEGORY_TOOLBAR_ICONS: Record<string, IconComponent> = {
  source: Icons.Database,
  logic:  Icons.GitBranch,
  output: Icons.Share2,
  media:  Icons.Film,
  video:  Icons.Clapperboard,
}

// ─── PaletteItem ──────────────────────────────────────────────────────────────

function PaletteItem({ def, onClick, onTrack }: { def: PaletteNodeDef; onClick?: () => void; onTrack?: (s: string) => void }) {
  const spec = getNodeSpec(def.type ?? def.category, def.subtype)
  const IconComp = (Icons as unknown as Record<string, IconComponent>)[def.icon] ?? Icons.Box

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/contentnode-subtype', def.subtype)
    e.dataTransfer.effectAllowed = 'move'
    onTrack?.(def.subtype)
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={() => { onTrack?.(def.subtype); onClick?.() }}
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

// ─── ProjectIndicator ────────────────────────────────────────────────────────

type MondayItem = { id: string; name: string; column_values?: { id: string; url?: string; text?: string; value?: string; column?: { title: string } }[] }

function parseFolderId(input: string): string {
  const match = input.match(/\/folder\/(\d+)/)
  if (match) return match[1]
  if (/^\d+$/.test(input.trim())) return input.trim()
  return ''
}

function getBoxUrlFromCol(cv: { url?: string; text?: string; value?: string }): string {
  if (cv.url?.includes('box.com')) return cv.url
  if (cv.text?.includes('box.com')) return cv.text
  try {
    const parsed = JSON.parse(cv.value ?? '')
    if (typeof parsed?.url === 'string' && parsed.url.includes('box.com')) return parsed.url
  } catch {}
  return ''
}

function ProjectIndicator() {
  const workflow = useWorkflowStore((s) => s.workflow)
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow)
  const [mondayItems, setMondayItems] = useState<MondayItem[]>([])
  const [boardId, setBoardId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [boxUrl, setBoxUrl] = useState('')
  const [noBoxWarning, setNoBoxWarning] = useState(false)
  const [gdriveUrl, setGdriveUrl] = useState('')
  const [subitems, setSubitems] = useState<Array<{ id: string; name: string; boardId: string }>>([])
  const [subitemsLoading, setSubitemsLoading] = useState(false)

  // Fetch client's mondayBoardId when client changes
  useEffect(() => {
    setBoardId(null)
    setMondayItems([])
    if (!workflow.clientId) return
    apiFetch(`/api/v1/clients/${workflow.clientId}`)
      .then((r) => r.json())
      .then(({ data }) => {
        const bid = data?.mondayBoardId ?? null
        setBoardId(bid)
        setWorkflow({ clientMondayBoardId: bid })
      })
      .catch(() => {})
  }, [workflow.clientId])

  // Load Monday items when board is known
  useEffect(() => {
    setMondayItems([])
    if (!boardId) return
    setLoading(true)
    apiFetch(`/api/v1/integrations/monday/boards/${boardId}/items`)
      .then((r) => r.json())
      .then(({ data }) => setMondayItems(data?.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [boardId])

  // Sync boxUrl from store on mount/change
  useEffect(() => {
    const id = workflow.boxProjectFolderId ?? ''
    if (!id) { setBoxUrl(''); return }
    if (/^\d+$/.test(id.trim())) setBoxUrl(`https://app.box.com/folder/${id}`)
    else if (id.includes('box.com/folder/')) setBoxUrl(id)
    else setBoxUrl('')
  }, [workflow.boxProjectFolderId])

  // Sync Google Drive folder URL from store on mount/change
  useEffect(() => {
    const id = workflow.googleDriveProjectFolderId ?? ''
    if (!id) { setGdriveUrl(''); return }
    if (id.includes('drive.google.com')) setGdriveUrl(id)
    else setGdriveUrl(`https://drive.google.com/drive/folders/${id}`)
  }, [workflow.googleDriveProjectFolderId])

  const saveProject = (mondayGroupId: string | null, mondayGroupName: string | null, folderId: string | null) => {
    setWorkflow({ mondayGroupId, mondayGroupName, boxProjectFolderId: folderId })
    const wfId = useWorkflowStore.getState().workflow.id
    if (wfId) {
      apiFetch(`/api/v1/workflows/${wfId}`, {
        method: 'PATCH',
        body: JSON.stringify({ mondayGroupId, mondayGroupName, boxProjectFolderId: folderId }),
      }).catch(() => {})
    }
  }

  // Load subitems when project changes
  useEffect(() => {
    setSubitems([])
    setWorkflow({ mondaySubItemId: null, mondaySubItemName: null, mondaySubItemBoardId: null })
    if (!workflow.mondayGroupId) return
    setSubitemsLoading(true)
    apiFetch(`/api/v1/integrations/monday/items/${workflow.mondayGroupId}/subitems`)
      .then((r) => r.json())
      .then(({ data }) => setSubitems((data ?? []).map((s: { id: string; name: string; board: { id: string } }) => ({ id: s.id, name: s.name, boardId: s.board.id }))))
      .catch(() => {})
      .finally(() => setSubitemsLoading(false))
  }, [workflow.mondayGroupId])

  const handleProjectChange = (value: string) => {
    setNoBoxWarning(false)
    if (value === '__none__') {
      setBoxUrl('')
      saveProject(null, null, null)
      return
    }
    const item = mondayItems.find((i) => i.id === value)
    const cols = item?.column_values ?? []
    const clientFolderCol = cols.find((cv) => cv.column?.title?.toLowerCase() === 'client folder - box')
    const clientFolderUrl = clientFolderCol ? getBoxUrlFromCol(clientFolderCol) : ''
    const folderUrl = clientFolderUrl?.includes('box.com/folder/')
      ? clientFolderUrl
      : cols.map(getBoxUrlFromCol).find((u) => u.includes('box.com/folder/')) || ''
    const url = folderUrl || clientFolderUrl || ''
    if (url) {
      setBoxUrl(url)
      saveProject(value, item?.name ?? null, parseFolderId(url))
    } else {
      setBoxUrl('')
      setNoBoxWarning(true)
      saveProject(value, item?.name ?? null, null)
    }
  }

  const handleBoxUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setBoxUrl(val)
    setNoBoxWarning(false)
    const folderId = parseFolderId(val) || null
    const wfId = useWorkflowStore.getState().workflow.id
    setWorkflow({ boxProjectFolderId: folderId })
    if (wfId) {
      apiFetch(`/api/v1/workflows/${wfId}`, {
        method: 'PATCH',
        body: JSON.stringify({ boxProjectFolderId: folderId }),
      }).catch(() => {})
    }
  }

  const parseGdriveFolderId = (url: string): string => {
    const m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)
    if (m) return m[1]
    if (/^[a-zA-Z0-9_-]{25,}$/.test(url.trim())) return url.trim()
    return ''
  }

  const handleGdriveUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setGdriveUrl(val)
    const folderId = parseGdriveFolderId(val) || null
    const wfId = useWorkflowStore.getState().workflow.id
    setWorkflow({ googleDriveProjectFolderId: folderId })
    if (wfId) {
      apiFetch(`/api/v1/workflows/${wfId}`, {
        method: 'PATCH',
        body: JSON.stringify({ googleDriveProjectFolderId: folderId }),
      }).catch(() => {})
    }
  }

  if (!workflow.clientId) return null

  const parsedId = parseFolderId(boxUrl)
  const boxValid = boxUrl === '' || parsedId !== ''

  return (
    <div className="px-3 pt-1 pb-2 space-y-2">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#b4b2a9' }}>Project</p>
        {!boardId ? (
          <p className="text-[10px] text-muted-foreground italic">No Monday board on this client.</p>
        ) : loading ? (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Icons.Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : (
          <Select value={workflow.mondayGroupId ?? '__none__'} onValueChange={handleProjectChange}>
            <SelectTrigger
              className="h-8 w-full text-xs font-medium focus:ring-0 border"
              style={workflow.mondayGroupId
                ? { backgroundColor: '#f0f7ff', borderColor: '#0ea5e9', color: '#0369a1' }
                : { backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--muted-foreground)' }
              }
            >
              <Icons.FolderKanban className="h-3 w-3 shrink-0 mr-1" />
              <SelectValue>{workflow.mondayGroupName ?? 'No project'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-muted-foreground">— No project —</SelectItem>
              {mondayItems.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-xs">{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Sub Project — shown when a project is selected and has subitems */}
      {workflow.mondayGroupId && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#b4b2a9' }}>Sub Project</p>
          {subitemsLoading ? (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Icons.Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : subitems.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">No subitems on this project.</p>
          ) : (
            <Select
              value={workflow.mondaySubItemId ?? '__none__'}
              onValueChange={(value) => {
                if (value === '__none__') {
                  setWorkflow({ mondaySubItemId: null, mondaySubItemName: null, mondaySubItemBoardId: null })
                  return
                }
                const sub = subitems.find((s) => s.id === value)
                setWorkflow({ mondaySubItemId: value, mondaySubItemName: sub?.name ?? null, mondaySubItemBoardId: sub?.boardId ?? null })
              }}
            >
              <SelectTrigger
                className="h-8 w-full text-xs font-medium focus:ring-0 border"
                style={workflow.mondaySubItemId
                  ? { backgroundColor: '#f0fff4', borderColor: '#22c55e', color: '#15803d' }
                  : { backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--muted-foreground)' }
                }
              >
                <Icons.GitBranch className="h-3 w-3 shrink-0 mr-1" />
                <SelectValue>{workflow.mondaySubItemName ?? 'No sub project'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">— No sub project —</SelectItem>
                {subitems.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Box folder URL — shown when a project is selected or manually set */}
      {(workflow.mondayGroupId || boxUrl) && (
        <div>
          <input
            type="text"
            className={`w-full rounded-md border px-2.5 py-1 text-[11px] outline-none focus:ring-1 ${
              boxValid ? 'border-border focus:ring-ring' : 'border-red-400 focus:ring-red-400'
            }`}
            placeholder="https://app.box.com/folder/…"
            value={boxUrl}
            onChange={handleBoxUrlChange}
          />
          {!boxValid && boxUrl.includes('box.com/file/') && (
            <p className="text-[10px] text-red-500 mt-0.5">File link — needs a Box <em>folder</em> URL.</p>
          )}
          {!boxValid && !boxUrl.includes('box.com/file/') && (
            <p className="text-[10px] text-red-500 mt-0.5">Paste a Box folder URL or numeric ID.</p>
          )}
          {noBoxWarning && (
            <p className="text-[10px] text-amber-600 mt-0.5">No Box folder on this Monday item — paste one above.</p>
          )}
        </div>
      )}

      {/* Google Drive project folder — always shown so it can be set independently of Box */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: '#b4b2a9' }}>Google Drive Folder</p>
        <input
          type="text"
          className="w-full rounded-md border border-border px-2.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          placeholder="https://drive.google.com/drive/folders/…"
          value={gdriveUrl}
          onChange={handleGdriveUrlChange}
        />
        {gdriveUrl && !parseGdriveFolderId(gdriveUrl) && (
          <p className="text-[10px] text-red-500 mt-0.5">Paste a Google Drive folder URL or folder ID.</p>
        )}
      </div>
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
  const [collapsedCats, setCollapsedCats] = useState<Set<NodeCategory>>(readCollapsed)
  const addNodeBySubtype = useWorkflowStore((s) => s.addNodeBySubtype)
  const connectivityMode = useWorkflowStore((s) => s.workflow.connectivity_mode)
  const isOffline = connectivityMode === 'offline'
  const { usage, track } = useNodeUsage()

  const toggleCat = useCallback((cat: NodeCategory) => {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) { next.delete(cat) } else { next.add(cat) }
      writeCollapsed(next)
      return next
    })
  }, [])

  const availableNodes = isOffline
    ? PALETTE_NODES.filter((n) => OFFLINE_COMPATIBLE_SUBTYPES.has(n.subtype))
    : PALETTE_NODES

  const filtered = availableNodes.filter(
    (n) =>
      n.label.toLowerCase().includes(search.toLowerCase()) ||
      n.description.toLowerCase().includes(search.toLowerCase())
  )

  const byCategory = (cat: NodeCategory) =>
    sortedByLabel(filtered.filter((n) => n.category === cat))

  // Frequently used: used ≥ threshold times, sorted by count desc, capped
  const frequent = !search
    ? availableNodes
        .filter((n) => (usage[n.subtype] ?? 0) >= FREQUENT_THRESHOLD)
        .sort((a, b) => (usage[b.subtype] ?? 0) - (usage[a.subtype] ?? 0))
        .slice(0, FREQUENT_MAX)
    : []

  return (
    <>
      {isOffline && (
        <div className="flex items-center gap-2 border-b border-amber-200/60 bg-amber-50/80 px-3 py-2">
          <Icons.WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="text-[11px] font-medium text-amber-700 leading-tight">
            Offline mode — only local nodes available
          </span>
        </div>
      )}
      <ClientIndicator />
      <ProjectIndicator />
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
          {/* Frequently used */}
          {frequent.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#b4b2a9' }}>
                Frequently Used
              </p>
              <div className="space-y-1.5">
                {frequent.map((def) => (
                  <PaletteItem
                    key={def.subtype}
                    def={def}
                    onTrack={track}
                    onClick={() => addNodeBySubtype(def.subtype)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Categories */}
          {CATEGORY_ORDER.map((cat) => {
            const allItems   = byCategory(cat)
            if (allItems.length === 0) return null
            const items      = allItems
            const isCollapsed = !search && collapsedCats.has(cat)

            // Top-3 preview: most-used first, then alphabetical
            const preview = [...items]
              .sort((a, b) => (usage[b.subtype] ?? 0) - (usage[a.subtype] ?? 0))
              .slice(0, COLLAPSED_PREVIEW)
            const visibleItems = isCollapsed ? preview : items
            const hiddenCount  = items.length - preview.length

            return (
              <div key={cat}>
                <button
                  className="mb-2 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent group/cathead"
                  onClick={() => !search && toggleCat(cat)}
                  style={{ cursor: search ? 'default' : 'pointer' }}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#b4b2a9' }}>
                    {CATEGORY_LABELS[cat]}
                  </p>
                  {!search && (
                    <Icons.ChevronDown
                      className="h-3.5 w-3.5 shrink-0 transition-transform duration-150"
                      style={{
                        color: '#7c7b74',
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      }}
                    />
                  )}
                </button>
                <div className="space-y-1.5">
                  {visibleItems.map((def) => (
                    <PaletteItem
                      key={def.subtype}
                      def={def}
                      onTrack={track}
                      onClick={() => addNodeBySubtype(def.subtype)}
                    />
                  ))}
                  {isCollapsed && hiddenCount > 0 && (
                    <button
                      className="w-full rounded py-0.5 text-center text-[10px] transition-colors hover:text-foreground"
                      style={{ color: '#b4b2a9' }}
                      onClick={() => toggleCat(cat)}
                    >
                      +{hiddenCount} more
                    </button>
                  )}
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

function CollapsedToolbar({ onExpand, onShowInsights }: { onExpand: () => void; onShowInsights: () => void }) {
  const addNodeBySubtype = useWorkflowStore((s) => s.addNodeBySubtype)
  const canvasTool = useWorkflowStore((s) => s.canvasTool)
  const setCanvasTool = useWorkflowStore((s) => s.setCanvasTool)
  const isOffline = useWorkflowStore((s) => s.workflow.connectivity_mode === 'offline')
  const [openCat, setOpenCat] = useState<NodeCategory | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const catBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

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

  const categories: NodeCategory[] = ['source', 'logic', 'media', 'output']

  return (
    <div ref={toolbarRef} className="relative flex h-full flex-col items-center py-2 gap-1">
      <div className="mt-1 mb-1 h-px w-7 bg-border" />

      {/* Canvas tool buttons */}
      <button
        title="Select (V)"
        onClick={() => setCanvasTool('select')}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          canvasTool === 'select'
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icons.MousePointer2 className="h-4 w-4" />
      </button>
      <button
        title="Hand / Pan (H)"
        onClick={() => setCanvasTool('hand')}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
          canvasTool === 'hand'
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icons.Hand className="h-4 w-4" />
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
            ref={(el) => { catBtnRefs.current[cat] = el }}
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
        onClick={onShowInsights}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-yellow-500"
      >
        <Icons.Lightbulb className="h-4 w-4" />
      </button>

      {/* Floating submenu — portal to document.body to escape any stacking context */}
      {openCat && createPortal(
        <div
          ref={submenuRef}
          className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-lg border border-border"
          style={{
            backgroundColor: '#ffffff',
            boxShadow: '0 10px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
            left: 52,
            top: (() => {
              const btn = catBtnRefs.current[openCat]
              if (btn) return btn.getBoundingClientRect().top
              if (!toolbarRef.current) return 80
              const btnIndex = categories.indexOf(openCat)
              const rect = toolbarRef.current.getBoundingClientRect()
              return rect.top + 68 + btnIndex * 40
            })(),
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-3 py-2.5 border-b border-border"
            style={{ backgroundColor: CATEGORY_SPEC[openCat].headerBg }}
          >
            {(() => {
              const CatIcon = CATEGORY_TOOLBAR_ICONS[openCat] ?? Icons.Box
              return <CatIcon className="h-3.5 w-3.5" style={{ color: CATEGORY_SPEC[openCat].accent }} />
            })()}
            <span className="text-xs font-semibold" style={{ color: CATEGORY_SPEC[openCat].badgeText }}>
              {CATEGORY_LABELS[openCat]}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">drag or click</span>
          </div>

          {/* Node list */}
          <div className="max-h-[60vh] overflow-y-auto py-1.5 px-2 space-y-1">
            {sortedByLabel(PALETTE_NODES.filter((n) => n.category === openCat && (!isOffline || OFFLINE_COMPATIBLE_SUBTYPES.has(n.subtype)))).map((def) => (
              <PaletteItem
                key={def.subtype}
                def={def}
                onTrack={incrementUsage}
                onClick={() => {
                  addNodeBySubtype(def.subtype)
                  setOpenCat(null)
                }}
              />
            ))}
          </div>
        </div>,
        document.body
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
      <div className="relative flex h-full w-[52px] shrink-0 flex-col overflow-hidden border-r border-border bg-background">
        {/* Right-edge expand handle */}
        <button
          onClick={() => setCollapsed(false)}
          title="Expand palette"
          className="absolute right-0 top-[40%] z-10 -translate-y-1/2 flex h-12 w-3 items-center justify-center rounded-l-sm border border-r-0 border-border bg-background hover:bg-muted transition-colors"
        >
          <Icons.ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
        <CollapsedToolbar onExpand={() => setCollapsed(false)} onShowInsights={() => { setCollapsed(false); setTab('insights') }} />
      </div>
    )
  }

  // Expanded mode
  return (
    <div className="relative flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-border bg-background">
      {/* Right-edge collapse handle */}
      <button
        onClick={() => setCollapsed(true)}
        title="Collapse palette"
        className="absolute right-0 top-[40%] z-10 -translate-y-1/2 flex h-12 w-3 items-center justify-center rounded-l-sm border border-r-0 border-border bg-background hover:bg-muted transition-colors"
      >
        <Icons.ChevronLeft className="h-2.5 w-2.5 text-muted-foreground" />
      </button>

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
