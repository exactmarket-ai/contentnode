import { useEffect, useState } from 'react'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'

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
  const [verticals, setVerticals] = useState<Vertical[]>([])

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
      setVerticals(data ?? [])
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

  return (
    <div className="space-y-5">
      {/* Vertical selector */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-foreground">Vertical</label>
        {!clientId ? (
          <p className="text-[11px] text-muted-foreground">No client is associated with this workflow.</p>
        ) : verticals.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No verticals found — add verticals in the client's Structure tab.</p>
        ) : (
          <div className="space-y-1">
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
