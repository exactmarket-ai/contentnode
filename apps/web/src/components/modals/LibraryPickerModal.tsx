import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { formatBytes } from '@/components/layout/config/shared'

export interface AgencyFile {
  id: string
  originalName: string
  label: string | null
  category: string | null
  sizeBytes: number
  createdAt: string
}

const CATEGORY_LABELS: Record<string, string> = {
  'brand-guidelines':  'Brand Guidelines',
  'instructions':      'Instructions',
  'standards':         'Standards',
  'templates':         'Templates',
  'approved-examples': 'Approved Examples',
  'legal':             'Legal',
  'other':             'Other',
}

function FileGroup({
  title,
  files,
  picked,
  toggle,
  search,
  emptyMessage,
}: {
  title: string
  files: AgencyFile[]
  picked: Set<string>
  toggle: (id: string) => void
  search: string
  emptyMessage: string
}) {
  const filtered = files.filter((f) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      f.originalName.toLowerCase().includes(q) ||
      (f.label ?? '').toLowerCase().includes(q) ||
      (f.category ?? '').toLowerCase().includes(q)
    )
  })

  const grouped = filtered.reduce<Record<string, AgencyFile[]>>((acc, f) => {
    const cat = f.category ?? 'other'
    ;(acc[cat] ??= []).push(f)
    return acc
  }, {})

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#a200ee' }}>
        {title}
      </p>
      {files.length === 0 ? (
        <p className="text-[11px] text-muted-foreground px-1 pb-2">{emptyMessage}</p>
      ) : filtered.length === 0 ? (
        <p className="text-[11px] text-muted-foreground px-1 pb-2">No matches</p>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([cat, catFiles]) => (
            <div key={cat}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[cat] ?? cat}
              </p>
              <div className="space-y-1">
                {catFiles.map((f) => {
                  const isSelected = picked.has(f.id)
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggle(f.id)}
                      className="w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
                      style={
                        isSelected
                          ? { borderColor: '#a200ee', backgroundColor: '#fdf5ff' }
                          : { borderColor: '#e8e7e1', backgroundColor: '#fafaf8' }
                      }
                    >
                      <div
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded border-2"
                        style={{ borderColor: isSelected ? '#a200ee' : '#dddcd6', backgroundColor: isSelected ? '#a200ee' : 'transparent' }}
                      >
                        {isSelected && <Icons.Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <Icons.FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" style={{ color: isSelected ? '#7a00b4' : '#1a1a14' }}>
                          {f.label ?? f.originalName}
                        </p>
                        {f.label && (
                          <p className="truncate text-[10px] text-muted-foreground">{f.originalName}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatBytes(f.sizeBytes)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function LibraryPickerModal({
  selectedIds,
  onConfirm,
  onClose,
  clientId,
  clientName,
}: {
  selectedIds: string[]
  onConfirm: (files: Array<{ id: string; name: string }>) => void
  onClose: () => void
  clientId?: string
  clientName?: string
}) {
  const [agencyFiles, setAgencyFiles] = useState<AgencyFile[]>([])
  const [clientFiles, setClientFiles] = useState<AgencyFile[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set(selectedIds))
  const [search, setSearch] = useState('')

  useEffect(() => {
    const fetches = [
      apiFetch('/api/v1/library').then((r) => r.json()).then(({ data }) => setAgencyFiles(data ?? [])),
    ]
    if (clientId) {
      fetches.push(
        apiFetch(`/api/v1/clients/${clientId}/library`).then((r) => r.json()).then(({ data }) => setClientFiles(data ?? []))
      )
    }
    Promise.all(fetches).catch(console.error).finally(() => setLoading(false))
  }, [clientId])

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allFiles = [...clientFiles, ...agencyFiles]

  const handleConfirm = () => {
    const selected = allFiles
      .filter((f) => picked.has(f.id))
      .map((f) => ({ id: f.id, name: f.label ?? f.originalName }))
    onConfirm(selected)
  }

  const hasClientFiles = clientFiles.length > 0
  const hasAgencyFiles = agencyFiles.length > 0
  const isEmpty = !hasClientFiles && !hasAgencyFiles

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-[520px] flex-col rounded-xl border border-border bg-white shadow-2xl" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between rounded-t-xl px-5 py-4" style={{ backgroundColor: '#a200ee' }}>
          <div className="flex items-center gap-2">
            <Icons.Library className="h-4 w-4 text-white/80" />
            <h2 className="text-sm font-semibold text-white">Add from Library</h2>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <Icons.X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search library…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-purple-400"
            />
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Icons.Library className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No library files yet</p>
              <p className="text-xs text-muted-foreground">Upload files under Settings → Library or the client's Library tab</p>
            </div>
          ) : (
            <>
              {clientId && (
                <FileGroup
                  title={clientName ? `${clientName} Library` : 'Client Library'}
                  files={clientFiles}
                  picked={picked}
                  toggle={toggle}
                  search={search}
                  emptyMessage="No files in this client's library yet"
                />
              )}
              {clientId && hasClientFiles && hasAgencyFiles && (
                <div style={{ borderTop: '1px solid #e8e7e1' }} />
              )}
              <FileGroup
                title={clientId ? 'Global Library' : 'Library'}
                files={agencyFiles}
                picked={picked}
                toggle={toggle}
                search={search}
                emptyMessage="No global library files yet — upload under Settings → Library"
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {picked.size > 0 ? `${picked.size} file${picked.size !== 1 ? 's' : ''} selected` : 'No files selected'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: '#a200ee' }}
            >
              Add to Node
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
