import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { DemandPilot } from '@/components/pilot/DemandPilot'
import { DimensionBar, type DimensionItem } from '@/components/layout/DimensionBar'
import { useVerticalTerm } from '@/hooks/useVerticalTerm'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

// Check whether a section object has any non-empty string values (ignores auto-generated id fields)
function hasData(obj: unknown, key = ''): boolean {
  if (key === 'id') return false
  if (typeof obj === 'string') return obj.trim().length > 0
  if (Array.isArray(obj)) return obj.some((item) => hasData(item))
  if (typeof obj === 'object' && obj !== null)
    return Object.entries(obj as Record<string, unknown>).some(([k, v]) => hasData(v, k))
  return false
}

// Recursively add uid() to array items that don't have an id field
function applyAiSuggestion(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'object' && item !== null) {
        const { id: _id, ...rest } = item as Record<string, unknown>
        return { id: uid(), ...rest }
      }
      return item
    })
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = applyAiSuggestion(v)
    }
    return result
  }
  return value
}

// ── Default data ──────────────────────────────────────────────────────────────

function defaultDemandGen() {
  return {
    // Section 1 — Current Marketing Reality
    s1: {
      channels: [{ id: uid(), name: '', status: '', whatsWorking: '', monthlySpend: '' }],
      assets: [{ id: uid(), type: '', urlOrFile: '', notes: '' }],
    },
    // Section 2 — Offer Clarity
    s2: {
      offers: [{ id: uid(), offer: '', problemSolved: '', outcome: '', timeToValue: '', riskReversal: '' }],
      proofPoints: [{ id: uid(), text: '', source: '' }],
    },
    // Section 3 — ICP + Buying Psychology
    s3: {
      personas: [{ id: uid(), role: '', industry: '', companyStage: '', triggerEvents: '', failedSolutions: '', objections: '', valuesmost: '' }],
    },
    // Section 4 — Revenue Goals + Constraints
    s4: {
      goals: [{ id: uid(), period: '', revenueTarget: '', leadTarget: '', budget: '', capacity: '', closeRate: '', timeline: '' }],
    },
    // Section 5 — Sales Process Alignment
    s5: {
      salesMethod: '',
      followUpProcess: '',
      crm: '',
      avgSalesCycle: '',
      stages: [{ id: uid(), stage: '', owner: '', notes: '' }],
    },
    // Section 6 — Hidden Gold
    s6: {
      customerStories: [{ id: uid(), type: 'best', description: '', whyOrWhy: '' }],
      faqs: [{ id: uid(), question: '', answer: '' }],
    },
    // Section 7 — External Intelligence
    s7: {
      findings: [{ id: uid(), source: '', url: '', summary: '', contradicts: '' }],
    },
  }
}

type DemandGenData = ReturnType<typeof defaultDemandGen>

// ── Shared UI components ──────────────────────────────────────────────────────

function SectionHeader({ num, title, subtitle }: { num: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-orange-500">Section {num}</div>
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      {subtitle && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function DgLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</label>
}

function DgInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function DgTextarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-3 flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors"
    >
      <Icons.Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 transition-colors"
    >
      <Icons.X className="h-3.5 w-3.5" />
    </button>
  )
}

function DgCard({ children, onRemove, canRemove = true }: { children: React.ReactNode; onRemove: () => void; canRemove?: boolean }) {
  return (
    <div className="relative rounded-lg border border-border bg-card p-4 mb-3">
      {canRemove && (
        <div className="absolute right-2 top-2">
          <RemoveButton onClick={onRemove} />
        </div>
      )}
      <div className="space-y-3 pr-6">{children}</div>
    </div>
  )
}

function DgField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <DgLabel>{label}</DgLabel>
      {children}
    </div>
  )
}

function GtmRef({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[10px] italic text-muted-foreground/60">▸ {children}</p>
  )
}

// ── Section components ────────────────────────────────────────────────────────

