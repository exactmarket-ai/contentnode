import { useEffect, useState } from 'react'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'

interface Client { id: string; name: string }
interface BrandVertical { id: string; name: string }

interface BrandPreview {
  brand_name?: string
  tagline?: string
  mission?: string
  voice_and_tone?: { personality_traits?: string[]; writing_style?: string; vocabulary_to_use?: string[]; vocabulary_to_avoid?: string[] }
  values?: string[]
  messaging?: { core_message?: string }
  positioning?: { differentiators?: string[] }
  do_not_use?: string[]
}

type DataSource = 'both' | 'profile' | 'builder'

export function BrandContextConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const workflowClientId = useWorkflowStore((s) => s.workflow.clientId ?? '')
  const clientId = (config.clientId as string) || workflowClientId || ''
  const verticalId = (config.verticalId as string) || ''
  const dataSource = (config.dataSource as DataSource) || 'both'

  const [clients, setClients] = useState<Client[]>([])
  const [verticals, setVerticals] = useState<BrandVertical[]>([])
  const [preview, setPreview] = useState<BrandPreview | null>(null)
  const [previewMeta, setPreviewMeta] = useState<{ hasBrandProfile: boolean; hasBrandBuilder: boolean; source: string | null } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Load clients list
  useEffect(() => {
    apiFetch('/api/v1/clients').then((r) => r.json()).then(({ data }) => {
      setClients((data ?? []) as Client[])
    }).catch(() => {})
  }, [])

  // Load verticals when client changes
  useEffect(() => {
    if (!clientId) { setVerticals([]); return }
    apiFetch(`/api/v1/clients/${clientId}/brand-verticals`).then((r) => r.json()).then(({ data }) => {
      setVerticals([...(data ?? [])].sort((a: BrandVertical, b: BrandVertical) => a.name.localeCompare(b.name)))
    }).catch(() => {})
  }, [clientId])

  // Load brand preview
  useEffect(() => {
    if (!clientId) { setPreview(null); setPreviewMeta(null); return }
    setLoadingPreview(true)
    const qs = verticalId ? `?verticalId=${verticalId}` : ''
    apiFetch(`/api/v1/clients/${clientId}/brand${qs}`).then((r) => r.json()).then(({ data }) => {
      setPreview(data?.brand ?? null)
      setPreviewMeta({ hasBrandProfile: data?.hasBrandProfile ?? false, hasBrandBuilder: data?.hasBrandBuilder ?? false, source: data?.source ?? null })
    }).catch(() => {}).finally(() => setLoadingPreview(false))
  }, [clientId, verticalId])

  const handleClientChange = (id: string) => {
    const found = clients.find((c) => c.id === id)
    onChange('clientId', id)
    onChange('clientName', found?.name ?? '')
    onChange('verticalId', '')
    onChange('verticalName', '')
  }

  const handleVerticalChange = (id: string) => {
    const found = verticals.find((v) => v.id === id)
    onChange('verticalId', id)
    onChange('verticalName', found?.name ?? '')
  }

  const selectedClientName = clients.find((c) => c.id === clientId)?.name ?? ''
  const selectedVerticalName = verticals.find((v) => v.id === verticalId)?.name ?? 'Company'

  return (
    <div className="space-y-5 p-4">
      <div>
        <div className="mb-0.5 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Brand Context</div>
        <p className="text-[11px] text-muted-foreground">
          Injects the client's brand profile into downstream AI nodes as structured context.
        </p>
      </div>

      {/* Client selector */}
      <div>
        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Client</label>
        <select
          value={clientId}
          onChange={(e) => handleClientChange(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">— Select client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {!clientId && (
          <p className="mt-1 text-[10px] text-amber-500">Required — select a client to enable output.</p>
        )}
      </div>

      {/* Vertical selector */}
      {clientId && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Vertical</label>
          <select
            value={verticalId}
            onChange={(e) => handleVerticalChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">Company</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {verticals.length === 0 && (
            <p className="mt-1 text-[10px] text-muted-foreground">No brand verticals — only Company (general) is available.</p>
          )}
        </div>
      )}

      {/* Data source */}
      {clientId && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Brand data source</label>
          <div className="space-y-1.5">
            {(['both', 'profile', 'builder'] as DataSource[]).map((opt) => {
              const label = opt === 'both' ? 'Profile + Builder (merged)' : opt === 'profile' ? 'Brand Profile only' : 'Brand Builder only'
              const available =
                opt === 'both' ? true
                : opt === 'profile' ? (previewMeta?.hasBrandProfile ?? true)
                : (previewMeta?.hasBrandBuilder ?? true)
              return (
                <label
                  key={opt}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    dataSource === opt
                      ? 'border-blue-400 bg-blue-50/20 text-foreground dark:bg-blue-900/20'
                      : !available
                      ? 'cursor-not-allowed border-border opacity-40'
                      : 'border-border text-muted-foreground hover:border-blue-300 hover:text-foreground'
                  }`}
                >
                  <input
                    type="radio"
                    name="dataSource"
                    value={opt}
                    checked={dataSource === opt}
                    disabled={!available}
                    onChange={() => onChange('dataSource', opt)}
                    className="accent-blue-600"
                  />
                  <span>{label}</span>
                  {!available && opt !== 'both' && (
                    <span className="ml-auto text-[10px] text-muted-foreground">No data</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Brand data preview */}
      {clientId && (
        <div>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-muted-foreground">Brand preview</label>
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className="text-[11px] text-blue-500 hover:text-blue-600"
            >
              {showPreview ? 'Hide' : 'Show'}
            </button>
          </div>

          {showPreview && (
            <div className="mt-2">
              {loadingPreview && <p className="text-[11px] text-muted-foreground">Loading…</p>}
              {!loadingPreview && !preview && (
                <div className="rounded-lg border border-dashed border-border p-3">
                  <p className="text-[11px] text-muted-foreground">
                    No brand data found for {selectedClientName} / {selectedVerticalName}.
                    Go to Client → Branding to add brand data.
                  </p>
                </div>
              )}
              {!loadingPreview && preview && (
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  {preview.brand_name && (
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Brand</span>
                      <p className="text-[11px] text-foreground font-semibold">{preview.brand_name}</p>
                    </div>
                  )}
                  {preview.tagline && (
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Tagline</span>
                      <p className="text-[11px] text-foreground italic">{preview.tagline}</p>
                    </div>
                  )}
                  {preview.messaging?.core_message && (
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Core Message</span>
                      <p className="text-[11px] text-foreground">{preview.messaging.core_message}</p>
                    </div>
                  )}
                  {preview.voice_and_tone?.personality_traits && preview.voice_and_tone.personality_traits.length > 0 && (
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Voice</span>
                      <p className="text-[11px] text-foreground">{preview.voice_and_tone.personality_traits.join(', ')}</p>
                    </div>
                  )}
                  {preview.values && preview.values.length > 0 && (
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Values</span>
                      <p className="text-[11px] text-foreground">{preview.values.join(', ')}</p>
                    </div>
                  )}
                  {preview.do_not_use && preview.do_not_use.length > 0 && (
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Avoid</span>
                      <p className="text-[11px] text-foreground">{preview.do_not_use.join(', ')}</p>
                    </div>
                  )}
                  <div className="pt-1 border-t border-border">
                    <a
                      href={`/clients/${clientId}?tab=branding`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-blue-500 hover:text-blue-600"
                    >
                      View full brand profile →
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
