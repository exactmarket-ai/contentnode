import { useCallback, useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { ANTHROPIC_MODELS, OPENAI_MODELS, GOOGLE_MODELS, MISTRAL_MODELS, GROQ_MODELS, defaultModelForProvider, modelsForProvider } from '@/components/layout/config/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegistryEntry {
  id: string
  roleKey: string
  displayName: string
  description: string | null
  provider: string
  model: string
  updatedAt: string
}

// ─── Provider config ──────────────────────────────────────────────────────────

const REGISTRY_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai',    label: 'OpenAI' },
  { value: 'google',    label: 'Google' },
  { value: 'mistral',   label: 'Mistral' },
  { value: 'groq',      label: 'Groq' },
  { value: 'ollama',    label: 'Ollama (local)' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs  = Math.floor(diff / 1000)
  const mins  = Math.floor(secs  / 60)
  const hours = Math.floor(mins  / 60)
  const days  = Math.floor(hours / 24)
  if (days  > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins  > 0) return `${mins}m ago`
  return 'just now'
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function ModelRegistrySection() {
  const [entries, setEntries]               = useState<RegistryEntry[]>([])
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({})
  const [loading, setLoading]               = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/api/v1/model-registry').then((r) => r.json()),
      apiFetch('/api/v1/model-registry/provider-status').then((r) => r.json()),
    ])
      .then(([reg, ps]) => {
        if (Array.isArray(reg.data)) setEntries(reg.data)
        if (ps.data && typeof ps.data === 'object') setProviderStatus(ps.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSaved = (updated: RegistryEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <Icons.Cpu className="h-4 w-4" style={{ color: '#b4b2a9' }} />
        <h2 className="text-[15px] font-semibold" style={{ color: '#1a1a14' }}>Model Registry</h2>
      </div>
      <p className="text-[13px] mb-4" style={{ color: '#b4b2a9' }}>
        Named model roles used across all workflows. Each role resolves to a provider and model. Node-level and
        workflow-level overrides take precedence — the registry is the default when no override is set.
      </p>

      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#fff', border: '1px solid #e8e7e1' }}>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Icons.Loader2 className="h-5 w-5 animate-spin" style={{ color: '#b4b2a9' }} />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-[13px]" style={{ color: '#b4b2a9' }}>
            No registry entries found. Run the migration to seed the default roles.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e8e7e1', backgroundColor: '#fafaf8' }}>
                  {['Role', 'Used by', 'Provider', 'Model', 'Last updated', ''].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: '#b4b2a9' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0efeb]">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 align-top" style={{ minWidth: 160 }}>
                      <p className="text-[13px] font-medium" style={{ color: '#1a1a14' }}>{entry.displayName}</p>
                      <p className="text-[11px]" style={{ color: '#b4b2a9' }}>{entry.roleKey}</p>
                    </td>
                    <td className="px-4 py-3 align-top" style={{ minWidth: 220 }}>
                      <p className="text-[12px]" style={{ color: '#6b7280' }}>{entry.description ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 align-top" colSpan={4}>
                      <RowEditor entry={entry} providerStatus={providerStatus} onSaved={handleSaved} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Inline editor (provider + model + actions — rendered in the last 4 cols) ─

function RowEditor({
  entry,
  providerStatus,
  onSaved,
}: {
  entry: RegistryEntry
  providerStatus: Record<string, boolean>
  onSaved: (updated: RegistryEntry) => void
}) {
  const [editing, setEditing]         = useState(false)
  const [provider, setProvider]       = useState(entry.provider)
  const [model, setModel]             = useState(entry.model)
  const [ollamaModel, setOllamaModel] = useState(entry.provider === 'ollama' ? entry.model : '')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const handleProviderChange = (p: string) => {
    setProvider(p)
    if (p !== 'ollama') setModel(defaultModelForProvider(p))
    setError('')
  }

  const handleCancel = () => {
    setProvider(entry.provider)
    setModel(entry.model)
    setOllamaModel(entry.provider === 'ollama' ? entry.model : '')
    setEditing(false)
    setError('')
  }

  const handleSave = useCallback(async () => {
    const finalModel = provider === 'ollama' ? ollamaModel.trim() : model
    if (!finalModel) { setError('Model is required'); return }
    setSaving(true); setError('')
    try {
      const res = await apiFetch(`/api/v1/model-registry/${entry.roleKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ provider, model: finalModel }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Save failed')
        return
      }
      const { data } = await res.json()
      onSaved(data)
      setEditing(false)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }, [entry.roleKey, provider, model, ollamaModel, onSaved])

  const hasKeyWarning = editing && provider !== 'ollama' && providerStatus[provider] === false

  if (!editing) {
    return (
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[12px] capitalize" style={{ color: '#374151', minWidth: 100 }}>
          {REGISTRY_PROVIDERS.find((p) => p.value === entry.provider)?.label ?? entry.provider}
        </span>
        <span className="text-[12px] font-mono" style={{ color: '#374151', minWidth: 180 }}>{entry.model}</span>
        <span className="text-[11px]" style={{ color: '#b4b2a9', minWidth: 70 }}>{relativeTime(entry.updatedAt)}</span>
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors hover:opacity-80"
          style={{ color: '#6b7280', border: '1px solid #e8e7e1' }}
        >
          <Icons.Pencil className="h-3 w-3" />
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Provider select */}
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="rounded border px-2 py-1.5 text-[12px] bg-white"
          style={{ borderColor: '#e8e7e1', minWidth: 140 }}
        >
          {REGISTRY_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {/* Model select or text input */}
        {provider === 'ollama' ? (
          <input
            type="text"
            value={ollamaModel}
            onChange={(e) => setOllamaModel(e.target.value)}
            placeholder="e.g. gemma3:12b"
            className="rounded border px-2 py-1.5 text-[12px]"
            style={{ borderColor: '#e8e7e1', minWidth: 200 }}
          />
        ) : (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border px-2 py-1.5 text-[12px] bg-white"
            style={{ borderColor: '#e8e7e1', minWidth: 200 }}
          >
            {modelsForProvider(provider).map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}

        {/* Save / Cancel */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 rounded px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: '#a200ee' }}
        >
          {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : <Icons.Check className="h-3 w-3" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          className="rounded px-3 py-1.5 text-[12px]"
          style={{ color: '#6b7280', border: '1px solid #e8e7e1' }}
        >
          Cancel
        </button>
      </div>

      {/* Warnings and errors */}
      {hasKeyWarning && (
        <p className="flex items-center gap-1.5 text-[11px]" style={{ color: '#b45309' }}>
          <Icons.AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No API key set for {REGISTRY_PROVIDERS.find((p) => p.value === provider)?.label}. Add it in your environment or deployment config.
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-[11px]" style={{ color: '#dc2626' }}>
          <Icons.AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