function S1({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const channels = dg.s1.channels
  const assets = dg.s1.assets

  return (
    <div>
      <SectionHeader num="01" title="Current Marketing Reality" subtitle="What's actually happening right now — not aspirational." />

      <h3 className="mb-3 text-sm font-semibold text-foreground">Active Channels</h3>
      {channels.map((ch, i) => (
        <DgCard key={ch.id} onRemove={() => set((d) => { d.s1.channels = d.s1.channels.filter((_, j) => j !== i) })} canRemove={channels.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Channel">
              <DgInput value={ch.name} onChange={(v) => set((d) => { d.s1.channels[i].name = v })} placeholder="e.g. LinkedIn Ads, SEO, Cold Email" />
            </DgField>
            <DgField label="Status">
              <DgInput value={ch.status} onChange={(v) => set((d) => { d.s1.channels[i].status = v })} placeholder="Active / Paused / Testing" />
            </DgField>
          </div>
          <DgField label="What's Working">
            <DgInput value={ch.whatsWorking} onChange={(v) => set((d) => { d.s1.channels[i].whatsWorking = v })} placeholder="What's performing well on this channel" />
          </DgField>
          <DgField label="Monthly Spend / Budget">
            <DgInput value={ch.monthlySpend} onChange={(v) => set((d) => { d.s1.channels[i].monthlySpend = v })} placeholder="e.g. $2,000/mo or unknown" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add channel" onClick={() => set((d) => { d.s1.channels.push({ id: uid(), name: '', status: '', whatsWorking: '', monthlySpend: '' }) })} />

      <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">Existing Assets</h3>
      {assets.map((a, i) => (
        <DgCard key={a.id} onRemove={() => set((d) => { d.s1.assets = d.s1.assets.filter((_, j) => j !== i) })} canRemove={assets.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Asset Type">
              <DgInput value={a.type} onChange={(v) => set((d) => { d.s1.assets[i].type = v })} placeholder="Website, Email list, Ad account…" />
            </DgField>
            <DgField label="URL or File">
              <DgInput value={a.urlOrFile} onChange={(v) => set((d) => { d.s1.assets[i].urlOrFile = v })} placeholder="Link or filename" />
            </DgField>
          </div>
          <DgField label="Notes">
            <DgInput value={a.notes} onChange={(v) => set((d) => { d.s1.assets[i].notes = v })} placeholder="e.g. Email list ~3,000 contacts, last cleaned 2024" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add asset" onClick={() => set((d) => { d.s1.assets.push({ id: uid(), type: '', urlOrFile: '', notes: '' }) })} />

      <GtmRef>Populated via deep web scrape + ad library scrape. Human fills gaps.</GtmRef>
    </div>
  )
}

function S2({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const offers = dg.s2.offers
  const proofPoints = dg.s2.proofPoints

  return (
    <div>
      <SectionHeader num="02" title="Offer Clarity" subtitle="Plain English. Most clients are confused here." />

      <h3 className="mb-3 text-sm font-semibold text-foreground">Offers</h3>
      {offers.map((o, i) => (
        <DgCard key={o.id} onRemove={() => set((d) => { d.s2.offers = d.s2.offers.filter((_, j) => j !== i) })} canRemove={offers.length > 1}>
          <DgField label="Primary Offer (plain English, no jargon)">
            <DgInput value={o.offer} onChange={(v) => set((d) => { d.s2.offers[i].offer = v })} placeholder="What do you actually sell?" />
          </DgField>
          <DgField label="Problem It Solves">
            <DgTextarea value={o.problemSolved} onChange={(v) => set((d) => { d.s2.offers[i].problemSolved = v })} placeholder="What specific problem does this solve?" rows={2} />
          </DgField>
          <DgField label="Outcome the Client Gets">
            <DgInput value={o.outcome} onChange={(v) => set((d) => { d.s2.offers[i].outcome = v })} placeholder="What measurable result do they walk away with?" />
          </DgField>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Time to Value">
              <DgInput value={o.timeToValue} onChange={(v) => set((d) => { d.s2.offers[i].timeToValue = v })} placeholder="e.g. Results in 30 days" />
            </DgField>
            <DgField label="Risk Reversal / Guarantee">
              <DgInput value={o.riskReversal} onChange={(v) => set((d) => { d.s2.offers[i].riskReversal = v })} placeholder="e.g. Money back, free pilot" />
            </DgField>
          </div>
        </DgCard>
      ))}
      <AddButton label="Add offer" onClick={() => set((d) => { d.s2.offers.push({ id: uid(), offer: '', problemSolved: '', outcome: '', timeToValue: '', riskReversal: '' }) })} />

      <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">Proof Points</h3>
      {proofPoints.map((p, i) => (
        <DgCard key={p.id} onRemove={() => set((d) => { d.s2.proofPoints = d.s2.proofPoints.filter((_, j) => j !== i) })} canRemove={proofPoints.length > 1}>
          <DgField label="Proof Point / Result">
            <DgInput value={p.text} onChange={(v) => set((d) => { d.s2.proofPoints[i].text = v })} placeholder="e.g. Reduced churn by 40% in 60 days" />
          </DgField>
          <DgField label="Source">
            <DgInput value={p.source} onChange={(v) => set((d) => { d.s2.proofPoints[i].source = v })} placeholder="Client name, case study URL, or internal data" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add proof point" onClick={() => set((d) => { d.s2.proofPoints.push({ id: uid(), text: '', source: '' }) })} />

      <GtmRef>Pulls from GTM S01 (positioning), S05 (solutions), S09 (proof points). Adds time-to-value and risk reversal.</GtmRef>
    </div>
  )
}

function S3({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const personas = dg.s3.personas

  return (
    <div>
      <SectionHeader num="03" title="ICP + Buying Psychology" subtitle="Not demographics — what makes them buy." />

      {personas.map((p, i) => (
        <DgCard key={p.id} onRemove={() => set((d) => { d.s3.personas = d.s3.personas.filter((_, j) => j !== i) })} canRemove={personas.length > 1}>
          <div className="grid grid-cols-3 gap-3">
            <DgField label="Role / Title">
              <DgInput value={p.role} onChange={(v) => set((d) => { d.s3.personas[i].role = v })} placeholder="e.g. VP of Marketing" />
            </DgField>
            <DgField label="Industry">
              <DgInput value={p.industry} onChange={(v) => set((d) => { d.s3.personas[i].industry = v })} placeholder="e.g. B2B SaaS" />
            </DgField>
            <DgField label="Company Stage">
              <DgInput value={p.companyStage} onChange={(v) => set((d) => { d.s3.personas[i].companyStage = v })} placeholder="e.g. Series A, 50–200 employees" />
            </DgField>
          </div>
          <DgField label="Trigger Events (what makes them look for a solution)">
            <DgTextarea value={p.triggerEvents} onChange={(v) => set((d) => { d.s3.personas[i].triggerEvents = v })} placeholder="e.g. Just hired a new CMO, missed pipeline targets, competitor won a deal…" rows={2} />
          </DgField>
          <DgField label="What They've Already Tried (and failed)">
            <DgTextarea value={p.failedSolutions} onChange={(v) => set((d) => { d.s3.personas[i].failedSolutions = v })} placeholder="e.g. Tried agency X, built in-house, used tool Y but it didn't stick…" rows={2} />
          </DgField>
          <DgField label="Objections Before Buying">
            <DgTextarea value={p.objections} onChange={(v) => set((d) => { d.s3.personas[i].objections = v })} placeholder="e.g. Too expensive, we already have someone, we tried this before…" rows={2} />
          </DgField>
          <DgField label="What They Value Most">
            <DgInput value={p.valuesmost} onChange={(v) => set((d) => { d.s3.personas[i].valuesmost = v })} placeholder="Price · Speed · Quality · Status · ROI · Risk reduction" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add persona" onClick={() => set((d) => { d.s3.personas.push({ id: uid(), role: '', industry: '', companyStage: '', triggerEvents: '', failedSolutions: '', objections: '', valuesmost: '' }) })} />

      <GtmRef>Pulls from GTM S02, S07, S10. Adds trigger events and "what they've tried" — buying psychology GTM doesn't capture.</GtmRef>
    </div>
  )
}

function S4({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const goals = dg.s4.goals

  return (
    <div>
      <SectionHeader num="04" title="Revenue Goals + Constraints" subtitle="Without this you can't build a real system." />

      {goals.map((g, i) => (
        <DgCard key={g.id} onRemove={() => set((d) => { d.s4.goals = d.s4.goals.filter((_, j) => j !== i) })} canRemove={goals.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Period">
              <DgInput value={g.period} onChange={(v) => set((d) => { d.s4.goals[i].period = v })} placeholder="e.g. Q2 2026, Monthly" />
            </DgField>
            <DgField label="Revenue Target">
              <DgInput value={g.revenueTarget} onChange={(v) => set((d) => { d.s4.goals[i].revenueTarget = v })} placeholder="e.g. $50,000" />
            </DgField>
            <DgField label="Lead Volume Target">
              <DgInput value={g.leadTarget} onChange={(v) => set((d) => { d.s4.goals[i].leadTarget = v })} placeholder="e.g. 40 MQLs" />
            </DgField>
            <DgField label="Ad / Tool Budget">
              <DgInput value={g.budget} onChange={(v) => set((d) => { d.s4.goals[i].budget = v })} placeholder="e.g. $5,000/mo" />
            </DgField>
            <DgField label="Capacity (leads they can handle)">
              <DgInput value={g.capacity} onChange={(v) => set((d) => { d.s4.goals[i].capacity = v })} placeholder="e.g. 10 per week max" />
            </DgField>
            <DgField label="Close Rate (if known)">
              <DgInput value={g.closeRate} onChange={(v) => set((d) => { d.s4.goals[i].closeRate = v })} placeholder="e.g. 20%" />
            </DgField>
          </div>
          <DgField label="Timeline Expectations">
            <DgInput value={g.timeline} onChange={(v) => set((d) => { d.s4.goals[i].timeline = v })} placeholder="e.g. Want leads within 30 days, patient for 90-day SEO build" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add goal / period" onClick={() => set((d) => { d.s4.goals.push({ id: uid(), period: '', revenueTarget: '', leadTarget: '', budget: '', capacity: '', closeRate: '', timeline: '' }) })} />

      <GtmRef>No GTM equivalent — demand gen specific.</GtmRef>
    </div>
  )
}

function S5({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const stages = dg.s5.stages

  return (
    <div>
      <SectionHeader num="05" title="Sales Process Alignment" subtitle="Marketing without this = wasted leads." />

      <div className="mb-5 grid grid-cols-2 gap-4">
        <DgField label="Sales Method">
          <DgInput value={dg.s5.salesMethod} onChange={(v) => set((d) => { d.s5.salesMethod = v })} placeholder="Calls · Demos · Self-serve · High-touch" />
        </DgField>
        <DgField label="CRM Used">
          <DgInput value={dg.s5.crm} onChange={(v) => set((d) => { d.s5.crm = v })} placeholder="e.g. HubSpot, Salesforce, none" />
        </DgField>
        <DgField label="Average Sales Cycle">
          <DgInput value={dg.s5.avgSalesCycle} onChange={(v) => set((d) => { d.s5.avgSalesCycle = v })} placeholder="e.g. 2–4 weeks, 3 months" />
        </DgField>
        <DgField label="Follow-Up Process">
          <DgInput value={dg.s5.followUpProcess} onChange={(v) => set((d) => { d.s5.followUpProcess = v })} placeholder="e.g. SDR calls within 1 hour, email sequence" />
        </DgField>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-foreground">Sales Stages</h3>
      {stages.map((s, i) => (
        <DgCard key={s.id} onRemove={() => set((d) => { d.s5.stages = d.s5.stages.filter((_, j) => j !== i) })} canRemove={stages.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Stage">
              <DgInput value={s.stage} onChange={(v) => set((d) => { d.s5.stages[i].stage = v })} placeholder="e.g. MQL, SQL, Demo, Proposal, Closed" />
            </DgField>
            <DgField label="Owner">
              <DgInput value={s.owner} onChange={(v) => set((d) => { d.s5.stages[i].owner = v })} placeholder="e.g. Marketing, SDR, AE" />
            </DgField>
          </div>
          <DgField label="Notes">
            <DgInput value={s.notes} onChange={(v) => set((d) => { d.s5.stages[i].notes = v })} placeholder="Criteria, SLAs, or handoff details" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add stage" onClick={() => set((d) => { d.s5.stages.push({ id: uid(), stage: '', owner: '', notes: '' }) })} />

      <GtmRef>No GTM equivalent. References GTM S18 (CTAs + Next Steps) for funnel alignment.</GtmRef>
    </div>
  )
}

function S6({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const stories = dg.s6.customerStories
  const faqs = dg.s6.faqs

  const STORY_TYPES = [
    { value: 'best', label: 'Best Customer' },
    { value: 'worst', label: 'Worst Customer' },
    { value: 'almost', label: 'Almost Bought' },
    { value: 'other', label: 'Other' },
  ]

  return (
    <div>
      <SectionHeader num="06" title="Hidden Gold" subtitle="What most systems never ask — unlocks elite campaigns." />

      <h3 className="mb-3 text-sm font-semibold text-foreground">Customer Stories</h3>
      {stories.map((s, i) => (
        <DgCard key={s.id} onRemove={() => set((d) => { d.s6.customerStories = d.s6.customerStories.filter((_, j) => j !== i) })} canRemove={stories.length > 1}>
          <DgField label="Story Type">
            <div className="flex flex-wrap gap-2">
              {STORY_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => set((d) => { d.s6.customerStories[i].type = t.value })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    s.type === t.value
                      ? 'border-orange-400 bg-orange-50 text-orange-700'
                      : 'border-border text-muted-foreground hover:border-orange-300',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </DgField>
          <DgField label="Description">
            <DgTextarea value={s.description} onChange={(v) => set((d) => { d.s6.customerStories[i].description = v })} placeholder="Who were they? What happened?" rows={3} />
          </DgField>
          <DgField label="Why (what made them the best / worst / almost)">
            <DgTextarea value={s.whyOrWhy} onChange={(v) => set((d) => { d.s6.customerStories[i].whyOrWhy = v })} placeholder="The key insight here — what does this tell you about who to target (or avoid)?" rows={2} />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add story" onClick={() => set((d) => { d.s6.customerStories.push({ id: uid(), type: 'best', description: '', whyOrWhy: '' }) })} />

      <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">Frequently Asked Questions</h3>
      {faqs.map((f, i) => (
        <DgCard key={f.id} onRemove={() => set((d) => { d.s6.faqs = d.s6.faqs.filter((_, j) => j !== i) })} canRemove={faqs.length > 1}>
          <DgField label="Question">
            <DgInput value={f.question} onChange={(v) => set((d) => { d.s6.faqs[i].question = v })} placeholder="What do prospects always ask before buying?" />
          </DgField>
          <DgField label="Answer">
            <DgTextarea value={f.answer} onChange={(v) => set((d) => { d.s6.faqs[i].answer = v })} placeholder="The honest answer (becomes objection-handling copy)" rows={2} />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add FAQ" onClick={() => set((d) => { d.s6.faqs.push({ id: uid(), question: '', answer: '' }) })} />

      <GtmRef>Extends GTM S10 (objections), S13 (testimonials), S15 (FAQs). Adds qualitative stories and buying triggers.</GtmRef>
    </div>
  )
}

function S7({ dg, set }: { dg: DemandGenBaseData; set: (fn: (d: DemandGenBaseData) => void) => void }) {
  const findings = dg.s7.findings

  const SOURCE_TYPES = ['G2 / Capterra', 'Google Reviews', 'Reddit', 'LinkedIn', 'News / Press', 'Competitor', 'Search Intent', 'Other']

  return (
    <div>
      <SectionHeader num="07" title="External Intelligence" subtitle="What the market says — pressure-tests everything above." />

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <Icons.AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            This section surfaces what the <strong>market</strong> says about the client — not what the client says about themselves.
            Contradictions between this section and Sections 2–3 are flagged automatically.
          </p>
        </div>
      </div>

      {findings.map((f, i) => (
        <DgCard key={f.id} onRemove={() => set((d) => { d.s7.findings = d.s7.findings.filter((_, j) => j !== i) })}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Source Type">
              <select
                value={f.source}
                onChange={(e) => set((d) => { d.s7.findings[i].source = e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select source…</option>
                {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </DgField>
            <DgField label="URL">
              <DgInput value={f.url} onChange={(v) => set((d) => { d.s7.findings[i].url = v })} placeholder="Link to source" />
            </DgField>
          </div>
          <DgField label="Key Finding / Summary">
            <DgTextarea value={f.summary} onChange={(v) => set((d) => { d.s7.findings[i].summary = v })} placeholder="What did this source reveal? Quote directly where possible." rows={3} />
          </DgField>
          <DgField label="Contradicts Client Claim (if any)">
            <DgInput value={f.contradicts} onChange={(v) => set((d) => { d.s7.findings[i].contradicts = v })} placeholder="e.g. Client claims 'best support' but reviews mention slow response times" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add finding" onClick={() => set((d) => { d.s7.findings.push({ id: uid(), source: '', url: '', summary: '', contradicts: '' }) })} />

      <GtmRef>Auto-populated via scraping. Flags contradictions with what client claimed in earlier sections.</GtmRef>
    </div>
  )
}

// ── Intake: helpers ───────────────────────────────────────────────────────────

function dgFileIcon(mime: string): string {
  if (mime.startsWith('audio/') || mime.includes('mp3') || mime.includes('wav')) return '🎙️'
  if (mime.startsWith('video/') || mime.includes('mp4')) return '🎬'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('word') || mime.includes('docx')) return '📝'
  if (mime.includes('spreadsheet') || mime.includes('csv')) return '📊'
  if (mime.includes('html') || mime.includes('text/plain')) return '🌐'
  return '📎'
}

function dgFormatBytes(b: number): string {
  if (b === 0) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

interface DgAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  summaryStatus: string
  summary: string | null
}

// ── Intake: attachment row ────────────────────────────────────────────────────

function DgAttachmentRow({ attachment: a, base, deletingId, onDelete, onSummaryUpdated }: {
  attachment: DgAttachment
  base: string
  deletingId: string | null
  onDelete: (a: DgAttachment) => void
  onSummaryUpdated: (id: string, summary: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(a.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [showText, setShowText] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiFetch(`${base}/${a.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: editValue }),
      })
      if (res.ok) { onSummaryUpdated(a.id, editValue); setEditing(false) }
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  const handleViewText = async () => {
    if (rawText !== null) { setShowText(true); return }
    setLoadingText(true)
    try {
      const res = await apiFetch(`${base}/${a.id}/text`)
      if (res.ok) { const { data } = await res.json(); setRawText(data.text ?? '') }
    } catch { /* ignore */ } finally { setLoadingText(false); setShowText(true) }
  }

  const statusBadge = () => {
    if (a.summaryStatus === 'processing' || a.summaryStatus === 'pending') {
      return <span className="flex items-center gap-1 text-[10px] text-orange-500"><span className="h-2.5 w-2.5 animate-spin rounded-full border border-orange-400 border-t-transparent" />Processing…</span>
    }
    if (a.summaryStatus === 'ready') return <span className="text-[10px] font-medium text-green-600">✓ Interpreted</span>
    if (a.summaryStatus === 'failed') return <span className="text-[10px] text-red-500">Failed</span>
    return null
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Row header */}
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[11px] text-muted-foreground shrink-0 w-3">{expanded ? '▼' : '▶'}</span>
        <span className="text-lg shrink-0">{dgFileIcon(a.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{a.filename}</p>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground">{dgFormatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}</p>
            {statusBadge()}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(a) }}
          disabled={deletingId === a.id}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-500 disabled:opacity-40"
          title="Delete"
        >
          {deletingId === a.id
            ? <span className="h-3.5 w-3.5 block animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Icons.Trash2 className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {(a.summaryStatus === 'pending' || a.summaryStatus === 'processing') && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
              Claude is reading and interpreting this file…
            </div>
          )}
          {a.summaryStatus === 'failed' && (
            <p className="py-2 text-sm text-red-500">Could not extract readable content from this file.</p>
          )}
          {a.summaryStatus === 'ready' && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Demand Gen Interpretation</p>
                {!editing && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleViewText}
                      disabled={loadingText}
                      className="text-[10px] text-muted-foreground underline hover:text-foreground"
                    >
                      {loadingText ? 'Loading…' : 'View original text'}
                    </button>
                    <button
                      onClick={() => { setEditValue(a.summary ?? ''); setEditing(true) }}
                      className="text-[10px] text-orange-500 underline hover:text-orange-700"
                    >Edit</button>
                  </div>
                )}
              </div>
              {editing ? (
                <div>
                  <textarea
                    className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-orange-400"
                    rows={12}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={handleSave} disabled={saving} className="rounded bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => { setEditing(false); setEditValue(a.summary ?? '') }} className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md bg-muted/30 px-3 py-2">
                  {a.summary
                    ? <p className="text-[11px] leading-relaxed text-foreground/80 whitespace-pre-wrap">{a.summary}</p>
                    : <p className="text-[11px] italic text-muted-foreground">No interpretation yet</p>
                  }
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Raw text modal */}
      {showText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }} onClick={() => setShowText(false)}>
          <div className="flex flex-col w-full max-w-2xl max-h-[80vh] rounded-xl shadow-2xl overflow-hidden" style={{ border: '1px solid #e5e7eb' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between rounded-t-xl px-5 py-4" style={{ backgroundColor: '#ea580c' }}>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Original Extracted Text</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-white">{a.filename}</p>
              </div>
              <button onClick={() => setShowText(false)} className="ml-4 shrink-0 rounded p-1 text-white/70 hover:text-white">✕</button>
            </div>
            <div className="overflow-auto p-6" style={{ backgroundColor: '#ffffff' }}>
              {rawText
                ? <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono" style={{ color: '#374151' }}>{rawText}</pre>
                : <p className="text-sm italic" style={{ color: '#6b7280' }}>No extracted text available for this file.</p>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Intake section ────────────────────────────────────────────────────────────

function IntakeSection({ clientId, verticalId }: { clientId: string; verticalId: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const uploading = uploadingCount > 0
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [urlSubmitting, setUrlSubmitting] = useState(false)
  const [attachments, setAttachments] = useState<DgAttachment[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const baseParams = `source=demand_gen${verticalId ? `&verticalId=${verticalId}` : ''}`
  const base = `/api/v1/clients/${clientId}/brain/attachments`

  const fetchAttachments = useCallback(() => {
    return apiFetch(`${base}?${baseParams}`).then((r) => r.json()).then(({ data }) => setAttachments(data ?? [])).catch(() => {})
  }, [base, baseParams])

  useEffect(() => { fetchAttachments() }, [fetchAttachments])

  // Poll while any attachment is still processing
  useEffect(() => {
    const hasInProgress = attachments.some((a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing')
    if (!hasInProgress) return
    const t = setTimeout(() => fetchAttachments(), 4000)
    return () => clearTimeout(t)
  }, [attachments, fetchAttachments])

  const uploadFile = async (file: File) => {
    setUploadingCount((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(`${base}?${baseParams}`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setUploadError((body as { error?: string }).error ?? 'Upload failed')
        setTimeout(() => setUploadError(null), 8000)
        return
      }
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
      setUploadError(null)
    } catch {
      setUploadError('Network error — upload failed')
      setTimeout(() => setUploadError(null), 8000)
    } finally {
      setUploadingCount((n) => n - 1)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(uploadFile)
  }

  const handleUrl = async () => {
    if (!urlValue.trim()) return
    setUrlSubmitting(true)
    setUploadError(null)
    try {
      const res = await apiFetch(`${base}/from-url?${baseParams}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlValue.trim() }),
      })
      if (res.ok) {
        const { data } = await res.json()
        setAttachments((prev) => [data, ...prev])
        setUrlValue('')
        setShowUrlInput(false)
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Failed to add URL' }))
        setUploadError(error ?? 'Failed to add URL')
        setTimeout(() => setUploadError(null), 8000)
      }
    } catch {
      setUploadError('Network error')
    }
    setUrlSubmitting(false)
  }

  const handleDelete = async (a: DgAttachment) => {
    if (!confirm(`Delete "${a.filename}"?`)) return
    setDeletingId(a.id)
    try {
      await apiFetch(`${base}/${a.id}`, { method: 'DELETE' })
      setAttachments((prev) => prev.filter((x) => x.id !== a.id))
    } catch { /* ignore */ } finally { setDeletingId(null) }
  }

  const ready = attachments.filter((a) => a.summaryStatus === 'ready').length

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-orange-500">Intake</div>
          <h2 className="text-xl font-bold text-foreground">Feed the Brain</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">Upload files, add URLs, or paste notes. Claude reads everything and uses it to inform all sections below.</p>
        </div>
        {ready > 0 && (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
            {ready} file{ready !== 1 ? 's' : ''} in brain
          </span>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mb-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors',
          dragging ? 'border-orange-400 bg-orange-50/20' : 'border-border hover:border-orange-300 hover:bg-muted/20',
        )}
      >
        <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.mp4,.mov,.mp3,.m4a,.wav,.webm" onChange={(e) => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icons.Loader2 className="h-4 w-4 animate-spin text-orange-500" />
            Uploading…
          </div>
        ) : (
          <>
            <Icons.Upload className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
            <p className="text-[11px] text-muted-foreground">PDFs, decks, Word docs, audio recordings, sales call recordings</p>
          </>
        )}
      </div>

      {/* URL input */}
      <button
        onClick={() => setShowUrlInput((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icons.Link className="h-3 w-3" />
        Add URL
      </button>
      {showUrlInput && (
        <div className="mt-2 flex gap-2">
          <input
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrl()}
            placeholder="https://clientwebsite.com"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            disabled={!urlValue.trim() || urlSubmitting}
            onClick={handleUrl}
            className="shrink-0 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-40"
          >
            {urlSubmitting ? <Icons.Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
          </button>
        </div>
      )}

      {uploadError && <p className="mt-2 text-[11px] text-red-500">{uploadError}</p>}

      {/* Attachment list */}
      {attachments.length > 0 ? (
        <div className="mt-4 space-y-2">
          {attachments.map((a) => (
            <DgAttachmentRow
              key={a.id}
              attachment={a}
              base={base}
              deletingId={deletingId}
              onDelete={handleDelete}
              onSummaryUpdated={(id, summary) => setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, summary } : x))}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No files yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">Uploaded files will be interpreted by Claude and feed all demand gen sections</p>
        </div>
      )}
    </div>
  )
}

// ── Base layer default data ───────────────────────────────────────────────────

function defaultDemandGenBase() {
  const dg = defaultDemandGen()
  return {
    // S1–S7 — company-level demand gen (also appears per-vertical when a vertical is selected)
    s1: dg.s1,
    s2: dg.s2,
    s3: dg.s3,
    s4: dg.s4,
    s5: dg.s5,
    s6: dg.s6,
    s7: dg.s7,
    // B1 — Revenue & Growth Goals (company-wide)
    b1: {
      fundingStage: '',
      runway: '',
      goals: [{ id: uid(), period: '', revenueTarget: '', newClientsTarget: '', avgDealSize: '', growthInitiative: '', timeline: '' }],
    },
    // B2 — Sales Process & CRM (company-wide)
    b2: {
      salesMethod: '',
      crm: '',
      avgSalesCycle: '',
      leadQualification: '',
      followUpProcess: '',
      stages: [{ id: uid(), stage: '', owner: '', avgTime: '', notes: '' }],
    },
    // B3 — Marketing Budget & Resources (company-wide)
    b3: {
      totalBudget: '',
      budgetFrequency: '',
      internalTeam: '',
      agencies: [{ id: uid(), name: '', role: '', retainer: '' }],
      tools: [{ id: uid(), tool: '', purpose: '' }],
    },
  }
}

type DemandGenBaseData = ReturnType<typeof defaultDemandGenBase>

// ── Base section components ───────────────────────────────────────────────────

function SB1({ base, setBase }: { base: DemandGenBaseData; setBase: (fn: (d: DemandGenBaseData) => void) => void }) {
  const { b1 } = base
  return (
    <div>
      <SectionHeader num="B1" title="Revenue & Growth Goals" subtitle="Company-wide targets that inform every vertical's demand gen strategy." />

      <div className="mb-5 grid grid-cols-2 gap-4">
        <DgField label="Funding Stage">
          <DgInput value={b1.fundingStage} onChange={(v) => setBase((d) => { d.b1.fundingStage = v })} placeholder="e.g. Bootstrapped, Seed, Series A" />
        </DgField>
        <DgField label="Runway / Resources">
          <DgInput value={b1.runway} onChange={(v) => setBase((d) => { d.b1.runway = v })} placeholder="e.g. 18 months, profitable, PE-backed" />
        </DgField>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-foreground">Growth Targets</h3>
      {b1.goals.map((g, i) => (
        <DgCard key={g.id} onRemove={() => setBase((d) => { d.b1.goals = d.b1.goals.filter((_, j) => j !== i) })} canRemove={b1.goals.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Period">
              <DgInput value={g.period} onChange={(v) => setBase((d) => { d.b1.goals[i].period = v })} placeholder="e.g. FY2026, Q1 2026" />
            </DgField>
            <DgField label="Revenue Target">
              <DgInput value={g.revenueTarget} onChange={(v) => setBase((d) => { d.b1.goals[i].revenueTarget = v })} placeholder="e.g. $2M ARR" />
            </DgField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="New Clients Target">
              <DgInput value={g.newClientsTarget} onChange={(v) => setBase((d) => { d.b1.goals[i].newClientsTarget = v })} placeholder="e.g. 40 new clients" />
            </DgField>
            <DgField label="Avg Deal Size">
              <DgInput value={g.avgDealSize} onChange={(v) => setBase((d) => { d.b1.goals[i].avgDealSize = v })} placeholder="e.g. $5,000 / month" />
            </DgField>
          </div>
          <DgField label="Key Growth Initiative">
            <DgInput value={g.growthInitiative} onChange={(v) => setBase((d) => { d.b1.goals[i].growthInitiative = v })} placeholder="e.g. Launch enterprise tier, expand to US market" />
          </DgField>
          <DgField label="Timeline">
            <DgInput value={g.timeline} onChange={(v) => setBase((d) => { d.b1.goals[i].timeline = v })} placeholder="e.g. 12 months, by end of Q2" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add goal period" onClick={() => setBase((d) => { d.b1.goals.push({ id: uid(), period: '', revenueTarget: '', newClientsTarget: '', avgDealSize: '', growthInitiative: '', timeline: '' }) })} />
    </div>
  )
}

function SB2({ base, setBase }: { base: DemandGenBaseData; setBase: (fn: (d: DemandGenBaseData) => void) => void }) {
  const { b2 } = base
  return (
    <div>
      <SectionHeader num="B2" title="Sales Process & CRM" subtitle="How leads become clients — the operational reality that demand gen must feed into." />

      <div className="mb-5 grid grid-cols-2 gap-4">
        <DgField label="Sales Methodology">
          <DgInput value={b2.salesMethod} onChange={(v) => setBase((d) => { d.b2.salesMethod = v })} placeholder="e.g. Consultative, SPIN, Challenger" />
        </DgField>
        <DgField label="CRM">
          <DgInput value={b2.crm} onChange={(v) => setBase((d) => { d.b2.crm = v })} placeholder="e.g. HubSpot, Salesforce, GoHighLevel" />
        </DgField>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4">
        <DgField label="Avg Sales Cycle">
          <DgInput value={b2.avgSalesCycle} onChange={(v) => setBase((d) => { d.b2.avgSalesCycle = v })} placeholder="e.g. 2 weeks, 3 months" />
        </DgField>
        <DgField label="Lead Qualification Criteria">
          <DgInput value={b2.leadQualification} onChange={(v) => setBase((d) => { d.b2.leadQualification = v })} placeholder="e.g. MQL score ≥ 50, budget confirmed" />
        </DgField>
      </div>
      <DgField label="Follow-Up Process">
        <DgTextarea value={b2.followUpProcess} onChange={(v) => setBase((d) => { d.b2.followUpProcess = v })} placeholder="Describe the follow-up sequence after a lead engages…" rows={3} />
      </DgField>

      <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">Sales Stages</h3>
      {b2.stages.map((s, i) => (
        <DgCard key={s.id} onRemove={() => setBase((d) => { d.b2.stages = d.b2.stages.filter((_, j) => j !== i) })} canRemove={b2.stages.length > 1}>
          <div className="grid grid-cols-3 gap-3">
            <DgField label="Stage Name">
              <DgInput value={s.stage} onChange={(v) => setBase((d) => { d.b2.stages[i].stage = v })} placeholder="e.g. Discovery" />
            </DgField>
            <DgField label="Owner">
              <DgInput value={s.owner} onChange={(v) => setBase((d) => { d.b2.stages[i].owner = v })} placeholder="e.g. SDR, AE" />
            </DgField>
            <DgField label="Avg Time">
              <DgInput value={s.avgTime} onChange={(v) => setBase((d) => { d.b2.stages[i].avgTime = v })} placeholder="e.g. 3 days" />
            </DgField>
          </div>
          <DgField label="Notes">
            <DgInput value={s.notes} onChange={(v) => setBase((d) => { d.b2.stages[i].notes = v })} placeholder="What happens in this stage?" />
          </DgField>
        </DgCard>
      ))}
      <AddButton label="Add stage" onClick={() => setBase((d) => { d.b2.stages.push({ id: uid(), stage: '', owner: '', avgTime: '', notes: '' }) })} />
    </div>
  )
}

function SB3({ base, setBase }: { base: DemandGenBaseData; setBase: (fn: (d: DemandGenBaseData) => void) => void }) {
  const { b3 } = base
  return (
    <div>
      <SectionHeader num="B3" title="Marketing Budget & Resources" subtitle="Total capacity available across all verticals and channels." />

      <div className="mb-5 grid grid-cols-2 gap-4">
        <DgField label="Total Marketing Budget">
          <DgInput value={b3.totalBudget} onChange={(v) => setBase((d) => { d.b3.totalBudget = v })} placeholder="e.g. $15,000/month" />
        </DgField>
        <DgField label="Budget Frequency">
          <DgInput value={b3.budgetFrequency} onChange={(v) => setBase((d) => { d.b3.budgetFrequency = v })} placeholder="Monthly / Quarterly / Annual" />
        </DgField>
      </div>
      <DgField label="Internal Marketing Team">
        <DgTextarea value={b3.internalTeam} onChange={(v) => setBase((d) => { d.b3.internalTeam = v })} placeholder="Describe the internal team — headcount, roles, capacity…" rows={2} />
      </DgField>

      <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">Agencies & Partners</h3>
      {b3.agencies.map((a, i) => (
        <DgCard key={a.id} onRemove={() => setBase((d) => { d.b3.agencies = d.b3.agencies.filter((_, j) => j !== i) })} canRemove={b3.agencies.length > 1}>
          <div className="grid grid-cols-3 gap-3">
            <DgField label="Agency / Partner">
              <DgInput value={a.name} onChange={(v) => setBase((d) => { d.b3.agencies[i].name = v })} placeholder="e.g. ContentNode Agency" />
            </DgField>
            <DgField label="Role / Scope">
              <DgInput value={a.role} onChange={(v) => setBase((d) => { d.b3.agencies[i].role = v })} placeholder="e.g. SEO, Paid, Full-service" />
            </DgField>
            <DgField label="Monthly Retainer">
              <DgInput value={a.retainer} onChange={(v) => setBase((d) => { d.b3.agencies[i].retainer = v })} placeholder="e.g. $4,000/mo" />
            </DgField>
          </div>
        </DgCard>
      ))}
      <AddButton label="Add agency / partner" onClick={() => setBase((d) => { d.b3.agencies.push({ id: uid(), name: '', role: '', retainer: '' }) })} />

      <h3 className="mb-3 mt-6 text-sm font-semibold text-foreground">Marketing Tech Stack</h3>
      {b3.tools.map((t, i) => (
        <DgCard key={t.id} onRemove={() => setBase((d) => { d.b3.tools = d.b3.tools.filter((_, j) => j !== i) })} canRemove={b3.tools.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <DgField label="Tool / Platform">
              <DgInput value={t.tool} onChange={(v) => setBase((d) => { d.b3.tools[i].tool = v })} placeholder="e.g. HubSpot, Apollo, Canva" />
            </DgField>
            <DgField label="Purpose">
              <DgInput value={t.purpose} onChange={(v) => setBase((d) => { d.b3.tools[i].purpose = v })} placeholder="e.g. Email automation, Prospecting" />
            </DgField>
          </div>
        </DgCard>
      ))}
      <AddButton label="Add tool" onClick={() => setBase((d) => { d.b3.tools.push({ id: uid(), tool: '', purpose: '' }) })} />
    </div>
  )
}

// ── Nav sidebar ───────────────────────────────────────────────────────────────

const ALL_SECTIONS_NAV = [
  { num: '00', short: 'Feed the Brain' },
  { num: 'B1', short: 'Revenue & Goals' },
  { num: 'B2', short: 'Sales Process' },
  { num: 'B3', short: 'Budget & Resources' },
  { num: '01', short: 'Current Marketing Reality' },
  { num: '02', short: 'Offer Clarity' },
  { num: '03', short: 'ICP + Buying Psychology' },
  { num: '04', short: 'Revenue Goals + Constraints' },
  { num: '05', short: 'Sales Process Alignment' },
  { num: '06', short: 'Hidden Gold' },
  { num: '07', short: 'External Intelligence' },
]

// ── Vertical interface ────────────────────────────────────────────────────────

interface Vertical extends DimensionItem { id: string; name: string; dimensionType: string }

// ── Main export ───────────────────────────────────────────────────────────────

export function ClientDemandGenTab({ clientId }: { clientId: string }) {
  const verticalTerm = useVerticalTerm()
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [verticalsLoading, setVerticalsLoading] = useState(true)
  const [selectedDimensions, setSelectedDimensions] = useState<Record<string, string>>({})
  const selectedVertical = verticals.find((v) => Object.values(selectedDimensions).includes(v.id)) ?? null
  const setSelectedVertical = (v: Vertical | null) => setSelectedDimensions(v ? { [v.dimensionType]: v.id } : {})

  // Unified state — all sections (B1, B2, B3, S1–S7) at the selected level
  const [data, setDataRaw] = useState<DemandGenBaseData | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDataRef = useRef<DemandGenBaseData | null>(null)

  const [activeSection, setActiveSection] = useState('00')

  // Load verticals assigned to this client
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data: d }) => {
        const list: Vertical[] = [...(d ?? [])].sort((a: Vertical, b: Vertical) => a.name.localeCompare(b.name))
        setVerticals(list)
      })
      .catch(() => {})
      .finally(() => setVerticalsLoading(false))
  }, [clientId])

  // Load unified data when level changes (Company or a specific vertical)
  useEffect(() => {
    setDataRaw(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const url = selectedVertical
      ? `/api/v1/clients/${clientId}/demand-gen/${selectedVertical.id}`
      : `/api/v1/clients/${clientId}/demand-gen/base`
    apiFetch(url)
      .then((r) => r.json())
      .then(({ data: d }) => {
        const loaded = d ? { ...defaultDemandGenBase(), ...(d as Partial<DemandGenBaseData>) } : defaultDemandGenBase()
        setDataRaw(loaded)
        latestDataRef.current = loaded
      })
      .catch(() => {
        const def = defaultDemandGenBase()
        setDataRaw(def)
        latestDataRef.current = def
      })
  }, [clientId, selectedVertical])

  // Auto-save (debounced 1.5s) — captures the current level at call time
  const scheduleSave = useCallback((vertId: string | null) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      if (!latestDataRef.current) return
      const url = vertId
        ? `/api/v1/clients/${clientId}/demand-gen/${vertId}`
        : `/api/v1/clients/${clientId}/demand-gen/base`
      try {
        await apiFetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(latestDataRef.current),
        })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('error')
      }
    }, 1500)
  }, [clientId])

  const set = useCallback((fn: (d: DemandGenBaseData) => void) => {
    setDataRaw((prev) => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev)) as DemandGenBaseData
      fn(next)
      latestDataRef.current = next
      scheduleSave(selectedVertical?.id ?? null)
      return next
    })
  }, [scheduleSave, selectedVertical])

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const scrollTo = (num: string) => {
    setActiveSection(num)
    sectionRefs.current[num]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Determine which save status to show — prefer saving/error over idle
  const activeSaveStatus = saveStatus

  // Compute filled / empty section keys for demandPILOT
  const SECTION_KEYS = ['b1', 'b2', 'b3', 's1', 's2', 's3', 's4', 's5', 's6', 's7']
  const filledSections = data
    ? SECTION_KEYS.filter((k) => hasData((data as Record<string, unknown>)[k]))
    : []
  const emptySections = SECTION_KEYS.filter((k) => !filledSections.includes(k))

  // Apply AI-filled section data (called from demandPILOT suggestion cards)
  const handleApplySection = useCallback((sectionKey: string, filled: Record<string, unknown>) => {
    set((d) => {
      (d as Record<string, unknown>)[sectionKey] = applyAiSuggestion(filled)
    })
  }, [set])

  if (verticalsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Dimension selector bar */}
      <DimensionBar
        items={verticals}
        selected={selectedDimensions}
        onChange={(type, id) => { setSelectedDimensions(id ? { [type]: id } : {}); }}
        loading={verticalsLoading}
        verticalTerm={verticalTerm}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left nav */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/20 flex flex-col">
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Icons.TrendingUp className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-semibold text-foreground">Demand Gen</span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {/* All sections — flat list */}
          {ALL_SECTIONS_NAV.map((s) => (
            <button
              key={s.num}
              onClick={() => scrollTo(s.num)}
              className={cn(
                'flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition-colors',
                activeSection === s.num
                  ? 'bg-orange-50 text-orange-700 font-medium'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              <span className={cn('text-[10px] font-bold', activeSection === s.num ? 'text-orange-400' : 'text-muted-foreground/50')}>
                {s.num}
              </span>
              {s.short}
            </button>
          ))}
        </nav>

        {/* Save status */}
        <div className="border-t border-border px-4 py-3">
          {activeSaveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icons.Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
          {activeSaveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-[11px] text-green-600">
              <Icons.Check className="h-3 w-3" /> Saved
            </span>
          )}
          {activeSaveStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-[11px] text-red-500">
              <Icons.AlertCircle className="h-3 w-3" /> Save failed
            </span>
          )}
        </div>
      </div>

      {/* Content + demandPILOT */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-8 py-8 space-y-16">

            {!data ? (
              <div className="flex h-32 items-center justify-center">
                <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Section 00 — Feed the Brain (always first) */}
                <div ref={(el) => { sectionRefs.current['00'] = el }}>
                  <IntakeSection clientId={clientId} verticalId={selectedVertical?.id ?? null} />
                </div>

                {/* B1, B2, B3 */}
                {([
                  ['B1', <SB1 base={data} setBase={set} />],
                  ['B2', <SB2 base={data} setBase={set} />],
                  ['B3', <SB3 base={data} setBase={set} />],
                ] as [string, React.ReactNode][]).map(([num, content]) => (
                  <div key={num} ref={(el) => { sectionRefs.current[num] = el }}>
                    {content}
                  </div>
                ))}

                {/* S1–S7 */}
                {([
                  ['01', <S1 dg={data} set={set} />],
                  ['02', <S2 dg={data} set={set} />],
                  ['03', <S3 dg={data} set={set} />],
                  ['04', <S4 dg={data} set={set} />],
                  ['05', <S5 dg={data} set={set} />],
                  ['06', <S6 dg={data} set={set} />],
                  ['07', <S7 dg={data} set={set} />],
                ] as [string, React.ReactNode][]).map(([num, content]) => (
                  <div key={num} ref={(el) => { sectionRefs.current[num] = el }}>
                    {content}
                  </div>
                ))}
              </>
            )}

          </div>
        </div>

        {/* demandPILOT — anchored to bottom, expands to 40vh */}
        <DemandPilot
          clientId={clientId}
          selectedVertical={selectedVertical}
          data={data as Record<string, unknown> | null}
          filledSections={filledSections}
          emptySections={emptySections}
          onApplySection={handleApplySection}
          onScrollToSection={(num) => scrollTo(num)}
        />
      </div>
      </div>{/* end main content area */}
    </div>
  )
}
