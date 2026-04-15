import { useState, useEffect, useCallback, useRef } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { downloadAssessmentDocx } from '@/lib/downloadDocx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) }

// ── Default data ──────────────────────────────────────────────────────────────

function defaultAssessment() {
  return {
    meta: {
      scrapedAt: '' as string,
      references: [] as Array<{ url: string; label: string }>,
    },
    // Section 1 — Company Profile (mirrors Client > Company tab)
    s1: {
      websiteUrl: '',
      // Identity
      legalName: '',
      doingBusinessAs: '',
      // Facts
      founded: '',
      hq: '',
      employeeCount: '',
      revenueRange: '',
      fundingStage: '',
      investors: '',
      industry: '',
      companyCategory: '',
      businessType: '',
      globalReach: '',
      // About
      about: '',
      whatTheyDo: '',
      productServiceSummary: '',
      visionForFuture: '',
      // Lists (one per line)
      keyOfferings: '',
      industriesServedList: '',
      coreValues: '',
      keyAchievements: '',
      partners: '',
      milestones: '',
      // Leadership
      leadershipMessage: '',
      keyExecutives: [{ id: uid(), name: '', title: '', linkedIn: '' }],
      // Contact
      generalInquiries: '',
      phone: '',
      headquartersAddress: '',
    },
    // Section 2 — Competitive Landscape
    s2: {
      competitors: [{ id: uid(), name: '', website: '', strengths: '', weaknesses: '', howClientDiffers: '' }],
      competitivePosition: '',
      winLossPatterns: '',
      landmines: '',
    },
    // Section 3 — Current GTM Positioning
    s3: {
      messagingStatement: '',
      icp: '',
      valueProp: '',
      keyMessage1: '',
      keyMessage2: '',
      keyMessage3: '',
      toneOfVoice: '',
      currentTagline: '',
      biggestPositioningGap: '',
    },
    // Section 4 — Channel & Partner Strategy
    s4: {
      channels: [{ id: uid(), name: '', type: '', status: '', notes: '' }],
      partnerTypes: '',
      partnerPrograms: '',
      channelGaps: '',
      goToMarketMotion: '',
    },
    // Section 5 — Content & Digital Presence
    s5: {
      websiteUrl: '',
      websiteStrengths: '',
      websiteWeaknesses: '',
      contentTypes: '',
      seoMaturity: '',
      social: [{ id: uid(), platform: '', handle: '', activityLevel: '' }],
      contentGaps: '',
    },
    // Section 6 — Target Segments & Verticals
    s6: {
      primaryVerticals: [{ id: uid(), name: '', whyGoodFit: '', currentPenetration: '', expansionPotential: '' }],
      geographies: '',
      customerSizeRange: '',
      topUseCases: '',
      underservedSegments: '',
    },
    // Section 7 — Brand & Visual Identity
    s7: {
      brandAttributes: '',
      toneAdjectives: '',
      brandPersonality: '',
      existingGuidelines: '',
      primaryColors: '',
      fontNotes: '',
      brandStrengths: '',
      brandWeaknesses: '',
    },
    // Section 8 — Goals & Success Metrics
    s8: {
      goals90Day: '',
      goals12Month: '',
      kpis: [{ id: uid(), metric: '', currentBaseline: '', target: '' }],
      successDefinition: '',
      knownBlockers: '',
      existingWins: '',
      budgetRange: '',
    },
  }
}

type AssessmentData = ReturnType<typeof defaultAssessment>

// ── Section metadata ──────────────────────────────────────────────────────────

const SECTIONS = [
  { num: '01', key: 's1', title: 'Company Profile',      icon: Icons.Building2  },
  { num: '02', key: 's2', title: 'Competitive Landscape',icon: Icons.Swords     },
  { num: '03', key: 's3', title: 'GTM Positioning',      icon: Icons.Target     },
  { num: '04', key: 's4', title: 'Channel & Partners',   icon: Icons.Network    },
  { num: '05', key: 's5', title: 'Content & Digital',    icon: Icons.Globe      },
  { num: '06', key: 's6', title: 'Target Segments',      icon: Icons.Users      },
  { num: '07', key: 's7', title: 'Brand & Visual',       icon: Icons.Palette    },
  { num: '08', key: 's8', title: 'Goals & Metrics',      icon: Icons.TrendingUp },
] as const

// ── Shared UI primitives ──────────────────────────────────────────────────────

function GaLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</label>
}

function GaInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function GaTextarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
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
    <button onClick={onClick} className="mt-3 flex items-center gap-1 text-xs font-medium text-blue-500 hover:text-blue-600 transition-colors">
      <Icons.Plus className="h-3.5 w-3.5" />{label}
    </button>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 transition-colors">
      <Icons.X className="h-3.5 w-3.5" />
    </button>
  )
}

function GaCard({ children, onRemove, canRemove = true }: { children: React.ReactNode; onRemove: () => void; canRemove?: boolean }) {
  return (
    <div className="relative rounded-lg border border-border bg-transparent p-4 mb-3">
      {canRemove && <div className="absolute right-2 top-2"><RemoveButton onClick={onRemove} /></div>}
      <div className="space-y-3 pr-6">{children}</div>
    </div>
  )
}

function GaField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><GaLabel>{label}</GaLabel>{children}</div>
}

function SectionHeader({ num, title, subtitle }: { num: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-6 pb-4 border-b border-border">
      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Section {num}</div>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {subtitle && <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
  )
}

function SubHeader({ title }: { title: string }) {
  return <h3 className="mb-3 mt-6 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">{title}</h3>
}

// ── AI Draft button ───────────────────────────────────────────────────────────

function DraftButton({
  clientId, sectionNum, sectionTitle, fieldLabel, current, onDrafted, formData,
}: {
  clientId: string; sectionNum: string; sectionTitle: string
  fieldLabel: string; current: string; onDrafted: (v: string) => void
  formData?: unknown
}) {
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)

  const requestDraft = async () => {
    setDrafting(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/gtm-assessment/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionNum, sectionTitle, fieldLabel, currentValue: current, formData }),
      })
      if (!res.ok) { console.warn('Draft failed'); return }
      const { data } = await res.json()
      if (data?.draft) setDraft(data.draft)
    } catch { /* silent */ } finally { setDrafting(false) }
  }

  if (draft) {
    return (
      <div className="mt-1.5 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600">AI Draft</p>
        <p className="whitespace-pre-wrap text-foreground">{draft}</p>
        <div className="mt-2 flex gap-2">
          <button className="rounded bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-blue-600" onClick={() => { onDrafted(draft); setDraft(null) }}>Accept</button>
          <button className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setDraft(null)}>Discard</button>
        </div>
      </div>
    )
  }

  return (
    <button title="Draft with AI" disabled={drafting} onClick={requestDraft}
      className={cn('flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
        drafting ? 'cursor-default text-muted-foreground/50' : 'text-blue-500 hover:bg-blue-50 hover:text-blue-700')}>
      {drafting ? <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Icons.Wand2 className="h-2.5 w-2.5" />}
      {drafting ? 'Drafting…' : 'Draft'}
    </button>
  )
}

