import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'

function HighlightedBody({ body }: { body: string }) {
  const parts = body.split(/(\[[A-Z0-9_/]+\])/g)
  return (
    <pre className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: '#3a3a2e', fontFamily: 'inherit' }}>
      {parts.map((part, i) =>
        /^\[[A-Z0-9_/]+\]$/.test(part)
          ? <mark key={i} className="rounded px-0.5 font-semibold" style={{ backgroundColor: '#fdf5ff', color: '#7a00b4', outline: '1px solid #e4b3ff' }}>{part}</mark>
          : part
      )}
    </pre>
  )
}

export interface PromptTemplate {
  id: string
  name: string
  body: string
  category: string
  description: string | null
  parentId: string | null
  clientId: string | null
  useCount: number
  createdAt: string
}

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  content: 'Content',
  seo:     'SEO',
  social:  'Social',
  email:   'Email',
  other:   'Other',
}

function TemplateList({
  title,
  templates,
  activeId,
  onSelect,
}: {
  title: string
  templates: PromptTemplate[]
  activeId: string | null
  onSelect: (t: PromptTemplate) => void
}) {
  const grouped = templates.reduce<Record<string, PromptTemplate[]>>((acc, t) => {
    ;(acc[t.category] ??= []).push(t)
    return acc
  }, {})

  if (templates.length === 0) {
    return (
      <div className="px-1 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#a200ee' }}>{title}</p>
        <p className="text-[10px] text-muted-foreground">No templates yet</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 px-1" style={{ color: '#a200ee' }}>{title}</p>
      <div className="space-y-3">
        {Object.entries(grouped).map(([cat, catTemplates]) => (
          <div key={cat}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            <div className="space-y-0.5">
              {catTemplates.map((t) => {
                const isActive = activeId === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => onSelect(t)}
                    className="w-full rounded-lg px-3 py-2 text-left transition-colors"
                    style={
                      isActive
                        ? { backgroundColor: '#fdf5ff', border: '1px solid #a200ee' }
                        : { backgroundColor: 'transparent', border: '1px solid transparent' }
                    }
                  >
                    <p className="line-clamp-2 text-xs font-medium" style={{ color: isActive ? '#7a00b4' : '#1a1a14' }}>
                      {t.name}
                    </p>
                    {t.description && (
                      <p className="truncate text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
                    )}
                    {t.useCount > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Used {t.useCount}×</p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PromptPickerModal({
  onSelect,
  onClose,
  clientId,
  clientName,
}: {
  onSelect: (template: PromptTemplate) => void
  onClose: () => void
  clientId?: string
  clientName?: string
}) {
  const [agencyTemplates, setAgencyTemplates] = useState<PromptTemplate[]>([])
  const [clientTemplates, setClientTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [previewing, setPreviewing] = useState<PromptTemplate | null>(null)

  useEffect(() => {
    const fetches = [
      apiFetch('/api/v1/prompts').then((r) => r.json()).then(({ data }) => setAgencyTemplates(data ?? [])),
    ]
    if (clientId) {
      fetches.push(
        apiFetch(`/api/v1/prompts?clientId=${clientId}`).then((r) => r.json()).then(({ data }) => setClientTemplates(data ?? []))
      )
    }
    Promise.all(fetches).catch(console.error).finally(() => setLoading(false))
  }, [clientId])

  const allTemplates = [...clientTemplates, ...agencyTemplates]

  const filter = (templates: PromptTemplate[]) => {
    if (!search) return templates
    const q = search.toLowerCase()
    return templates.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    )
  }

  const filteredAgency = filter(agencyTemplates)
  const filteredClient = filter(clientTemplates)
  const isEmpty = allTemplates.length === 0

  const handleSelect = (t: PromptTemplate) => {
    apiFetch(`/api/v1/prompts/${t.id}/use`, { method: 'POST' }).catch(() => {})
    onSelect(t)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-[580px] rounded-xl border border-border bg-white shadow-2xl overflow-hidden" style={{ maxHeight: '82vh' }}>

        {/* Left — list */}
        <div className="flex w-[280px] shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between rounded-tl-xl px-4 py-3.5" style={{ backgroundColor: '#a200ee' }}>
            <div className="flex items-center gap-2">
              <Icons.ScrollText className="h-4 w-4 text-white/80" />
              <h2 className="text-sm font-semibold text-white">Prompt Library</h2>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white">
              <Icons.X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-border px-3 py-2.5">
            <div className="relative">
              <Icons.Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search prompts…"
                className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-purple-400"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Icons.ScrollText className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No prompt templates yet</p>
                <p className="text-[10px] text-muted-foreground">Go to the client's Library tab to generate or create templates</p>
              </div>
            ) : filteredAgency.length === 0 && filteredClient.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No matches</p>
            ) : (
              <>
                {clientId && (
                  <>
                    <TemplateList
                      title={clientName ? `${clientName} Templates` : 'Client Templates'}
                      templates={filteredClient}
                      activeId={previewing?.id ?? null}
                      onSelect={setPreviewing}
                    />
                    {filteredAgency.length > 0 && <div style={{ borderTop: '1px solid #e8e7e1' }} />}
                  </>
                )}
                <TemplateList
                  title={clientId ? 'Global Templates' : 'Templates'}
                  templates={filteredAgency}
                  activeId={previewing?.id ?? null}
                  onSelect={setPreviewing}
                />
              </>
            )}
          </div>
        </div>

        {/* Right — preview */}
        <div className="flex flex-1 flex-col min-w-0">
          {previewing ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold truncate" style={{ color: '#1a1a14' }}>{previewing.name}</p>
                {previewing.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{previewing.description}</p>
                )}
                {previewing.clientId && (
                  <p className="text-[10px] mt-0.5" style={{ color: '#a200ee' }}>Client template</p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <HighlightedBody body={previewing.body} />
              </div>
              <div className="border-t border-border px-4 py-3 flex justify-end">
                <button
                  onClick={() => handleSelect(previewing)}
                  className="flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: '#a200ee' }}
                >
                  <Icons.Download className="h-3.5 w-3.5" />
                  Load into Node
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center px-6">
              <Icons.MousePointer2 className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">Select a template to preview</p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
