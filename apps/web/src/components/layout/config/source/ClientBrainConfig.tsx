import { useEffect, useState } from 'react'
import { useWorkflowStore } from '@/store/workflowStore'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Section definitions ───────────────────────────────────────────────────────

const GTM_SECTIONS = [
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

const DG_BASE_SECTIONS = [
  { key: 'B1', label: 'Revenue & Growth Goals' },
  { key: 'B2', label: 'Sales Process & CRM' },
  { key: 'B3', label: 'Marketing Budget & Resources' },
]

const DG_VERT_SECTIONS = [
  { key: 'S1', label: 'Current Marketing Reality' },
  { key: 'S2', label: 'Offer Clarity' },
  { key: 'S3', label: 'ICP + Buying Psychology' },
  { key: 'S4', label: 'Revenue Goals + Constraints' },
  { key: 'S5', label: 'Sales Process Alignment' },
  { key: 'S6', label: 'Hidden Gold' },
  { key: 'S7', label: 'External Intelligence' },
]

// ── Preset configurations ─────────────────────────────────────────────────────

const PRESETS: Record<string, { gtm: string[]; dgBase: string[]; dgVert: string[]; brand: boolean; label: string }> = {
  lead_magnet: {
    label: 'Lead Magnet Builder',
    gtm: ['02', '08', '16'],
    dgBase: ['B1'],
    dgVert: ['S2', 'S3'],
    brand: true,
  },
  email_nurture: {
    label: 'Email Nurture Sequence',
    gtm: ['08', '10', '12'],
    dgBase: ['B2'],
    dgVert: ['S2', 'S3'],
    brand: true,
  },
  seo_landing: {
    label: 'SEO Landing Page',
    gtm: ['02', '08', '12'],
    dgBase: [],
    dgVert: ['S2', 'S3', 'S7'],
    brand: false,
  },
  linkedin_outreach: {
    label: 'LinkedIn Outreach',
    gtm: ['02', '07', '08'],
    dgBase: ['B2'],
    dgVert: ['S3'],
    brand: false,
  },
  ad_copy: {
    label: 'Ad Copy',
    gtm: ['08', '12'],
    dgBase: [],
    dgVert: ['S2', 'S3'],
    brand: true,
  },
  full_brain: {
    label: 'Full Brain',
    gtm: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18'],
    dgBase: ['B1', 'B2', 'B3'],
    dgVert: ['S1','S2','S3','S4','S5','S6','S7'],
    brand: true,
  },
}

// ── Shared toggle button ──────────────────────────────────────────────────────

function Toggle({
  active,
  id,
  label,
  prefix,
  onClick,
}: {
  active: boolean
  id: string
  label: string
  prefix?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/30',
        active ? 'border-orange-400 bg-orange-50/50' : 'border-transparent',
      )}
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded border"
        style={{
          backgroundColor: active ? '#ea580c' : 'transparent',
          borderColor: active ? '#ea580c' : '#d1d5db',
        }}
      />
      {prefix && (
        <span className="w-6 shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">{prefix}</span>
      )}
      <span className={cn('text-sm', active ? 'text-orange-700' : '')}>{label}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">{id}</span>
    </button>
  )
}

// ── Main config component ─────────────────────────────────────────────────────

interface Vertical { id: string; name: string }

