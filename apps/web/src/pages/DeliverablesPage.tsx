/**
 * DeliverablesPage — agency-wide deliverables board.
 * Visible to Manager+ only. Searchable, sortable, inline-editable, Excel-exportable.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useNavigate } from 'react-router-dom'

// ─── Wrike types ───────────────────────────────────────────────────────────────

interface WrikeTask {
  id: string
  title: string
  status: string
  briefDescription?: string
  parentIds?: string[]
  responsibleIds?: string[]
  updatedDate?: string
  createdDate?: string
  dates?: { due?: string; start?: string }
}

interface WrikeFolder {
  id: string
  title: string
  childIds?: string[]
  project?: { status?: string }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DeliverableRun {
  id: string
  itemName: string | null
  reviewStatus: string
  status: string
  priority: string | null
  internalNotes: string | null
  statusExternal: string | null
  followupStatus: string | null
  mainClientName: string | null
  otherStakeholders: string | null
  teamDesign: string | null
  teamContent: string | null
  teamVideo: string | null
  sowNumber: string | null
  budgetMs: number | null
  mainCategory: string | null
  focus: string | null
  clientFolderBox: string | null
  clientFolderClient: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  assigneeId: string | null
  assignee: { id: string; name: string } | null
  workflow: {
    id: string
    name: string
    client: { id: string; name: string }
  }
}

interface FilterState {
  q: string
  clientId: string
  stage: string
  priority: string
  assigneeId: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function quarterOf(iso: string): string {
  const d = new Date(iso)
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
}

function stagLabel(s: string): string {
  const m: Record<string, string> = {
    none:             'Last Mile',
    pending:          'Ready for Client',
    sent_to_client:   'Client Review',
    client_responded: 'Client Responded',
    closed:           'Closed',
  }
  return m[s] ?? s
}

function priorityColor(p: string | null) {
  if (p === 'high')   return 'bg-red-100 text-red-700'
  if (p === 'medium') return 'bg-amber-100 text-amber-700'
  if (p === 'low')    return 'bg-zinc-100 text-zinc-500'
  return 'bg-zinc-50 text-zinc-400'
}

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

// ─── InlineCell — click to edit, blur to save ──────────────────────────────────

function InlineCell({
  value,
  placeholder,
  onSave,
  className,
  type = 'text',
  options,
}: {
  value: string | null | undefined
  placeholder?: string
  onSave: (v: string | null) => void
  className?: string
  type?: 'text' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement & HTMLSelectElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setDraft(value ?? '') }, [value])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    onSave(trimmed || null)
  }

  if (editing) {
    if (type === 'select' && options) {
      return (
        <select
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    return (
      <input
        ref={inputRef}
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(value ?? '') } }}
        className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={cn(
        'cursor-pointer rounded px-1.5 py-0.5 text-[11px] min-h-[22px] hover:bg-muted/30 transition-colors',
        !value && 'text-muted-foreground/40 italic',
        className,
      )}
    >
      {value || placeholder || '—'}
    </div>
  )
}

// ─── Column header with sort ────────────────────────────────────────────────────

function SortableHeader({
  label,
  sortKey,
  current,
  order,
  onSort,
  className,
}: {
  label: string
  sortKey: string
  current: string
  order: 'asc' | 'desc'
  onSort: (key: string) => void
  className?: string
}) {
  const active = current === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={cn(
        'cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors',
        className,
      )}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? order === 'asc'
            ? <Icons.ChevronUp className="h-3 w-3 text-blue-500" />
            : <Icons.ChevronDown className="h-3 w-3 text-blue-500" />
          : <Icons.ChevronsUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function DeliverablesPage() {
  const { isManager } = useCurrentUser()
  const navigate      = useNavigate()

  const [activeTab, setActiveTab] = useState<'contentnode' | 'wrike'>('contentnode')

  // ContentNode state
  const [runs, setRuns]       = useState<DeliverableRun[]>([])
  const [total, setTotal]     = useState(0)
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [members, setMembers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  // Wrike state
  const [wrikeConnected, setWrikeConnected] = useState(false)
  const [wrikeTasks, setWrikeTasks]         = useState<WrikeTask[]>([])
  const [wrikeFolders, setWrikeFolders]     = useState<WrikeFolder[]>([])
  const [wrikeLoading, setWrikeLoading]     = useState(false)
  const [wrikeSearch, setWrikeSearch]       = useState('')
  const [wrikeSort, setWrikeSort]           = useState('updatedDate')
  const [wrikeOrder, setWrikeOrder]         = useState<'asc' | 'desc'>('desc')
  const [wrikeFolderId, setWrikeFolderId]   = useState('all')

  const [filters, setFilters] = useState<FilterState>({
    q: '', clientId: '', stage: '', priority: '', assigneeId: '',
  })
  const [sort,  setSort]  = useState('updatedAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const fetchRef = useRef(0)

  const load = useCallback(async () => {
    const tick = ++fetchRef.current
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.q)          params.set('q',          filters.q)
      if (filters.clientId)   params.set('clientId',   filters.clientId)
      if (filters.stage)      params.set('stage',      filters.stage)
      if (filters.priority)   params.set('priority',   filters.priority)
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId)
      params.set('sort',  sort)
      params.set('order', order)
      const r = await apiFetch(`/api/v1/deliverables?${params}`)
      if (!r.ok) return
      const b = await r.json()
      if (tick !== fetchRef.current) return
      setRuns(b.data.runs ?? [])
      setTotal(b.data.total ?? 0)
      setClients(b.data.clients ?? [])
      setMembers(b.data.members ?? [])
    } finally {
      if (tick === fetchRef.current) setLoading(false)
    }
  }, [filters, sort, order])

  useEffect(() => { void load() }, [load])

  // Debounce search
  const [searchInput, setSearchInput] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearch = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setFilters((f) => ({ ...f, q: v })), 300)
  }

  const handleSort = (key: string) => {
    if (sort === key) setOrder((o) => o === 'asc' ? 'desc' : 'asc')
    else { setSort(key); setOrder('asc') }
  }

  const patch = async (id: string, field: string, value: unknown) => {
    setSaving((s) => ({ ...s, [id]: true }))
    try {
      const r = await apiFetch(`/api/v1/deliverables/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (r.ok) {
        const b = await r.json()
        setRuns((prev) => prev.map((run) => run.id === id ? { ...run, ...b.data } : run))
      }
    } finally {
      setSaving((s) => ({ ...s, [id]: false }))
    }
  }

  // Load Wrike status + data on mount
  useEffect(() => {
    apiFetch('/api/v1/integrations/wrike/status')
      .then((r) => r.json())
      .then((body) => {
        const connected = !!body.data?.connected
        setWrikeConnected(connected)
        if (connected) loadWrike()
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadWrike = () => {
    setWrikeLoading(true)
    Promise.all([
      apiFetch('/api/v1/integrations/wrike/tasks').then((r) => r.json()),
      apiFetch('/api/v1/integrations/wrike/folders').then((r) => r.json()),
    ])
      .then(([t, f]) => { setWrikeTasks(t.data ?? []); setWrikeFolders(f.data ?? []) })
      .catch(() => {})
      .finally(() => setWrikeLoading(false))
  }

  const filteredWrikeTasks = wrikeTasks
    .filter((t) => {
      if (wrikeFolderId !== 'all' && !t.parentIds?.includes(wrikeFolderId)) return false
      if (!wrikeSearch.trim()) return true
      const q = wrikeSearch.toLowerCase()
      return (
        t.title.toLowerCase().includes(q) ||
        (t.briefDescription ?? '').toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const aVal = wrikeSort === 'title' ? (a.title ?? '') : (a.updatedDate ?? a.createdDate ?? '')
      const bVal = wrikeSort === 'title' ? (b.title ?? '') : (b.updatedDate ?? b.createdDate ?? '')
      return wrikeOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    })

  const handleWrikeSort = (key: string) => {
    if (wrikeSort === key) setWrikeOrder((o) => o === 'asc' ? 'desc' : 'asc')
    else { setWrikeSort(key); setWrikeOrder('asc') }
  }

  const exportWrikeXlsx = async () => {
    const { utils, writeFile } = await import('xlsx')
    const headers = ['Title', 'Status', 'Project', 'Description', 'Due Date', 'Updated']
    const rows = filteredWrikeTasks.map((t) => [
      t.title,
      t.status,
      wrikeFolders.find((f) => t.parentIds?.includes(f.id))?.title ?? '',
      t.briefDescription ?? '',
      t.dates?.due ?? '',
      t.updatedDate ? new Date(t.updatedDate).toLocaleDateString() : '',
    ])
    const ws = utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = headers.map(() => ({ wch: 24 }))
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Wrike Tasks')
    writeFile(wb, `Wrike_Tasks_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const exportXlsx = async () => {
    const { utils, writeFile } = await import('xlsx')
    const headers = [
      '', 'Client', 'Main Category', 'Focus', 'Type', 'Project', 'Sub Project',
      'Status Internal', 'Status External', 'Priority', '', 'Stage',
      'Followup Status', 'Followup Date', 'Main Client Name', 'Other Stakeholders',
      'Last Updated', 'Design', 'Content', 'Video', 'PM', 'Quarter',
      'SOW #', 'Budget for MS', 'CLIENT FOLDER (BOX)', 'CLIENT FOLDER (CLIENT)',
    ]
    const rows = runs.map((r) => ([
      '',
      r.workflow.client.name,
      r.mainCategory ?? '',
      r.focus ?? '',
      r.itemName ?? '',
      r.workflow.name,
      '',
      r.internalNotes ?? '',
      r.statusExternal ?? '',
      r.priority ?? '',
      '',
      stagLabel(r.reviewStatus),
      r.followupStatus ?? '',
      r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '',
      r.mainClientName ?? '',
      r.otherStakeholders ?? '',
      new Date(r.updatedAt).toLocaleDateString(),
      r.teamDesign ?? '',
      r.teamContent ?? '',
      r.teamVideo ?? '',
      r.assignee?.name ?? '',
      quarterOf(r.createdAt),
      r.sowNumber ?? '',
      r.budgetMs ?? '',
      r.clientFolderBox ?? '',
      r.clientFolderClient ?? '',
    ]))
    const ws = utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length, 14) }))
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Deliverables')
    writeFile(wb, `Deliverables_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (!isManager) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Icons.Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Manager access required</p>
          <p className="mt-1 text-[12px] text-muted-foreground">This view is restricted to Manager and above.</p>
        </div>
      </div>
    )
  }

  const PRIORITY_OPTIONS = [
    { value: 'high',   label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low',    label: 'Low' },
  ]

  const STAGE_OPTIONS = [
    { value: 'none',             label: 'Last Mile' },
    { value: 'pending',          label: 'Ready for Client' },
    { value: 'sent_to_client',   label: 'Client Review' },
    { value: 'client_responded', label: 'Client Responded' },
    { value: 'closed',           label: 'Closed' },
  ]

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-6 py-3">
        <div className="flex-1">
          <h1 className="text-sm font-bold text-foreground">Deliverables</h1>
          <p className="text-[11px] text-muted-foreground">
            {activeTab === 'wrike' ? `${filteredWrikeTasks.length} tasks from Wrike` : `${total} items`}
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
          <button
            onClick={() => setActiveTab('contentnode')}
            className={cn(
              'rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
              activeTab === 'contentnode'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            ContentNode
          </button>
          <button
            onClick={() => setActiveTab('wrike')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium transition-colors',
              activeTab === 'wrike'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Wrike
            {wrikeConnected && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Connected" />
            )}
          </button>
        </div>

        {activeTab === 'contentnode' ? (
          <>
            {/* ContentNode search */}
            <div className="relative flex-1 max-w-sm">
              <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search client, project, status, SOW, team…"
                value={searchInput}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              {searchInput && (
                <button onClick={() => { setSearchInput(''); setFilters((f) => ({ ...f, q: '' })) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <Icons.X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* ContentNode filters */}
            <select
              value={filters.clientId}
              onChange={(e) => setFilters((f) => ({ ...f, clientId: e.target.value }))}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">All Clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select
              value={filters.stage}
              onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">All Stages</option>
              {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <select
              value={filters.priority}
              onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">All Priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select
              value={filters.assigneeId}
              onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">All Assignees</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>

            <button
              onClick={exportXlsx}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Icons.Download className="h-3.5 w-3.5" />
              Export
            </button>

            <button
              onClick={() => void load()}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {loading
                ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                : <Icons.RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </>
        ) : (
          <>
            {/* Wrike search */}
            {wrikeConnected && (
              <>
                <div className="relative flex-1 max-w-sm">
                  <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search tasks…"
                    value={wrikeSearch}
                    onChange={(e) => setWrikeSearch(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-[12px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  {wrikeSearch && (
                    <button onClick={() => setWrikeSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <Icons.X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Folder filter */}
                <select
                  value={wrikeFolderId}
                  onChange={(e) => setWrikeFolderId(e.target.value)}
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="all">All Projects</option>
                  {wrikeFolders.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                </select>

                <button
                  onClick={exportWrikeXlsx}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Icons.Download className="h-3.5 w-3.5" />
                  Export
                </button>

                <button
                  onClick={loadWrike}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  {wrikeLoading
                    ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    : <Icons.RefreshCw className="h-3.5 w-3.5" />}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* ContentNode table */}
      {activeTab === 'contentnode' && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]" style={{ minWidth: '1800px' }}>
            <thead className="sticky top-0 z-10 bg-background border-b border-border">
              <tr>
                <SortableHeader label="Client"        sortKey="client"    current={sort} order={order} onSort={handleSort} className="sticky left-0 z-20 bg-background min-w-[130px]" />
                <SortableHeader label="Category"      sortKey="category"  current={sort} order={order} onSort={handleSort} className="min-w-[120px]" />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[90px]">Focus</th>
                <SortableHeader label="Type / Item"   sortKey="project"   current={sort} order={order} onSort={handleSort} className="min-w-[180px]" />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[140px]">Project</th>
                <SortableHeader label="Stage"         sortKey="stage"     current={sort} order={order} onSort={handleSort} className="min-w-[130px]" />
                <SortableHeader label="Priority"      sortKey="priority"  current={sort} order={order} onSort={handleSort} className="min-w-[90px]" />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[220px]">Status Internal</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[220px]">Status External</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[160px]">Followup Status</th>
                <SortableHeader label="Followup Date" sortKey="dueDate"   current={sort} order={order} onSort={handleSort} className="min-w-[120px]" />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[130px]">Main Contact</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[140px]">Other Stakeholders</th>
                <SortableHeader label="Updated"       sortKey="updatedAt" current={sort} order={order} onSort={handleSort} className="min-w-[100px]" />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[90px]">Design</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[90px]">Content</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[90px]">Video</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[90px]">PM</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[80px]">Quarter</th>
                <SortableHeader label="SOW #"         sortKey="sow"       current={sort} order={order} onSort={handleSort} className="min-w-[90px]" />
                <SortableHeader label="Budget (MS)"   sortKey="budget"    current={sort} order={order} onSort={handleSort} className="min-w-[100px]" />
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[120px]">Box Folder</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[120px]">Client Folder</th>
              </tr>
            </thead>
            <tbody>
              {loading && runs.length === 0 ? (
                <tr>
                  <td colSpan={23} className="px-6 py-16 text-center text-[12px] text-muted-foreground">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent mr-2 align-middle" />
                    Loading…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={23} className="px-6 py-16 text-center text-[12px] text-muted-foreground">
                    No deliverables found. Try adjusting your filters.
                  </td>
                </tr>
              ) : runs.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    'border-b border-border/50 hover:bg-muted/10 transition-colors',
                    saving[r.id] && 'opacity-60',
                  )}
                >
                  {/* Client — sticky */}
                  <td className="sticky left-0 z-10 bg-background px-3 py-2">
                    <button
                      onClick={() => navigate(`/clients/${r.workflow.client.id}`)}
                      className="text-[12px] font-semibold text-blue-600 hover:underline text-left"
                    >
                      {r.workflow.client.name}
                    </button>
                  </td>

                  {/* Main Category */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.mainCategory} placeholder="Category" onSave={(v) => patch(r.id, 'mainCategory', v)} />
                  </td>

                  {/* Focus */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.focus} placeholder="Focus" onSave={(v) => patch(r.id, 'focus', v)} />
                  </td>

                  {/* Type / Item */}
                  <td className="px-3 py-2">
                    <button
                      onClick={() => navigate(`/reviews/${r.id}`)}
                      className="text-left text-[12px] font-medium text-foreground hover:text-blue-600 hover:underline max-w-[200px] truncate block"
                      title={r.itemName ?? ''}
                    >
                      {r.itemName || <span className="text-muted-foreground/40 italic">Untitled</span>}
                    </button>
                  </td>

                  {/* Project */}
                  <td className="px-3 py-2 text-[12px] text-muted-foreground truncate max-w-[160px]" title={r.workflow.name}>
                    {r.workflow.name}
                  </td>

                  {/* Stage */}
                  <td className="px-3 py-2">
                    <InlineCell
                      value={r.reviewStatus}
                      onSave={(v) => patch(r.id, 'reviewStatus', v ?? 'none')}
                      type="select"
                      options={STAGE_OPTIONS}
                      className="font-medium"
                    />
                  </td>

                  {/* Priority */}
                  <td className="px-3 py-2">
                    <InlineCell
                      value={r.priority}
                      onSave={(v) => patch(r.id, 'priority', v)}
                      type="select"
                      options={PRIORITY_OPTIONS}
                      className={cn('rounded-full px-2 text-[10px] font-semibold', priorityColor(r.priority))}
                    />
                  </td>

                  {/* Status Internal */}
                  <td className="px-3 py-2 max-w-[240px]">
                    <InlineCell value={r.internalNotes} placeholder="Internal status…" onSave={(v) => patch(r.id, 'internalNotes', v)} className="leading-snug line-clamp-2" />
                  </td>

                  {/* Status External */}
                  <td className="px-3 py-2 max-w-[240px]">
                    <InlineCell value={r.statusExternal} placeholder="External status…" onSave={(v) => patch(r.id, 'statusExternal', v)} className="leading-snug line-clamp-2" />
                  </td>

                  {/* Followup Status */}
                  <td className="px-3 py-2 max-w-[180px]">
                    <InlineCell value={r.followupStatus} placeholder="Followup…" onSave={(v) => patch(r.id, 'followupStatus', v)} />
                  </td>

                  {/* Followup Date */}
                  <td className="px-3 py-2">
                    <InlineCell
                      value={r.dueDate ? r.dueDate.slice(0, 10) : null}
                      placeholder="—"
                      type="date"
                      onSave={(v) => patch(r.id, 'dueDate', v ? new Date(v).toISOString() : null)}
                    />
                  </td>

                  {/* Main Contact */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.mainClientName} placeholder="Contact name" onSave={(v) => patch(r.id, 'mainClientName', v)} />
                  </td>

                  {/* Other Stakeholders */}
                  <td className="px-3 py-2 max-w-[160px]">
                    <InlineCell value={r.otherStakeholders} placeholder="Names…" onSave={(v) => patch(r.id, 'otherStakeholders', v)} />
                  </td>

                  {/* Last Updated */}
                  <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </td>

                  {/* Design */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.teamDesign} placeholder="Designer" onSave={(v) => patch(r.id, 'teamDesign', v)} />
                  </td>

                  {/* Content */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.teamContent} placeholder="Writer" onSave={(v) => patch(r.id, 'teamContent', v)} />
                  </td>

                  {/* Video */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.teamVideo} placeholder="Video" onSave={(v) => patch(r.id, 'teamVideo', v)} />
                  </td>

                  {/* PM */}
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {r.assignee?.name ?? '—'}
                  </td>

                  {/* Quarter */}
                  <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                    {quarterOf(r.createdAt)}
                  </td>

                  {/* SOW # */}
                  <td className="px-3 py-2">
                    <InlineCell value={r.sowNumber} placeholder="SOW #" onSave={(v) => patch(r.id, 'sowNumber', v)} />
                  </td>

                  {/* Budget MS */}
                  <td className="px-3 py-2">
                    <InlineCell
                      value={r.budgetMs != null ? String(r.budgetMs) : null}
                      placeholder="$0"
                      type="number"
                      onSave={(v) => patch(r.id, 'budgetMs', v ? parseFloat(v) : null)}
                      className="text-right font-mono"
                    />
                  </td>

                  {/* Box Folder */}
                  <td className="px-3 py-2">
                    {r.clientFolderBox
                      ? <a href={r.clientFolderBox} target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline truncate block max-w-[120px]">Open ↗</a>
                      : <InlineCell value={null} placeholder="Paste URL" onSave={(v) => patch(r.id, 'clientFolderBox', v)} />}
                  </td>

                  {/* Client Folder */}
                  <td className="px-3 py-2">
                    {r.clientFolderClient
                      ? <a href={r.clientFolderClient} target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline truncate block max-w-[120px]">Open ↗</a>
                      : <InlineCell value={null} placeholder="Paste URL" onSave={(v) => patch(r.id, 'clientFolderClient', v)} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Wrike table */}
      {activeTab === 'wrike' && (
        <div className="flex-1 overflow-auto">
          {!wrikeConnected ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center max-w-sm">
                <Icons.Link className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Wrike not connected</p>
                <p className="mt-1 text-[12px] text-muted-foreground mb-4">
                  Connect your Wrike account in Settings to pull tasks here.
                </p>
                <button
                  onClick={() => navigate('/settings')}
                  className="rounded-lg bg-foreground px-4 py-2 text-[12px] font-medium text-background hover:opacity-80 transition-opacity"
                >
                  Go to Settings
                </button>
              </div>
            </div>
          ) : wrikeLoading && wrikeTasks.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px]" style={{ minWidth: '900px' }}>
              <thead className="sticky top-0 z-10 bg-background border-b border-border">
                <tr>
                  <SortableHeader label="Title"    sortKey="title"       current={wrikeSort} order={wrikeOrder} onSort={handleWrikeSort} className="min-w-[300px]" />
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[110px]">Status</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[180px]">Project / Folder</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[220px]">Description</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground min-w-[110px]">Due Date</th>
                  <SortableHeader label="Updated"  sortKey="updatedDate" current={wrikeSort} order={wrikeOrder} onSort={handleWrikeSort} className="min-w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {filteredWrikeTasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-[12px] text-muted-foreground">
                      No tasks found.{wrikeSearch && ' Try clearing your search.'}
                    </td>
                  </tr>
                ) : filteredWrikeTasks.map((t) => {
                  const project = wrikeFolders.find((f) => t.parentIds?.includes(f.id))
                  const statusColor =
                    t.status === 'Completed' ? 'bg-green-100 text-green-700' :
                    t.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                    t.status === 'Active' ? 'bg-indigo-100 text-indigo-700' :
                    t.status === 'Deferred' ? 'bg-amber-100 text-amber-700' :
                    t.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                    'bg-zinc-100 text-zinc-500'
                  return (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className="text-[12px] font-medium text-foreground leading-snug">{t.title}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold', statusColor)}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-muted-foreground">
                        {project?.title ?? <span className="italic opacity-40">—</span>}
                      </td>
                      <td className="px-3 py-2.5 max-w-[260px]">
                        <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                          {t.briefDescription || <span className="italic opacity-40">—</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                        {t.dates?.due ? new Date(t.dates.due).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                        {t.updatedDate ? new Date(t.updatedDate).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