function DraftField({ label, children, clientId, sectionNum, sectionTitle, fieldLabel, current, onDrafted, formData }:
  { label: string; children: React.ReactNode; clientId: string; sectionNum: string; sectionTitle: string; fieldLabel: string; current: string; onDrafted: (v: string) => void; formData?: unknown }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <GaLabel>{label}</GaLabel>
        <DraftButton clientId={clientId} sectionNum={sectionNum} sectionTitle={sectionTitle} fieldLabel={fieldLabel} current={current} onDrafted={onDrafted} formData={formData} />
      </div>
      {children}
    </div>
  )
}

// ── Section 1 — Company Profile ───────────────────────────────────────────────

function S1({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s1
  const sNum = '01'; const sTitle = 'Company Profile'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )

  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="Full company profile — mirrors the Company tab. Scraped and stored in the client brain." />

      {/* Company Facts */}
      <SubHeader title="Identity & Facts" />
      <div className="grid grid-cols-2 gap-4">
        {df('Legal Name', s.legalName, (v) => set((d) => { d.s1.legalName = v }),
          <GaInput value={s.legalName} onChange={(v) => set((d) => { d.s1.legalName = v })} placeholder="e.g. Dizzion Inc." />)}
        {df('Doing Business As (DBA)', s.doingBusinessAs, (v) => set((d) => { d.s1.doingBusinessAs = v }),
          <GaInput value={s.doingBusinessAs} onChange={(v) => set((d) => { d.s1.doingBusinessAs = v })} placeholder="Brand name if different from legal" />)}
        {df('Founded', s.founded, (v) => set((d) => { d.s1.founded = v }),
          <GaInput value={s.founded} onChange={(v) => set((d) => { d.s1.founded = v })} placeholder="e.g. 2011" />)}
        {df('Headquarters', s.hq, (v) => set((d) => { d.s1.hq = v }),
          <GaInput value={s.hq} onChange={(v) => set((d) => { d.s1.hq = v })} placeholder="City, State" />)}
        {df('Employee Count', s.employeeCount, (v) => set((d) => { d.s1.employeeCount = v }),
          <GaInput value={s.employeeCount} onChange={(v) => set((d) => { d.s1.employeeCount = v })} placeholder="e.g. 200–500" />)}
        {df('Revenue Range', s.revenueRange, (v) => set((d) => { d.s1.revenueRange = v }),
          <GaInput value={s.revenueRange} onChange={(v) => set((d) => { d.s1.revenueRange = v })} placeholder="e.g. $20M–$50M ARR" />)}
        {df('Funding Stage', s.fundingStage, (v) => set((d) => { d.s1.fundingStage = v }),
          <GaInput value={s.fundingStage} onChange={(v) => set((d) => { d.s1.fundingStage = v })} placeholder="Bootstrap / Seed / Series A / PE-backed / Public" />)}
        {df('Investors / Backers', s.investors, (v) => set((d) => { d.s1.investors = v }),
          <GaInput value={s.investors} onChange={(v) => set((d) => { d.s1.investors = v })} placeholder="e.g. Accel, Sequoia, Bootstrapped" />)}
        {df('Industry', s.industry, (v) => set((d) => { d.s1.industry = v }),
          <GaInput value={s.industry} onChange={(v) => set((d) => { d.s1.industry = v })} placeholder="e.g. Cloud Infrastructure, SaaS" />)}
        {df('Company Category', s.companyCategory, (v) => set((d) => { d.s1.companyCategory = v }),
          <GaInput value={s.companyCategory} onChange={(v) => set((d) => { d.s1.companyCategory = v })} placeholder="e.g. Enterprise Software, Professional Services" />)}
        {df('Business Type', s.businessType, (v) => set((d) => { d.s1.businessType = v }),
          <GaInput value={s.businessType} onChange={(v) => set((d) => { d.s1.businessType = v })} placeholder="B2B / B2C / B2G / Mixed" />)}
      </div>

      {/* About */}
      <SubHeader title="About" />
      <div className="space-y-4">
        {df('About', s.about, (v) => set((d) => { d.s1.about = v }),
          <GaTextarea value={s.about} onChange={(v) => set((d) => { d.s1.about = v })} placeholder="2–4 sentence company overview" rows={3} />)}
        {df('What They Do', s.whatTheyDo, (v) => set((d) => { d.s1.whatTheyDo = v }),
          <GaTextarea value={s.whatTheyDo} onChange={(v) => set((d) => { d.s1.whatTheyDo = v })} placeholder="Core business, model, and differentiation" rows={3} />)}
        {df('Global Reach', s.globalReach, (v) => set((d) => { d.s1.globalReach = v }),
          <GaInput value={s.globalReach} onChange={(v) => set((d) => { d.s1.globalReach = v })} placeholder="Geographic presence and market reach" />)}
        {df('Vision for the Future', s.visionForFuture, (v) => set((d) => { d.s1.visionForFuture = v }),
          <GaTextarea value={s.visionForFuture} onChange={(v) => set((d) => { d.s1.visionForFuture = v })} placeholder="Their stated vision, mission, or strategic direction" rows={2} />)}
      </div>

      {/* Products & Services */}
      <SubHeader title="Products & Services" />
      <div className="space-y-4">
        {df('Product / Service Summary', s.productServiceSummary, (v) => set((d) => { d.s1.productServiceSummary = v }),
          <GaTextarea value={s.productServiceSummary} onChange={(v) => set((d) => { d.s1.productServiceSummary = v })} placeholder="Plain English: what do they sell and who buys it?" rows={2} />)}
        {df('Key Offerings', s.keyOfferings, (v) => set((d) => { d.s1.keyOfferings = v }),
          <GaTextarea value={s.keyOfferings} onChange={(v) => set((d) => { d.s1.keyOfferings = v })} placeholder="One offering per line" rows={4} />)}
        {df('Industries Served', s.industriesServedList, (v) => set((d) => { d.s1.industriesServedList = v }),
          <GaTextarea value={s.industriesServedList} onChange={(v) => set((d) => { d.s1.industriesServedList = v })} placeholder="One industry per line" rows={3} />)}
      </div>

      {/* Culture & Achievements */}
      <SubHeader title="Culture & Achievements" />
      <div className="grid grid-cols-2 gap-4">
        {df('Core Values', s.coreValues, (v) => set((d) => { d.s1.coreValues = v }),
          <GaTextarea value={s.coreValues} onChange={(v) => set((d) => { d.s1.coreValues = v })} placeholder="One value per line" rows={3} />)}
        {df('Key Achievements', s.keyAchievements, (v) => set((d) => { d.s1.keyAchievements = v }),
          <GaTextarea value={s.keyAchievements} onChange={(v) => set((d) => { d.s1.keyAchievements = v })} placeholder="One achievement per line" rows={3} />)}
        {df('Partners', s.partners, (v) => set((d) => { d.s1.partners = v }),
          <GaTextarea value={s.partners} onChange={(v) => set((d) => { d.s1.partners = v })} placeholder="One partner per line" rows={3} />)}
        {df('Milestones & Success Stories', s.milestones, (v) => set((d) => { d.s1.milestones = v }),
          <GaTextarea value={s.milestones} onChange={(v) => set((d) => { d.s1.milestones = v })} placeholder="One milestone per line" rows={3} />)}
      </div>

      {/* Leadership */}
      <SubHeader title="Leadership" />
      <div className="space-y-4">
        {df('Leadership Message', s.leadershipMessage, (v) => set((d) => { d.s1.leadershipMessage = v }),
          <GaTextarea value={s.leadershipMessage} onChange={(v) => set((d) => { d.s1.leadershipMessage = v })} placeholder="CEO/founder quote or summary of leadership philosophy" rows={2} />)}
        {s.keyExecutives.map((ex, i) => (
          <GaCard key={ex.id} onRemove={() => set((d) => { d.s1.keyExecutives = d.s1.keyExecutives.filter((_, j) => j !== i) })} canRemove={s.keyExecutives.length > 1}>
            <div className="grid grid-cols-3 gap-3">
              <GaField label="Name"><GaInput value={ex.name} onChange={(v) => set((d) => { d.s1.keyExecutives[i].name = v })} placeholder="Full name" /></GaField>
              <GaField label="Title"><GaInput value={ex.title} onChange={(v) => set((d) => { d.s1.keyExecutives[i].title = v })} placeholder="CEO / CMO / VP Sales…" /></GaField>
              <GaField label="LinkedIn"><GaInput value={ex.linkedIn} onChange={(v) => set((d) => { d.s1.keyExecutives[i].linkedIn = v })} placeholder="linkedin.com/in/…" /></GaField>
            </div>
          </GaCard>
        ))}
        <AddButton label="Add executive" onClick={() => set((d) => { d.s1.keyExecutives.push({ id: uid(), name: '', title: '', linkedIn: '' }) })} />
      </div>

      {/* Contact */}
      <SubHeader title="Contact Information" />
      <div className="grid grid-cols-2 gap-4">
        {df('General Inquiries (email)', s.generalInquiries, (v) => set((d) => { d.s1.generalInquiries = v }),
          <GaInput value={s.generalInquiries} onChange={(v) => set((d) => { d.s1.generalInquiries = v })} placeholder="info@company.com" />)}
        {df('Phone', s.phone, (v) => set((d) => { d.s1.phone = v }),
          <GaInput value={s.phone} onChange={(v) => set((d) => { d.s1.phone = v })} placeholder="+1 (555) 000-0000" />)}
      </div>
      <div className="mt-4">
        {df('Headquarters Address', s.headquartersAddress, (v) => set((d) => { d.s1.headquartersAddress = v }),
          <GaTextarea value={s.headquartersAddress} onChange={(v) => set((d) => { d.s1.headquartersAddress = v })} placeholder="Full street address" rows={2} />)}
      </div>
    </div>
  )
}

