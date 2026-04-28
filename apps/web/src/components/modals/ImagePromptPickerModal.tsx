import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'

export interface ImagePrompt {
  id: string
  name: string
  promptText: string
  styleTags: string
  notes: string | null
  clientId: string | null
  sortOrder: number
  createdAt: string
}

function PromptList({
  title,
  prompts,
  activeId,
  onSelect,
}: {
  title: string
  prompts: ImagePrompt[]
  activeId: string | null
  onSelect: (p: ImagePrompt) => void
}) {
  if (prompts.length === 0) {
    return (
      <div className="px-1 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#a200ee' }}>{title}</p>
        <p className="text-[10px] text-muted-foreground">No prompts yet</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5 px-1" style={{ color: '#a200ee' }}>{title}</p>
      <div className="space-y-0.5">
        {prompts.map((p) => {
          const isActive = activeId === p.id
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className="w-full rounded-lg px-3 py-2 text-left transition-colors"
              style={
                isActive
                  ? { backgroundColor: '#fdf5ff', border: '1px solid #a200ee' }
                  : { backgroundColor: 'transparent', border: '1px solid transparent' }
              }
            >
              <p className="truncate text-xs font-medium" style={{ color: isActive ? '#7a00b4' : '#1a1a14' }}>
                {p.name}
              </p>
              {p.styleTags && (
                <p className="truncate text-[10px] text-muted-foreground mt-0.5">{p.styleTags}</p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ImagePromptPickerModal({
  onSelect,
  onClose,
  clientId,
  clientName,
}: {
  onSelect: (prompt: ImagePrompt) => void
  onClose: () => void
  clientId?: string
  clientName?: string
}) {
  const [clientPrompts, setClientPrompts] = useState<ImagePrompt[]>([])
  const [globalPrompts, setGlobalPrompts] = useState<ImagePrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [previewing, setPreviewing] = useState<ImagePrompt | null>(null)

  useEffect(() => {
    const url = clientId
      ? `/api/v1/image-prompts/picker?clientId=${clientId}`
      : '/api/v1/image-prompts/picker'
    apiFetch(url)
      .then((r) => r.json())
      .then(({ data }) => {
        setClientPrompts(data?.clientPrompts ?? [])
        setGlobalPrompts(data?.globalPrompts ?? [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  const filter = (prompts: ImagePrompt[]) => {
    if (!search) return prompts
    const q = search.toLowerCase()
    return prompts.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.promptText.toLowerCase().includes(q) ||
      p.styleTags.toLowerCase().includes(q)
    )
  }

  const filteredClient = filter(clientPrompts)
  const filteredGlobal = filter(globalPrompts)
  const isEmpty = clientPrompts.length === 0 && globalPrompts.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex w-[620px] rounded-xl border border-border bg-white shadow-2xl overflow-hidden" style={{ maxHeight: '82vh' }}>

        {/* Left — list */}
        <div className="flex w-[280px] shrink-0 flex-col border-r border-border">
          <div className="flex items-center justify-between rounded-tl-xl px-4 py-3.5" style={{ backgroundColor: '#a200ee' }}>
            <div className="flex items-center gap-2">
              <Icons.Image className="h-4 w-4 text-white/80" />
              <h2 className="text-sm font-semibold text-white">Image Prompt Library</h2>
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
                <Icons.Image className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No image prompts yet</p>
                <p className="text-[10px] text-muted-foreground">Add prompts in Settings → Library or the client's Branding tab</p>
              </div>
            ) : filteredClient.length === 0 && filteredGlobal.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">No matches</p>
            ) : (
              <>
                {clientId && (
                  <>
                    <PromptList
                      title={clientName ? `${clientName} Prompts` : 'Client Prompts'}
                      prompts={filteredClient}
                      activeId={previewing?.id ?? null}
                      onSelect={setPreviewing}
                    />
                    {filteredGlobal.length > 0 && <div style={{ borderTop: '1px solid #e8e7e1' }} />}
                  </>
                )}
                <PromptList
                  title={clientId ? 'Agency Prompts' : 'Prompts'}
                  prompts={filteredGlobal}
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
                {previewing.styleTags && (
                  <p className="text-xs text-muted-foreground mt-0.5">{previewing.styleTags}</p>
                )}
                {previewing.clientId && (
                  <p className="text-[10px] mt-0.5" style={{ color: '#a200ee' }}>Client prompt</p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <pre className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: '#3a3a2e', fontFamily: 'inherit' }}>
                  {previewing.promptText}
                </pre>
                {previewing.notes && (
                  <p className="mt-3 text-[10px] text-muted-foreground border-t border-border pt-2">{previewing.notes}</p>
                )}
              </div>
              <div className="border-t border-border px-4 py-3 flex justify-end">
                <button
                  onClick={() => onSelect(previewing)}
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
              <p className="text-xs text-muted-foreground">Select a prompt to preview</p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