export function ClientBrainConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const clientId = useWorkflowStore((s) => s.workflow.clientId ?? undefined)
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [clientName, setClientName] = useState<string>('')
  const [openGroup, setOpenGroup] = useState<string | null>('gtm')

  const verticalId    = (config.verticalId    as string)   ?? ''
  const gtmSections   = (config.gtmSections   as string[]) ?? []
  const dgBaseSections = (config.dgBaseSections as string[]) ?? []
  const dgVertSections = (config.dgVertSections as string[]) ?? []
  const includeBrand  = (config.includeBrand  as boolean)  ?? false

  useEffect(() => {
    if (!clientId) return
    Promise.all([
      apiFetch(`/api/v1/clients/${clientId}`).then((r) => r.json()),
      apiFetch(`/api/v1/clients/${clientId}/verticals`).then((r) => r.json()),
    ]).then(([client, { data }]) => {
      if (client?.data?.name) { setClientName(client.data.name); onChange('clientName', client.data.name) }
      setVerticals(data ?? [])
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const needsVertical = gtmSections.length > 0 || dgVertSections.length > 0

  const applyPreset = (key: string) => {
    const p = PRESETS[key]
    if (!p) return
    onChange('gtmSections', p.gtm)
    onChange('dgBaseSections', p.dgBase)
    onChange('dgVertSections', p.dgVert)
    onChange('includeBrand', p.brand)
  }

  const toggleGtm = (num: string) => {
    const next = gtmSections.includes(num)
      ? gtmSections.filter((s) => s !== num)
      : [...gtmSections, num]
    onChange('gtmSections', next)
  }

  const toggleDgBase = (key: string) => {
    const next = dgBaseSections.includes(key)
      ? dgBaseSections.filter((s) => s !== key)
      : [...dgBaseSections, key]
    onChange('dgBaseSections', next)
  }

  const toggleDgVert = (key: string) => {
    const next = dgVertSections.includes(key)
      ? dgVertSections.filter((s) => s !== key)
      : [...dgVertSections, key]
    onChange('dgVertSections', next)
  }

  const selectVertical = (v: Vertical) => {
    onChange('verticalId', v.id)
    onChange('verticalName', v.name)
  }

  const totalSelected = gtmSections.length + dgBaseSections.length + dgVertSections.length + (includeBrand ? 1 : 0)

  if (!clientId) {
    return (
      <div className="rounded-md bg-muted/40 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">No client is associated with this workflow.</p>
        <p className="mt-1 text-[11px] text-muted-foreground/70">Assign a client in the workflow settings to use the Client Brain node.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Presets */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">Quick Presets</label>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className="rounded-md border border-border bg-card px-2 py-1.5 text-left text-[11px] font-medium text-foreground hover:border-orange-400 hover:bg-orange-50/40 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {totalSelected > 0 && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {totalSelected} source{totalSelected !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      {/* Vertical picker — shown when GTM or DG vertical sections are needed */}
      {(needsVertical || true) && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-foreground">
            Vertical {needsVertical && <span className="text-orange-500">*</span>}
          </label>
          {verticals.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No verticals assigned to this client.</p>
          ) : (
            <div className="space-y-1">
              {verticals.map((v) => (
                <button
                  key={v.id}
                  onClick={() => selectVertical(v)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    verticalId === v.id ? 'border-orange-400 bg-orange-50/50 text-orange-700' : 'border-border hover:bg-muted/30',
                  )}
                >
                  {verticalId === v.id && <span className="text-orange-500">✓</span>}
                  <span className="flex-1">{v.name}</span>
                </button>
              ))}
            </div>
          )}
          {needsVertical && !verticalId && (
            <p className="mt-1.5 text-[10px] text-amber-600">Select a vertical — required for GTM and Demand Gen vertical sections.</p>
          )}
        </div>
      )}

      {/* Section groups */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-foreground">Brain Sections</label>

        {/* GTM Framework */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setOpenGroup(openGroup === 'gtm' ? null : 'gtm')}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-xs font-semibold">GTM Framework</span>
              {gtmSections.length > 0 && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                  {gtmSections.length}/{GTM_SECTIONS.length}
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-xs">{openGroup === 'gtm' ? '▲' : '▼'}</span>
          </button>
          {openGroup === 'gtm' && (
            <div className="border-t border-border px-2 py-2 space-y-0.5">
              <div className="mb-1.5 flex gap-2 px-1">
                <button onClick={() => onChange('gtmSections', GTM_SECTIONS.map((s) => s.num))} className="text-[10px] text-blue-500 underline hover:text-blue-700">All</button>
                <button onClick={() => onChange('gtmSections', [])} className="text-[10px] text-muted-foreground underline hover:text-foreground">None</button>
              </div>
              {GTM_SECTIONS.map((s) => (
                <Toggle
                  key={s.num}
                  active={gtmSections.includes(s.num)}
                  id={`§${s.num}`}
                  label={clientName ? s.label.replace('[Client]', clientName) : s.label}
                  onClick={() => toggleGtm(s.num)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Demand Gen — Company-Wide */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setOpenGroup(openGroup === 'dgbase' ? null : 'dgbase')}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="text-xs font-semibold">Demand Gen — Company-Wide</span>
              {dgBaseSections.length > 0 && (
                <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                  {dgBaseSections.length}/{DG_BASE_SECTIONS.length}
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-xs">{openGroup === 'dgbase' ? '▲' : '▼'}</span>
          </button>
          {openGroup === 'dgbase' && (
            <div className="border-t border-border px-2 py-2 space-y-0.5">
              {DG_BASE_SECTIONS.map((s) => (
                <Toggle
                  key={s.key}
                  active={dgBaseSections.includes(s.key)}
                  id={s.key}
                  label={s.label}
                  onClick={() => toggleDgBase(s.key)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Demand Gen — Vertical */}
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setOpenGroup(openGroup === 'dgvert' ? null : 'dgvert')}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              <span className="text-xs font-semibold">Demand Gen — Vertical</span>
              {dgVertSections.length > 0 && (
                <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                  {dgVertSections.length}/{DG_VERT_SECTIONS.length}
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-xs">{openGroup === 'dgvert' ? '▲' : '▼'}</span>
          </button>
          {openGroup === 'dgvert' && (
            <div className="border-t border-border px-2 py-2 space-y-0.5">
              {DG_VERT_SECTIONS.map((s) => (
                <Toggle
                  key={s.key}
                  active={dgVertSections.includes(s.key)}
                  id={s.key}
                  label={s.label}
                  onClick={() => toggleDgVert(s.key)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Brand Profile */}
        <button
          onClick={() => onChange('includeBrand', !includeBrand)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/30',
            includeBrand ? 'border-orange-400 bg-orange-50/50' : 'border-border',
          )}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: includeBrand ? '#ea580c' : '#9ca3af' }}
          />
          <span className={cn('text-xs font-semibold', includeBrand ? 'text-orange-700' : '')}>Brand Profile</span>
          <span className={cn('ml-auto text-[10px]', includeBrand ? 'text-orange-500 font-medium' : 'text-muted-foreground')}>
            {includeBrand ? 'Included' : 'Excluded'}
          </span>
        </button>
      </div>

    </div>
  )
}