// ── Section 2 — Competitive Landscape ────────────────────────────────────────

function S2({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s2; const sNum = '02'; const sTitle = 'Competitive Landscape'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="Who else is in the ring — and how does this client actually win?" />
      <SubHeader title="Competitors" />
      {s.competitors.map((c, i) => (
        <GaCard key={c.id} onRemove={() => set((d) => { d.s2.competitors = d.s2.competitors.filter((_, j) => j !== i) })} canRemove={s.competitors.length > 1}>
          <div className="grid grid-cols-2 gap-3">
            <GaField label="Competitor Name"><GaInput value={c.name} onChange={(v) => set((d) => { d.s2.competitors[i].name = v })} placeholder="Company name" /></GaField>
            <GaField label="Website"><GaInput value={c.website} onChange={(v) => set((d) => { d.s2.competitors[i].website = v })} placeholder="https://…" /></GaField>
          </div>
          <GaField label="Their Strengths"><GaTextarea value={c.strengths} onChange={(v) => set((d) => { d.s2.competitors[i].strengths = v })} placeholder="What do they do well?" rows={2} /></GaField>
          <GaField label="Their Weaknesses"><GaTextarea value={c.weaknesses} onChange={(v) => set((d) => { d.s2.competitors[i].weaknesses = v })} placeholder="Where do they fall short?" rows={2} /></GaField>
          <GaField label="How Client Differentiates"><GaTextarea value={c.howClientDiffers} onChange={(v) => set((d) => { d.s2.competitors[i].howClientDiffers = v })} placeholder="Specific ways the client wins vs this competitor" rows={2} /></GaField>
        </GaCard>
      ))}
      <AddButton label="Add competitor" onClick={() => set((d) => { d.s2.competitors.push({ id: uid(), name: '', website: '', strengths: '', weaknesses: '', howClientDiffers: '' }) })} />
      <div className="mt-6 space-y-4">
        {df('Overall Competitive Position', s.competitivePosition, (v) => set((d) => { d.s2.competitivePosition = v }),
          <GaTextarea value={s.competitivePosition} onChange={(v) => set((d) => { d.s2.competitivePosition = v })} placeholder="How does the client generally position vs the field?" rows={3} />)}
        {df('Win / Loss Patterns', s.winLossPatterns, (v) => set((d) => { d.s2.winLossPatterns = v }),
          <GaTextarea value={s.winLossPatterns} onChange={(v) => set((d) => { d.s2.winLossPatterns = v })} placeholder="When do they typically win? When do they lose?" rows={2} />)}
        {df('Landmines (Traps to Avoid)', s.landmines, (v) => set((d) => { d.s2.landmines = v }),
          <GaTextarea value={s.landmines} onChange={(v) => set((d) => { d.s2.landmines = v })} placeholder="Claims or comparisons to avoid — legal, reputation, or factual risks" rows={2} />)}
      </div>
    </div>
  )
}

