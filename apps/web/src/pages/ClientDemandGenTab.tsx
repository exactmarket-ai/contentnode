import { useState, useEffect, useRef, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

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

function S1({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

function S2({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

function S3({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

function S4({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

function S5({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

function S6({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

function S7({ dg, set }: { dg: DemandGenData; set: (fn: (d: DemandGenData) => void) => void }) {
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

// ── Intake section (files + URL) ──────────────────────────────────────────────

function IntakeSection({ clientId }: { clientId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [urlSubmitting, setUrlSubmitting] = useState(false)
  const [attachments, setAttachments] = useState<{ id: string; filename: string; extractionStatus: string }[]>([])

  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/brand-profile/attachments`)
      .then((r) => r.json())
      .then(({ data }) => setAttachments(data ?? []))
      .catch(() => {})
  }, [clientId])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError(null)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const res = await apiFetch(`/api/v1/clients/${clientId}/brand-profile/attachments`, { method: 'POST', body: fd })
        if (res.ok) {
          const { data } = await res.json()
          setAttachments((prev) => [data, ...prev])
        } else {
          const { error } = await res.json().catch(() => ({ error: 'Upload failed' }))
          setUploadError(error ?? 'Upload failed')
        }
      } catch {
        setUploadError('Upload failed')
      }
    }
    setUploading(false)
  }

  const handleUrl = async () => {
    if (!urlValue.trim()) return
    setUrlSubmitting(true)
    setUploadError(null)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/brand-profile/attachments`, {
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
      }
    } catch {
      setUploadError('Failed to add URL')
    }
    setUrlSubmitting(false)
  }

  const processing = attachments.filter((a) => a.extractionStatus === 'pending' || a.extractionStatus === 'processing').length
  const ready = attachments.filter((a) => a.extractionStatus === 'ready').length

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-orange-500">Intake</div>
          <h2 className="text-xl font-bold text-foreground">Feed the Brain</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">Upload files, paste notes, or add URLs. Claude reads everything and populates the sections below.</p>
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
            <Icons.Loader2 className="h-4 w-4 animate-spin" />
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

      {/* URL input toggle */}
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

      {uploadError && (
        <p className="mt-2 text-[11px] text-red-500">{uploadError}</p>
      )}

      {/* File list */}
      {attachments.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
              <Icons.FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <span className="flex-1 truncate text-xs text-foreground">{a.filename}</span>
              {(a.extractionStatus === 'pending' || a.extractionStatus === 'processing') && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" /> Reading…
                </span>
              )}
              {a.extractionStatus === 'ready' && (
                <span className="text-[10px] text-green-600">✓ Ready</span>
              )}
            </div>
          ))}
          {processing > 0 && (
            <p className="text-[10px] text-muted-foreground">{processing} file{processing !== 1 ? 's' : ''} being processed — sections will update when complete</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Nav sidebar ───────────────────────────────────────────────────────────────

const SECTIONS_NAV = [
  { num: '00', short: 'Feed the Brain' },
  { num: '01', short: 'Current Marketing Reality' },
  { num: '02', short: 'Offer Clarity' },
  { num: '03', short: 'ICP + Buying Psychology' },
  { num: '04', short: 'Revenue Goals + Constraints' },
  { num: '05', short: 'Sales Process Alignment' },
  { num: '06', short: 'Hidden Gold' },
  { num: '07', short: 'External Intelligence' },
]

// ── Vertical selector (same pattern as GTM Framework) ────────────────────────

interface Vertical { id: string; name: string }

function VerticalSelector({ verticals, selected, onSelect }: {
  verticals: Vertical[]
  selected: Vertical | null
  onSelect: (v: Vertical) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted/40 transition-colors min-w-[140px]"
      >
        {selected
          ? <span className="font-medium truncate">{selected.name}</span>
          : <span className="text-muted-foreground">Select vertical…</span>
        }
        <svg className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover shadow-xl" style={{ backgroundColor: 'hsl(var(--popover))' }}>
          <div className="max-h-48 overflow-y-auto p-1">
            {verticals.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px] text-muted-foreground">
                No verticals assigned — go to Structure tab to add
              </p>
            ) : (
              verticals.map((v) => (
                <button
                  key={v.id}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
                  onClick={() => { onSelect(v); setOpen(false) }}
                >
                  {selected?.id === v.id && <span className="text-orange-500">✓</span>}
                  <span className="truncate">{v.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ClientDemandGenTab({ clientId }: { clientId: string }) {
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [selectedVertical, setSelectedVertical] = useState<Vertical | null>(null)
  const [verticalsLoading, setVerticalsLoading] = useState(true)
  const [dg, setDgRaw] = useState<DemandGenData | null>(null)
  const [activeSection, setActiveSection] = useState('01')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDgRef = useRef<DemandGenData | null>(null)

  // Load verticals assigned to this client
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data }) => {
        const list: Vertical[] = data ?? []
        setVerticals(list)
        if (list.length === 1) setSelectedVertical(list[0])
      })
      .catch(() => {})
      .finally(() => setVerticalsLoading(false))
  }, [clientId])

  // Load demand gen data when vertical selected
  useEffect(() => {
    if (!selectedVertical) { setDgRaw(null); return }
    setDgRaw(null)
    apiFetch(`/api/v1/clients/${clientId}/demand-gen/${selectedVertical.id}`)
      .then((r) => r.json())
      .then(({ data }) => {
        const loaded = data ? { ...defaultDemandGen(), ...(data as Partial<DemandGenData>) } : defaultDemandGen()
        setDgRaw(loaded)
        latestDgRef.current = loaded
      })
      .catch(() => {
        const def = defaultDemandGen()
        setDgRaw(def)
        latestDgRef.current = def
      })
  }, [clientId, selectedVertical])

  // Auto-save (debounced 1.5s)
  const scheduleSave = useCallback(() => {
    if (!selectedVertical) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      if (!latestDgRef.current || !selectedVertical) return
      try {
        await apiFetch(`/api/v1/clients/${clientId}/demand-gen/${selectedVertical.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(latestDgRef.current),
        })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('error')
      }
    }, 1500)
  }, [clientId, selectedVertical])

  const set = useCallback((fn: (d: DemandGenData) => void) => {
    setDgRaw((prev) => {
      if (!prev) return prev
      // Deep clone via JSON for simplicity — demand gen data is small
      const next = JSON.parse(JSON.stringify(prev)) as DemandGenData
      fn(next)
      latestDgRef.current = next
      scheduleSave()
      return next
    })
  }, [scheduleSave])

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const scrollTo = (num: string) => {
    setActiveSection(num)
    sectionRefs.current[num]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (verticalsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left nav */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/20 flex flex-col">
        <div className="px-4 py-4 border-b border-border space-y-3">
          <div className="flex items-center gap-2">
            <Icons.TrendingUp className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-semibold text-foreground">Demand Gen</span>
          </div>
          <VerticalSelector verticals={verticals} selected={selectedVertical} onSelect={setSelectedVertical} />
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {SECTIONS_NAV.map((s) => (
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
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icons.Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-[11px] text-green-600">
              <Icons.Check className="h-3 w-3" /> Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1.5 text-[11px] text-red-500">
              <Icons.AlertCircle className="h-3 w-3" /> Save failed
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!selectedVertical ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <Icons.TrendingUp className="h-8 w-8 mx-auto text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Select a vertical to view or edit Demand Gen data</p>
              {verticals.length === 0 && (
                <p className="text-xs text-muted-foreground/60">No verticals assigned — go to Structure tab to add one</p>
              )}
            </div>
          </div>
        ) : !dg ? (
          <div className="flex h-64 items-center justify-center">
            <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
        <div className="mx-auto max-w-3xl px-8 py-8 space-y-16">
          {([
            ['00', <IntakeSection clientId={clientId} />],
            ['01', <S1 dg={dg} set={set} />],
            ['02', <S2 dg={dg} set={set} />],
            ['03', <S3 dg={dg} set={set} />],
            ['04', <S4 dg={dg} set={set} />],
            ['05', <S5 dg={dg} set={set} />],
            ['06', <S6 dg={dg} set={set} />],
            ['07', <S7 dg={dg} set={set} />],
          ] as [string, React.ReactNode][]).map(([num, content]) => (
            <div key={num} ref={(el) => { sectionRefs.current[num] = el }}>
              {content}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  )
}
