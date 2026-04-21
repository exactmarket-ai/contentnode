import { useEffect, useRef, useState } from 'react'
import { useVerticalTerm } from '@/hooks/useVerticalTerm'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import * as Icons from 'lucide-react'

const SECTIONS = [
  { num: '01', label: 'Vertical Overview' },
  { num: '02', label: 'Customer Definition + Profile' },
  { num: '03', label: 'Market Pressures + Stats' },
  { num: '04', label: 'Core Challenges' },
  { num: '05', label: 'Solutions + Service Stack' },
  { num: '06', label: 'Why [Client]' },
  { num: '07', label: 'Segments + Buyer Profiles' },
  { num: '08', label: 'Messaging Framework' },
  { num: '09', label: 'Proof Points + Case Studies' },
  { num: '10', label: 'Objection Handling' },
  { num: '11', label: 'Brand Voice Examples' },
  { num: '12', label: 'Competitive Differentiation' },
  { num: '13', label: 'Customer Quotes + Testimonials' },
  { num: '14', label: 'Campaign Themes + Asset Mapping' },
  { num: '15', label: 'Frequently Asked Questions' },
  { num: '16', label: 'Content Funnel Mapping' },
  { num: '17', label: 'Regulatory + Compliance' },
  { num: '18', label: 'CTAs + Next Steps' },
]

const ALL_NUMS = SECTIONS.map((s) => s.num)

interface Vertical { id: string; name: string }

export function GtmFrameworkConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const clientId = useWorkflowStore((s) => s.workflow.clientId ?? undefined)
  const { isLead } = useCurrentUser()
  const verticalTerm = useVerticalTerm()
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const sections = (config.sections as string[] | undefined) ?? ALL_NUMS
  const verticalId = (config.verticalId as string) ?? ''

  useEffect(() => {
    if (!clientId) return
    // Fetch client name and verticals in parallel
    Promise.all([
      apiFetch(`/api/v1/clients/${clientId}`).then((r) => r.json()),
      apiFetch(`/api/v1/clients/${clientId}/verticals`).then((r) => r.json()),
    ]).then(([client, { data }]) => {
      if (client?.data?.name) onChange('clientName', client.data.name)
      setVerticals([...(data ?? [])].sort((a: Vertical, b: Vertical) => a.name.localeCompare(b.name)))
    }).catch(() => {})
  }, [clientId])

  const toggle = (num: string) => {
    const next = sections.includes(num)
      ? sections.filter((s) => s !== num)
      : [...sections, num]
    onChange('sections', next)
  }

  const selectVertical = (v: Vertical) => {
    onChange('verticalId', v.id)
    onChange('verticalName', v.name)
  }

  const clientName = (config.clientName as string) || null

  const resolveLabel = (label: string) =>
    clientName ? label.replace('[Client]', clientName) : label

  const handleAddVertical = async () => {
    const name = newName.trim()
    if (!name || !clientId) return
    setSaving(true)
    setAddError(null)
    try {
      // 1. Create the vertical
      const res = await apiFetch('/api/v1/verticals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!res.ok) {
        setAddError(json.error ?? 'Failed to create vertical')
        setSaving(false)
        return
      }
      const vertical: Vertical = json.data
      // 2. Assign to client
      await apiFetch(`/api/v1/clients/${clientId}/verticals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verticalId: vertical.id }),
      })
      setVerticals((prev) => [...prev, vertical].sort((a, b) => a.name.localeCompare(b.name)))
      selectVertical(vertical)
      setNewName('')
      setAdding(false)
    } catch {
      setAddError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Vertical selector */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">{verticalTerm}</label>
          {isLead && clientId && !adding && (
            <button
              onClick={() => { setAdding(true); setAddError(null); setTimeout(() => inputRef.current?.focus(), 50) }}
              className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700"
            >
              <Icons.Plus className="h-3 w-3" />Add vertical
            </button>
          )}
        </div>
        {!clientId ? (
          <p className="text-[11px] text-muted-foreground">No client is associated with this workflow.</p>
        ) : (
          <>
            {verticals.length === 0 && !adding && (
              <p className="text-[11px] text-muted-foreground">
                No verticals found.{isLead ? ' Use the button above to add one.' : ' Add verticals in the client\'s Structure tab.'}
              </p>
            )}
            <div className="space-y-1">
              {/* Company (general / no vertical) — always first */}
              <button
                onClick={() => { onChange('verticalId', ''); onChange('verticalName', '') }}
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors"
                style={!verticalId
                  ? { borderColor: '#185fa5', backgroundColor: '#f0f6fd', color: '#0c447c' }
                  : { borderColor: 'hsl(var(--border))' }
                }
              >
                {!verticalId && <span style={{ color: '#185fa5' }}>✓</span>}
                <span className="flex-1">Company</span>
              </button>
              {verticals.map((v) => (
                <button
                  key={v.id}
                  onClick={() => selectVertical(v)}
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors"
                  style={verticalId === v.id
                    ? { borderColor: '#185fa5', backgroundColor: '#f0f6fd', color: '#0c447c' }
                    : { borderColor: 'hsl(var(--border))' }
                  }
                >
                  {verticalId === v.id && (
                    <span style={{ color: '#185fa5' }}>✓</span>
                  )}
                  <span className="flex-1">{v.name}</span>
                </button>
              ))}
            </div>
            {adding && (
              <div className="mt-1 space-y-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddVertical(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }}
                  placeholder="Vertical name…"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                />
                {addError && <p className="text-[11px] text-red-500">{addError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddVertical}
                    disabled={saving || !newName.trim()}
                    className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 hover:bg-blue-700"
                  >
                    {saving ? <Icons.Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {saving ? 'Saving…' : 'Add'}
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewName(''); setAddError(null) }}
                    className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Section toggles */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">Sections to include</label>
          <div className="flex gap-2">
            <button
              onClick={() => onChange('sections', ALL_NUMS)}
              className="text-[10px] text-blue-500 underline hover:text-blue-700"
            >Select all</button>
            <button
              onClick={() => onChange('sections', [])}
              className="text-[10px] text-muted-foreground underline hover:text-foreground"
            >None</button>
          </div>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          Selected sections will be assembled as context for downstream AI nodes.
        </p>
        <div className="space-y-1">
          {SECTIONS.map((s) => {
            const active = sections.includes(s.num)
            return (
              <button
                key={s.num}
                onClick={() => toggle(s.num)}
                className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/30"
                style={active
                  ? { borderColor: '#185fa5', backgroundColor: '#f0f6fd' }
                  : { borderColor: 'transparent' }
                }
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded border"
                  style={{
                    backgroundColor: active ? '#185fa5' : 'transparent',
                    borderColor: active ? '#185fa5' : '#d1d5db',
                  }}
                />
                <span className="text-[10px] font-bold tabular-nums text-muted-foreground w-4">{s.num}</span>
                <span className="text-sm" style={{ color: active ? '#0c447c' : undefined }}>{resolveLabel(s.label)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