// ── Section 3 — GTM Positioning ───────────────────────────────────────────────

function S3({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s3; const sNum = '03'; const sTitle = 'GTM Positioning'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="How the client currently shows up to prospects — messaging, ICP, and gaps." />
      <div className="space-y-4">
        {df('Messaging / Positioning Statement', s.messagingStatement, (v) => set((d) => { d.s3.messagingStatement = v }),
          <GaTextarea value={s.messagingStatement} onChange={(v) => set((d) => { d.s3.messagingStatement = v })} placeholder="Current one-sentence summary of who they help and how" rows={2} />)}
        {df('Ideal Customer Profile (ICP)', s.icp, (v) => set((d) => { d.s3.icp = v }),
          <GaTextarea value={s.icp} onChange={(v) => set((d) => { d.s3.icp = v })} placeholder="Company size, industry, pain trigger, buying signal…" rows={3} />)}
        {df('Core Value Proposition', s.valueProp, (v) => set((d) => { d.s3.valueProp = v }),
          <GaTextarea value={s.valueProp} onChange={(v) => set((d) => { d.s3.valueProp = v })} placeholder="Primary reason buyers choose them" rows={2} />)}
        <SubHeader title="Key Messages" />
        {df('Key Message 1', s.keyMessage1, (v) => set((d) => { d.s3.keyMessage1 = v }),
          <GaInput value={s.keyMessage1} onChange={(v) => set((d) => { d.s3.keyMessage1 = v })} placeholder="First core talking point" />)}
        {df('Key Message 2', s.keyMessage2, (v) => set((d) => { d.s3.keyMessage2 = v }),
          <GaInput value={s.keyMessage2} onChange={(v) => set((d) => { d.s3.keyMessage2 = v })} placeholder="Second core talking point" />)}
        {df('Key Message 3', s.keyMessage3, (v) => set((d) => { d.s3.keyMessage3 = v }),
          <GaInput value={s.keyMessage3} onChange={(v) => set((d) => { d.s3.keyMessage3 = v })} placeholder="Third core talking point" />)}
        <div className="grid grid-cols-2 gap-4">
          {df('Tone of Voice', s.toneOfVoice, (v) => set((d) => { d.s3.toneOfVoice = v }),
            <GaInput value={s.toneOfVoice} onChange={(v) => set((d) => { d.s3.toneOfVoice = v })} placeholder="e.g. Confident, technical, empathetic" />)}
          {df('Current Tagline', s.currentTagline, (v) => set((d) => { d.s3.currentTagline = v }),
            <GaInput value={s.currentTagline} onChange={(v) => set((d) => { d.s3.currentTagline = v })} placeholder="If they have one" />)}
        </div>
        {df('Biggest Positioning Gap', s.biggestPositioningGap, (v) => set((d) => { d.s3.biggestPositioningGap = v }),
          <GaTextarea value={s.biggestPositioningGap} onChange={(v) => set((d) => { d.s3.biggestPositioningGap = v })} placeholder="Where does current messaging fall short or confuse buyers?" rows={2} />)}
      </div>
    </div>
  )
}

// ── Section 4 — Channel & Partner Strategy ───────────────────────────────────

function S4({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s4; const sNum = '04'; const sTitle = 'Channel & Partner Strategy'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="Where they sell and who they sell through." />
      <SubHeader title="Channels" />
      {s.channels.map((c, i) => (
        <GaCard key={c.id} onRemove={() => set((d) => { d.s4.channels = d.s4.channels.filter((_, j) => j !== i) })} canRemove={s.channels.length > 1}>
          <div className="grid grid-cols-3 gap-3">
            <GaField label="Channel"><GaInput value={c.name} onChange={(v) => set((d) => { d.s4.channels[i].name = v })} placeholder="e.g. Direct, VAR, Marketplace" /></GaField>
            <GaField label="Type"><GaInput value={c.type} onChange={(v) => set((d) => { d.s4.channels[i].type = v })} placeholder="e.g. Inbound, Outbound, PLG" /></GaField>
            <GaField label="Status"><GaInput value={c.status} onChange={(v) => set((d) => { d.s4.channels[i].status = v })} placeholder="Active / Testing / Planned" /></GaField>
          </div>
          <GaField label="Notes"><GaTextarea value={c.notes} onChange={(v) => set((d) => { d.s4.channels[i].notes = v })} placeholder="Performance, maturity, or gaps in this channel" rows={2} /></GaField>
        </GaCard>
      ))}
      <AddButton label="Add channel" onClick={() => set((d) => { d.s4.channels.push({ id: uid(), name: '', type: '', status: '', notes: '' }) })} />
      <div className="mt-6 space-y-4">
        {df('GTM Motion', s.goToMarketMotion, (v) => set((d) => { d.s4.goToMarketMotion = v }),
          <GaInput value={s.goToMarketMotion} onChange={(v) => set((d) => { d.s4.goToMarketMotion = v })} placeholder="Product-led / Sales-led / Partner-led / Community-led" />)}
        {df('Partner Types', s.partnerTypes, (v) => set((d) => { d.s4.partnerTypes = v }),
          <GaTextarea value={s.partnerTypes} onChange={(v) => set((d) => { d.s4.partnerTypes = v })} placeholder="Resellers, referral partners, tech integrations, OEM…" rows={2} />)}
        {df('Partner Programs', s.partnerPrograms, (v) => set((d) => { d.s4.partnerPrograms = v }),
          <GaTextarea value={s.partnerPrograms} onChange={(v) => set((d) => { d.s4.partnerPrograms = v })} placeholder="Existing partner program structure or gaps" rows={2} />)}
        {df('Channel Gaps', s.channelGaps, (v) => set((d) => { d.s4.channelGaps = v }),
          <GaTextarea value={s.channelGaps} onChange={(v) => set((d) => { d.s4.channelGaps = v })} placeholder="Channels they should be in but aren't" rows={2} />)}
      </div>
    </div>
  )
}

// ── Section 5 — Content & Digital Presence ───────────────────────────────────

function S5({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s5; const sNum = '05'; const sTitle = 'Content & Digital Presence'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="Website, SEO, content strategy, and social footprint." />
      <div className="space-y-4">
        {df('Website URL', s.websiteUrl, (v) => set((d) => { d.s5.websiteUrl = v }),
          <GaInput value={s.websiteUrl} onChange={(v) => set((d) => { d.s5.websiteUrl = v })} placeholder="https://…" />)}
        {df('Website Strengths', s.websiteStrengths, (v) => set((d) => { d.s5.websiteStrengths = v }),
          <GaTextarea value={s.websiteStrengths} onChange={(v) => set((d) => { d.s5.websiteStrengths = v })} placeholder="What the site does well" rows={2} />)}
        {df('Website Weaknesses', s.websiteWeaknesses, (v) => set((d) => { d.s5.websiteWeaknesses = v }),
          <GaTextarea value={s.websiteWeaknesses} onChange={(v) => set((d) => { d.s5.websiteWeaknesses = v })} placeholder="What's missing or confusing" rows={2} />)}
        {df('Content Types Published', s.contentTypes, (v) => set((d) => { d.s5.contentTypes = v }),
          <GaInput value={s.contentTypes} onChange={(v) => set((d) => { d.s5.contentTypes = v })} placeholder="Blog, case studies, webinars, whitepapers…" />)}
        {df('SEO Maturity', s.seoMaturity, (v) => set((d) => { d.s5.seoMaturity = v }),
          <GaInput value={s.seoMaturity} onChange={(v) => set((d) => { d.s5.seoMaturity = v })} placeholder="e.g. Low — no keyword strategy" />)}
        {df('Content Gaps', s.contentGaps, (v) => set((d) => { d.s5.contentGaps = v }),
          <GaTextarea value={s.contentGaps} onChange={(v) => set((d) => { d.s5.contentGaps = v })} placeholder="What content is missing that buyers need?" rows={2} />)}
      </div>
      <SubHeader title="Social Presence" />
      {s.social.map((p, i) => (
        <GaCard key={p.id} onRemove={() => set((d) => { d.s5.social = d.s5.social.filter((_, j) => j !== i) })} canRemove={s.social.length > 1}>
          <div className="grid grid-cols-3 gap-3">
            <GaField label="Platform"><GaInput value={p.platform} onChange={(v) => set((d) => { d.s5.social[i].platform = v })} placeholder="LinkedIn / X / YouTube" /></GaField>
            <GaField label="Handle"><GaInput value={p.handle} onChange={(v) => set((d) => { d.s5.social[i].handle = v })} placeholder="@handle" /></GaField>
            <GaField label="Activity Level"><GaInput value={p.activityLevel} onChange={(v) => set((d) => { d.s5.social[i].activityLevel = v })} placeholder="Active / Low / Inactive" /></GaField>
          </div>
        </GaCard>
      ))}
      <AddButton label="Add platform" onClick={() => set((d) => { d.s5.social.push({ id: uid(), platform: '', handle: '', activityLevel: '' }) })} />
    </div>
  )
}

// ── Section 6 — Target Segments & Verticals ───────────────────────────────────

function S6({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s6; const sNum = '06'; const sTitle = 'Target Segments & Verticals'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="Who they're best suited to serve and where the growth is." />
      <SubHeader title="Primary Verticals" />
      {s.primaryVerticals.map((v, i) => (
        <GaCard key={v.id} onRemove={() => set((d) => { d.s6.primaryVerticals = d.s6.primaryVerticals.filter((_, j) => j !== i) })} canRemove={s.primaryVerticals.length > 1}>
          <GaField label="Vertical / Industry"><GaInput value={v.name} onChange={(val) => set((d) => { d.s6.primaryVerticals[i].name = val })} placeholder="e.g. Healthcare, Financial Services" /></GaField>
          <div className="grid grid-cols-3 gap-3">
            <GaField label="Why a Good Fit"><GaTextarea value={v.whyGoodFit} onChange={(val) => set((d) => { d.s6.primaryVerticals[i].whyGoodFit = val })} rows={2} /></GaField>
            <GaField label="Current Penetration"><GaTextarea value={v.currentPenetration} onChange={(val) => set((d) => { d.s6.primaryVerticals[i].currentPenetration = val })} rows={2} /></GaField>
            <GaField label="Expansion Potential"><GaTextarea value={v.expansionPotential} onChange={(val) => set((d) => { d.s6.primaryVerticals[i].expansionPotential = val })} rows={2} /></GaField>
          </div>
        </GaCard>
      ))}
      <AddButton label="Add vertical" onClick={() => set((d) => { d.s6.primaryVerticals.push({ id: uid(), name: '', whyGoodFit: '', currentPenetration: '', expansionPotential: '' }) })} />
      <div className="mt-6 space-y-4">
        {df('Geographies', s.geographies, (v) => set((d) => { d.s6.geographies = v }),
          <GaInput value={s.geographies} onChange={(v) => set((d) => { d.s6.geographies = v })} placeholder="e.g. North America, EU, APAC" />)}
        {df('Target Customer Size Range', s.customerSizeRange, (v) => set((d) => { d.s6.customerSizeRange = v }),
          <GaInput value={s.customerSizeRange} onChange={(v) => set((d) => { d.s6.customerSizeRange = v })} placeholder="e.g. Mid-market 500–5,000 employees" />)}
        {df('Top Use Cases', s.topUseCases, (v) => set((d) => { d.s6.topUseCases = v }),
          <GaTextarea value={s.topUseCases} onChange={(v) => set((d) => { d.s6.topUseCases = v })} placeholder="Primary problems customers are solving with this product" rows={3} />)}
        {df('Underserved Segments (Growth Opportunities)', s.underservedSegments, (v) => set((d) => { d.s6.underservedSegments = v }),
          <GaTextarea value={s.underservedSegments} onChange={(v) => set((d) => { d.s6.underservedSegments = v })} placeholder="Markets they could win but haven't fully pursued" rows={2} />)}
      </div>
    </div>
  )
}

// ── Section 7 — Brand & Visual Identity ──────────────────────────────────────

function S7({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s7; const sNum = '07'; const sTitle = 'Brand & Visual Identity'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="The look, feel, and voice — what to carry forward and what to evolve." />
      <div className="space-y-4">
        {df('Core Brand Attributes (3–5 adjectives)', s.brandAttributes, (v) => set((d) => { d.s7.brandAttributes = v }),
          <GaInput value={s.brandAttributes} onChange={(v) => set((d) => { d.s7.brandAttributes = v })} placeholder="e.g. Secure, Simple, Scalable, Human" />)}
        {df('Tone Adjectives', s.toneAdjectives, (v) => set((d) => { d.s7.toneAdjectives = v }),
          <GaInput value={s.toneAdjectives} onChange={(v) => set((d) => { d.s7.toneAdjectives = v })} placeholder="e.g. Direct, Warm, Expert but not jargon-heavy" />)}
        {df('Brand Personality', s.brandPersonality, (v) => set((d) => { d.s7.brandPersonality = v }),
          <GaTextarea value={s.brandPersonality} onChange={(v) => set((d) => { d.s7.brandPersonality = v })} placeholder="If this brand were a person, how would they speak and act?" rows={2} />)}
        {df('Existing Brand Guidelines', s.existingGuidelines, (v) => set((d) => { d.s7.existingGuidelines = v }),
          <GaInput value={s.existingGuidelines} onChange={(v) => set((d) => { d.s7.existingGuidelines = v })} placeholder="URL to brand guide or 'None yet'" />)}
        <div className="grid grid-cols-2 gap-4">
          {df('Primary Colors', s.primaryColors, (v) => set((d) => { d.s7.primaryColors = v }),
            <GaInput value={s.primaryColors} onChange={(v) => set((d) => { d.s7.primaryColors = v })} placeholder="e.g. Navy #1A2E5E, Orange #F47B20" />)}
          {df('Font Notes', s.fontNotes, (v) => set((d) => { d.s7.fontNotes = v }),
            <GaInput value={s.fontNotes} onChange={(v) => set((d) => { d.s7.fontNotes = v })} placeholder="e.g. Montserrat headers, Open Sans body" />)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {df('Brand Strengths', s.brandStrengths, (v) => set((d) => { d.s7.brandStrengths = v }),
            <GaTextarea value={s.brandStrengths} onChange={(v) => set((d) => { d.s7.brandStrengths = v })} placeholder="What does the brand convey well?" rows={2} />)}
          {df('Brand Weaknesses', s.brandWeaknesses, (v) => set((d) => { d.s7.brandWeaknesses = v }),
            <GaTextarea value={s.brandWeaknesses} onChange={(v) => set((d) => { d.s7.brandWeaknesses = v })} placeholder="Where does the brand fall flat or confuse?" rows={2} />)}
        </div>
      </div>
    </div>
  )
}

// ── Section 8 — Goals & Success Metrics ──────────────────────────────────────

function S8({ data, set, clientId }: { data: AssessmentData; set: (fn: (d: AssessmentData) => void) => void; clientId: string }) {
  const s = data.s8; const sNum = '08'; const sTitle = 'Goals & Success Metrics'
  const df = (label: string, current: string, onDrafted: (v: string) => void, children: React.ReactNode) => (
    <DraftField label={label} clientId={clientId} sectionNum={sNum} sectionTitle={sTitle} fieldLabel={label} current={current} onDrafted={onDrafted} formData={data}>{children}</DraftField>
  )
  return (
    <div>
      <SectionHeader num={sNum} title={sTitle} subtitle="What winning looks like — timelines, numbers, and definitions of done." />
      <div className="space-y-4">
        {df('90-Day Goals', s.goals90Day, (v) => set((d) => { d.s8.goals90Day = v }),
          <GaTextarea value={s.goals90Day} onChange={(v) => set((d) => { d.s8.goals90Day = v })} placeholder="Specific outcomes they expect in the first 90 days" rows={3} />)}
        {df('12-Month Goals', s.goals12Month, (v) => set((d) => { d.s8.goals12Month = v }),
          <GaTextarea value={s.goals12Month} onChange={(v) => set((d) => { d.s8.goals12Month = v })} placeholder="Larger strategic outcomes for the year" rows={3} />)}
        <SubHeader title="Key Performance Indicators" />
        {s.kpis.map((kpi, i) => (
          <GaCard key={kpi.id} onRemove={() => set((d) => { d.s8.kpis = d.s8.kpis.filter((_, j) => j !== i) })} canRemove={s.kpis.length > 1}>
            <div className="grid grid-cols-3 gap-3">
              <GaField label="Metric"><GaInput value={kpi.metric} onChange={(v) => set((d) => { d.s8.kpis[i].metric = v })} placeholder="e.g. Qualified pipeline" /></GaField>
              <GaField label="Current Baseline"><GaInput value={kpi.currentBaseline} onChange={(v) => set((d) => { d.s8.kpis[i].currentBaseline = v })} placeholder="Where are they today?" /></GaField>
              <GaField label="Target"><GaInput value={kpi.target} onChange={(v) => set((d) => { d.s8.kpis[i].target = v })} placeholder="Where do they want to be?" /></GaField>
            </div>
          </GaCard>
        ))}
        <AddButton label="Add KPI" onClick={() => set((d) => { d.s8.kpis.push({ id: uid(), metric: '', currentBaseline: '', target: '' }) })} />
        {df('How They Define Success', s.successDefinition, (v) => set((d) => { d.s8.successDefinition = v }),
          <GaTextarea value={s.successDefinition} onChange={(v) => set((d) => { d.s8.successDefinition = v })} placeholder="In their words, what does winning look like in 12 months?" rows={2} />)}
        {df('Known Blockers', s.knownBlockers, (v) => set((d) => { d.s8.knownBlockers = v }),
          <GaTextarea value={s.knownBlockers} onChange={(v) => set((d) => { d.s8.knownBlockers = v })} placeholder="Internal constraints, budget, team gaps, approval chains" rows={2} />)}
        {df('Existing Wins to Build On', s.existingWins, (v) => set((d) => { d.s8.existingWins = v }),
          <GaTextarea value={s.existingWins} onChange={(v) => set((d) => { d.s8.existingWins = v })} placeholder="Recent successes — what's working and should be amplified?" rows={2} />)}
        {df('Budget Range', s.budgetRange, (v) => set((d) => { d.s8.budgetRange = v }),
          <GaInput value={s.budgetRange} onChange={(v) => set((d) => { d.s8.budgetRange = v })} placeholder="e.g. $5K–$10K/mo, TBD" />)}
      </div>
    </div>
  )
}

// ── References section ────────────────────────────────────────────────────────

function RefsSection({ data }: { data: AssessmentData }) {
  const refs = data.meta.references
  const scrapedAt = data.meta.scrapedAt

  return (
    <div>
      <SectionHeader num="09" title="References" subtitle="Sources crawled and enriched during the last Scrape & Fill run." />
      {refs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scrape has been run yet. Enter the website URL and click <strong>Scrape & Fill</strong> to populate references.</p>
      ) : (
        <>
          {scrapedAt && (
            <p className="mb-4 text-xs text-muted-foreground">Last scraped: {new Date(scrapedAt).toLocaleString()}</p>
          )}
          <ol className="space-y-2">
            {refs.map((ref, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
                <div>
                  <p className="font-medium text-foreground">{ref.label}</p>
                  <a href={ref.url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:underline break-all">{ref.url}</a>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

// ── Completeness score ────────────────────────────────────────────────────────

function scoreSection(obj: Record<string, unknown>): number {
  let total = 0; let filled = 0
  const scan = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(scan); return }
    if (v && typeof v === 'object') { Object.values(v as Record<string, unknown>).forEach(scan); return }
    if (typeof v === 'string') { total++; if (v.trim()) filled++ }
  }
  scan(obj)
  return total === 0 ? 0 : Math.round((filled / total) * 100)
}

// ── Main component ────────────────────────────────────────────────────────────

export function ClientGTMAssessmentTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [data, setData] = useState<AssessmentData>(defaultAssessment())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [savingToBrain, setSavingToBrain] = useState(false)
  const [brainMsg, setBrainMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [generatingDocx, setGeneratingDocx] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [scrapeMsg, setScrapeMsg] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const [activeSection, setActiveSection] = useState<string>('s1')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  // Load on mount
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/gtm-assessment`)
      .then((r) => r.json())
      .then(({ data: saved }) => {
        if (saved && typeof saved === 'object') {
          setData((prev) => deepMerge(prev, saved as Partial<AssessmentData>))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [clientId])

  // IntersectionObserver — highlights active nav item as user scrolls
  useEffect(() => {
    if (loading) return
    const allKeys = [...SECTIONS.map((s) => s.key), 'refs']
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        // pick the one with the smallest top offset (closest to top of viewport)
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
        )
        setActiveSection(topmost.target.id.replace('section-', ''))
      },
      { root: mainRef.current, rootMargin: '-5% 0px -75% 0px', threshold: 0 },
    )
    allKeys.forEach((key) => {
      const el = document.getElementById(`section-${key}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [loading])

  const scrollToSection = (key: string) => {
    document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSection(key)
  }

  // Auto-save with debounce
  const persistData = useCallback((d: AssessmentData) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        await apiFetch(`/api/v1/clients/${clientId}/gtm-assessment`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(d),
        })
        setLastSaved(new Date())
      } catch (err) {
        console.error('GTM Assessment save failed', err)
      } finally {
        setSaving(false)
      }
    }, 800)
  }, [clientId])

  const set = useCallback((fn: (d: AssessmentData) => void) => {
    setData((prev) => {
      const next = deepClone(prev)
      fn(next)
      persistData(next)
      return next
    })
  }, [persistData])

  // Scrape & Fill All
  const handleScrape = async () => {
    const url = data.s1.websiteUrl.trim()
    if (!url) return
    setScraping(true)
    setScrapeMsg(null)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/gtm-assessment/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const json = await res.json()
      if (!res.ok) {
        setScrapeMsg({ type: 'err', text: (json as { error?: string }).error ?? 'Scrape failed' })
        return
      }
      const parsed = json as {
        data?: Partial<AssessmentData> & { meta?: { scrapedAt?: string; references?: Array<{ url: string; label: string }> } }
        meta?: { braveEnabled?: boolean; socialProfilesFound?: number }
      }
      const partial = parsed.data
      if (partial) {
        set((d) => {
          // Apply string fields — only overwrite empty values
          const applyStrings = (src: Record<string, unknown>, target: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(src)) {
              if (k === 'id') continue
              if (typeof v === 'string' && v.trim() && typeof target[k] === 'string' && !(target[k] as string).trim())
                target[k] = v
            }
          }
          if (partial.s1) {
            applyStrings(partial.s1 as Record<string, unknown>, d.s1 as unknown as Record<string, unknown>)
            // Replace keyExecutives if current list is blank and scrape has results
            const scrapedExecs = (partial.s1 as { keyExecutives?: typeof d.s1.keyExecutives }).keyExecutives
            if (scrapedExecs && scrapedExecs.length > 0 && d.s1.keyExecutives.every((e) => !e.name.trim()))
              d.s1.keyExecutives = scrapedExecs
          }
          if (partial.s2) {
            // Replace competitors list if current list is blank and scrape found names
            const scrapedComps = (partial.s2 as { competitors?: typeof d.s2.competitors }).competitors
            if (scrapedComps && scrapedComps.length > 0 && d.s2.competitors.every((c) => !c.name.trim()))
              d.s2.competitors = scrapedComps
          }
          if (partial.s3) applyStrings(partial.s3 as Record<string, unknown>, d.s3 as unknown as Record<string, unknown>)
          if (partial.s4) applyStrings(partial.s4 as Record<string, unknown>, d.s4 as unknown as Record<string, unknown>)
          if (partial.s5) {
            applyStrings(partial.s5 as Record<string, unknown>, d.s5 as unknown as Record<string, unknown>)
            // Replace social list if current list is blank and scrape found profiles
            const scrapedSocial = (partial.s5 as { social?: typeof d.s5.social }).social
            if (scrapedSocial && scrapedSocial.length > 0 && d.s5.social.every((s) => !s.platform.trim()))
              d.s5.social = scrapedSocial
          }
          if (partial.s6) applyStrings(partial.s6 as Record<string, unknown>, d.s6 as unknown as Record<string, unknown>)
          if (partial.s7) applyStrings(partial.s7 as Record<string, unknown>, d.s7 as unknown as Record<string, unknown>)
          // Store references
          if (partial.meta?.scrapedAt) d.meta.scrapedAt = partial.meta.scrapedAt
          if (partial.meta?.references) d.meta.references = partial.meta.references
        })
        const count = Object.values(partial.s1 ?? {}).filter((v) => typeof v === 'string' && (v as string).trim()).length
        const socialCount = parsed.meta?.socialProfilesFound ?? 0
        const braveEnabled = parsed.meta?.braveEnabled ?? false
        if (braveEnabled) {
          setScrapeMsg({
            type: 'ok',
            text: `Filled ${count} fields${socialCount > 0 ? `, ${socialCount} social profiles` : ''} — website + Pitchbook, LinkedIn, Crunchbase`,
          })
        } else {
          setScrapeMsg({
            type: 'warn',
            text: `Filled ${count} fields${socialCount > 0 ? `, ${socialCount} social profiles` : ''} from website only. Add BRAVE_SEARCH_API_KEY to .env for Pitchbook / LinkedIn / Crunchbase data.`,
          })
        }
      }
    } catch {
      setScrapeMsg({ type: 'err', text: 'Network error — could not scrape website' })
    } finally {
      setScraping(false)
    }
  }

  const handleSaveToBrain = async () => {
    setSavingToBrain(true)
    setBrainMsg(null)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/gtm-assessment/save-to-brain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) {
        setBrainMsg({ type: 'err', text: (json as { error?: string }).error ?? 'Failed to save to brain' })
      } else {
        setBrainMsg({ type: 'ok', text: 'Saved to Client Brain.' })
        setTimeout(() => setBrainMsg(null), 5000)
      }
    } catch {
      setBrainMsg({ type: 'err', text: 'Network error' })
    } finally {
      setSavingToBrain(false)
    }
  }

  const handleDownloadReport = async () => {
    setGeneratingReport(true)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/gtm-assessment/report`)
      if (!res.ok) { alert('Failed to generate report'); return }
      const html = await res.text()
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
      alert('Network error generating report')
    } finally {
      setGeneratingReport(false)
    }
  }

  const handleDownloadDocx = async () => {
    setGeneratingDocx(true)
    try {
      await downloadAssessmentDocx(data, clientName)
    } catch {
      alert('Failed to generate .docx')
    } finally {
      setGeneratingDocx(false)
    }
  }

  const scores = SECTIONS.map((s) => ({
    key: s.key,
    score: scoreSection(data[s.key as keyof AssessmentData] as Record<string, unknown>),
  }))
  const totalScore = Math.round(scores.reduce((acc, s) => acc + s.score, 0) / scores.length)

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Icons.Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left nav */}
      <aside className="w-56 shrink-0 border-r border-border bg-muted/20 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Company Assessment</p>
          <p className="text-xs text-muted-foreground truncate">{clientName}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${totalScore}%` }} />
            </div>
            <span className="text-[10px] font-semibold text-muted-foreground">{totalScore}%</span>
          </div>
        </div>

        {/* Scrape box */}
        <div className="px-3 py-3 border-b border-border shrink-0 space-y-2">
          <input
            value={data.s1.websiteUrl}
            onChange={(e) => set((d) => { d.s1.websiteUrl = e.target.value })}
            placeholder="https://company.com"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleScrape}
            disabled={scraping || !data.s1.websiteUrl.trim()}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-blue-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
          >
            {scraping
              ? <><Icons.Loader2 className="h-3 w-3 animate-spin" />Scraping…</>
              : <><Icons.Wand2 className="h-3 w-3" />Scrape & Fill All</>
            }
          </button>
          {scrapeMsg && (
            <p className={cn('text-[10px] leading-tight', scrapeMsg.type === 'ok' ? 'text-green-600' : scrapeMsg.type === 'warn' ? 'text-amber-600' : 'text-red-500')}>
              {scrapeMsg.text}
            </p>
          )}
        </div>

        {/* Section nav */}
        <nav className="flex-1 overflow-y-auto py-1">
          {SECTIONS.map((section) => {
            const sScore = scores.find((s) => s.key === section.key)?.score ?? 0
            const Icon = section.icon
            const isActive = activeSection === section.key
            return (
              <button key={section.key} onClick={() => scrollToSection(section.key)}
                className={cn('flex w-full items-center gap-2 px-4 py-2 text-left transition-colors text-[11px]',
                  isActive ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-500 font-semibold' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground')}>
                <Icon className="h-3 w-3 shrink-0" />
                <span className="flex-1 truncate">{section.num}. {section.title}</span>
                {sScore >= 80
                  ? <Icons.CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-green-500" />
                  : sScore >= 40
                    ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                    : null
                }
              </button>
            )
          })}
          {/* References nav item */}
          <button onClick={() => scrollToSection('refs')}
            className={cn('flex w-full items-center gap-2 px-4 py-2 text-left transition-colors text-[11px]',
              activeSection === 'refs' ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-500 font-semibold' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground')}>
            <Icons.Link className="h-3 w-3 shrink-0" />
            <span className="flex-1">09. References</span>
            {data.meta.references.length > 0 && (
              <span className="text-[9px] font-semibold text-muted-foreground">{data.meta.references.length}</span>
            )}
          </button>
        </nav>
      </aside>

      {/* Single scrollable content column */}
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        {/* Sticky action bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-8 py-2.5">
          <div className="flex items-center gap-2">
            {brainMsg && (
              <span className={cn('flex items-center gap-1 text-[10px]', brainMsg.type === 'ok' ? 'text-green-600' : 'text-red-500')}>
                {brainMsg.type === 'ok' ? <Icons.CheckCircle2 className="h-3 w-3" /> : <Icons.AlertCircle className="h-3 w-3" />}
                {brainMsg.text}
              </span>
            )}
            {saving && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Icons.Loader2 className="h-2.5 w-2.5 animate-spin" />Saving…
              </span>
            )}
            {!saving && lastSaved && (
              <span className="text-[10px] text-muted-foreground">
                Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadReport} disabled={generatingReport}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:opacity-40 transition-colors">
              {generatingReport ? <><Icons.Loader2 className="h-3 w-3 animate-spin" />Building…</> : <><Icons.FileDown className="h-3 w-3" />Download Report</>}
            </button>
            <button onClick={handleDownloadDocx} disabled={generatingDocx}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:opacity-40 transition-colors">
              {generatingDocx ? <><Icons.Loader2 className="h-3 w-3 animate-spin" />Building…</> : <><Icons.FileText className="h-3 w-3" />Download Report .docx</>}
            </button>
            <button onClick={handleSaveToBrain} disabled={savingToBrain}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/50 disabled:opacity-40 transition-colors">
              {savingToBrain ? <><Icons.Loader2 className="h-3 w-3 animate-spin" />Saving…</> : <><Icons.Brain className="h-3 w-3" />Save to Brain</>}
            </button>
          </div>
        </div>

        {/* All sections — single scrollable page */}
        <div className="px-8 py-8 max-w-3xl space-y-16">
          <section id="section-s1"><S1 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s2"><S2 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s3"><S3 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s4"><S4 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s5"><S5 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s6"><S6 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s7"><S7 data={data} set={set} clientId={clientId} /></section>
          <section id="section-s8"><S8 data={data} set={set} clientId={clientId} /></section>
          <section id="section-refs"><RefsSection data={data} /></section>
        </div>
      </main>
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = deepClone(target)
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key]
    const tv = target[key]
    if (sv !== undefined && sv !== null) {
      if (Array.isArray(sv)) {
        (result[key] as unknown) = sv
      } else if (typeof sv === 'object' && typeof tv === 'object' && !Array.isArray(tv)) {
        (result[key] as unknown) = deepMerge(tv as object, sv as object)
      } else {
        (result[key] as unknown) = sv
      }
    }
  }
  return result
}
