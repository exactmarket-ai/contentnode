import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { DimensionBar, type DimensionItem } from '@/components/layout/DimensionBar'
import { checkFilenames, type FilenameIssue } from '@/lib/filename'
import { FilenameWarning } from '@/components/ui/FilenameWarning'
import { GTMPilot } from '@/components/pilot/GTMPilot'
import { downloadGTMFrameworkDocx, DEFAULT_DOC_STYLE, type DocStyleConfig } from '@/lib/downloadDocx'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useVerticalTerm } from '@/hooks/useVerticalTerm'

// ── Reimport types ────────────────────────────────────────────────────────────
interface ReimportField { id: string; label: string; oldValue: string; newValue: string }
interface ReimportStyleSignal { type: string; rule: string; example: string; confidence: string }
interface ReimportResult { updatedFields: ReimportField[]; styleSignals: ReimportStyleSignal[]; totalUpdated: number }

// ── Draft context — provides per-field AI drafting to all section components ──

interface DraftContextValue {
  researchReady: boolean
  requestDraft: (fieldId: string, sectionNum: string, sectionTitle: string, fieldLabel: string, current: string) => Promise<void>
  draftingField: string | null
  acceptDraft: (fieldId: string, setValue: (v: string) => void) => void
  discardDraft: (fieldId: string) => void
  getDraft: (fieldId: string) => string | null
}
const DraftContext = createContext<DraftContextValue>({
  researchReady: false,
  requestDraft: async () => {},
  draftingField: null,
  acceptDraft: () => {},
  discardDraft: () => {},
  getDraft: () => null,
})

// ── Section definitions ──────────────────────────────────────────────────────

export const SECTIONS = [
  { num: '01', short: 'Vertical Overview',              usedIn: '' },
  { num: '02', short: 'Customer Definition + Profile',  usedIn: '' },
  { num: '03', short: 'Market Pressures + Stats',       usedIn: 'Brochure · eBook · Deck · Web Page · BDR Email 1' },
  { num: '04', short: 'Core Challenges',                usedIn: 'Brochure · eBook · Deck · Web Page · BDR Emails' },
  { num: '05', short: 'Solutions + Service Stack',      usedIn: 'Brochure · eBook · Cheat Sheet · Deck · Web Page · Video Script' },
  { num: '06', short: 'Why [Client]',                   usedIn: 'Brochure · Cheat Sheet · Deck · Web Page · BDR Emails' },
  { num: '07', short: 'Segments + Buyer Profiles',      usedIn: 'Cheat Sheet · BDR Emails · Deck speaker notes' },
  { num: '08', short: 'Messaging Framework',            usedIn: 'All 8 assets' },
  { num: '09', short: 'Proof Points + Case Studies',    usedIn: 'Brochure · BDR Emails · Web Page · Video Script · eBook' },
  { num: '10', short: 'Objection Handling',             usedIn: 'Cheat Sheet · BDR Emails · Deck speaker notes' },
  { num: '11', short: 'Brand Voice Examples',           usedIn: 'All 8 assets — tonal guardrail' },
  { num: '12', short: 'Competitive Differentiation',    usedIn: 'Cheat Sheet · BDR Emails · Deck' },
  { num: '13', short: 'Customer Quotes + Testimonials', usedIn: 'eBook · Brochure · Deck · Web Page' },
  { num: '14', short: 'Campaign Themes + Asset Mapping', usedIn: 'Campaign planning' },
  { num: '15', short: 'Frequently Asked Questions',     usedIn: 'eBook · BDR Email sequence · Cheat Sheet' },
  { num: '16', short: 'Content Funnel Mapping',         usedIn: 'All 8 assets — sequencing and CTA alignment' },
  { num: '17', short: 'Regulatory + Compliance',        usedIn: 'Brochure · eBook · Deck · Cheat Sheet · BDR Email 3' },
  { num: '18', short: 'CTAs + Next Steps',              usedIn: 'All 8 assets' },
]

// ── GTM variable mapper — produces {varId: value} for docxtemplater fill ─────

function buildGtmVariableValues(
  fw: ReturnType<typeof defaultFramework>,
  clientName: string,
  verticalName: string,
): Record<string, string> {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const list = (arr: unknown[] | undefined, fn: (item: any) => string): string =>
    Array.isArray(arr) ? arr.map(fn).filter(Boolean).join('\n\n') : ''

  return {
    // Meta
    client_name:   clientName,
    vertical_name: verticalName,
    agency_name:   '',
    document_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),

    // §01 Vertical Overview
    s01_positioning_statement: str(fw.s01?.positioningStatement),
    s01_tagline_options:       str(fw.s01?.taglineOptions),
    s01_how_to_use:            str(fw.s01?.howToUse),
    s01_what_is_not:           str(fw.s01?.whatIsNot),

    // §02 Customer Definition + Profile
    s02_industry:            str(fw.s02?.industry),
    s02_company_size:        str(fw.s02?.companySize),
    s02_geography:           str(fw.s02?.geography),
    s02_it_posture:          str(fw.s02?.itPosture),
    s02_compliance_status:   str(fw.s02?.complianceStatus),
    s02_contract_profile:    str(fw.s02?.contractProfile),
    s02_primary_buyer_table: list(fw.s02?.buyerTable, (r) => r.segment ? `${r.segment} | ${r.primaryBuyer} | ${r.corePain} | ${r.entryPoint}` : ''),

    // §03 Market Pressures + Statistics
    s03_market_pressure_narrative: str(fw.s03?.marketPressureNarrative),
    s03_key_statistics: list(fw.s03?.statsTable, (s) => s.stat ? `${s.stat} — ${s.context} (${s.source}, ${s.year})` : ''),

    // §04 Core Challenges
    s04_challenges: list(fw.s04?.challenges, (c) => c.name ? [
      `Challenge: ${c.name}`,
      c.whyExists    ? `Why It Exists: ${c.whyExists}`           : '',
      c.consequence  ? `Business Consequence: ${c.consequence}`  : '',
      c.solution     ? `Solution: ${c.solution}`                 : '',
      c.pillarsText  ? `Relevant Pillars: ${c.pillarsText}`      : '',
    ].filter(Boolean).join('\n') : ''),

    // §05 Solutions + Service Stack — pillars by position (Cloud, Data+AI, IT Ops, Cybersecurity)
    s05_pillar_cloud:         fw.s05?.pillars?.[0] ? [fw.s05.pillars[0].valueProp, fw.s05.pillars[0].keyServices ? `Key Services: ${fw.s05.pillars[0].keyServices}` : '', fw.s05.pillars[0].relevantTo ? `Relevant To: ${fw.s05.pillars[0].relevantTo}` : ''].filter(Boolean).join('\n\n') : '',
    s05_pillar_data_ai:       fw.s05?.pillars?.[1] ? [fw.s05.pillars[1].valueProp, fw.s05.pillars[1].keyServices ? `Key Services: ${fw.s05.pillars[1].keyServices}` : '', fw.s05.pillars[1].relevantTo ? `Relevant To: ${fw.s05.pillars[1].relevantTo}` : ''].filter(Boolean).join('\n\n') : '',
    s05_pillar_it_operations: fw.s05?.pillars?.[2] ? [fw.s05.pillars[2].valueProp, fw.s05.pillars[2].keyServices ? `Key Services: ${fw.s05.pillars[2].keyServices}` : '', fw.s05.pillars[2].relevantTo ? `Relevant To: ${fw.s05.pillars[2].relevantTo}` : ''].filter(Boolean).join('\n\n') : '',
    s05_pillar_cybersecurity: fw.s05?.pillars?.[3] ? [fw.s05.pillars[3].valueProp, fw.s05.pillars[3].keyServices ? `Key Services: ${fw.s05.pillars[3].keyServices}` : '', fw.s05.pillars[3].relevantTo ? `Relevant To: ${fw.s05.pillars[3].relevantTo}` : ''].filter(Boolean).join('\n\n') : '',
    s05_full_service_stack:   list(fw.s05?.serviceStack, (s) => s.service ? `${s.service} | ${s.regulatoryDomain ?? ''} | ${s.whatItDelivers} | ${s.priority}` : ''),

    // §06 Why [Client]
    s06_differentiators: list(fw.s06?.differentiators, (d) => d.label ? `${d.label}:\n${d.position}` : ''),

    // §07 Segments + Buyer Profiles
    s07_segments: list(fw.s07?.segments, (s) => s.name ? [
      `Segment: ${s.name}`,
      s.primaryBuyerTitles ? `Primary Buyer: ${s.primaryBuyerTitles}` : '',
      s.whatIsDifferent    ? `What Is Different: ${s.whatIsDifferent}` : '',
      s.keyPressures       ? `Key Pressures: ${s.keyPressures}`        : '',
      s.leadHook           ? `Lead Hook: ${s.leadHook}`                : '',
      s.complianceNotes    ? `Compliance Notes: ${s.complianceNotes}`  : '',
    ].filter(Boolean).join('\n') : ''),

    // §08 Messaging Framework
    s08_problems:        str(fw.s08?.problems),
    s08_solution:        str(fw.s08?.solution),
    s08_outcomes:        str(fw.s08?.outcomes),
    s08_value_by_pillar: list(fw.s08?.valuePropTable, (r) => r.pillar ? `${r.pillar} | ${r.meaning} | ${r.proofPoint} | ${r.citation}` : ''),

    // §09 Proof Points + Case Studies
    s09_proof_points: list(fw.s09?.proofPoints, (p) => p.text ? `${p.text} (${p.source})` : ''),
    s09_case_studies:  list(fw.s09?.caseStudies, (c) => c.clientProfile ? [
      `Client: ${c.clientProfile}`,
      c.url         ? `URL: ${c.url}`                 : '',
      c.situation   ? `Situation: ${c.situation}`     : '',
      c.engagement  ? `Engagement: ${c.engagement}`   : '',
      c.outcomes    ? `Outcomes: ${c.outcomes}`        : '',
      c.thirtySecond ? `30-Second: ${c.thirtySecond}` : '',
      c.headlineStat ? `Headline: ${c.headlineStat}`  : '',
    ].filter(Boolean).join('\n') : ''),

    // §10 Objection Handling
    s10_objections: list(fw.s10?.objections, (o) => o.objection ? [
      `Objection: ${o.objection}`,
      o.response ? `Response: ${o.response}` : '',
      o.followUp ? `Follow-Up: ${o.followUp}` : '',
    ].filter(Boolean).join('\n') : ''),

    // §11 Brand Voice Examples
    s11_tone_target:         str(fw.s11?.toneTarget),
    s11_vocabulary_level:    str(fw.s11?.vocabularyLevel),
    s11_sentence_style:      str(fw.s11?.sentenceStyle),
    s11_what_to_avoid:       str(fw.s11?.whatToAvoid),
    s11_sounds_like:         list(fw.s11?.goodExamples, (e) => str(e.text)),
    s11_does_not_sound_like: list(fw.s11?.badExamples, (e) => e.bad ? `BAD: ${e.bad}\nBETTER: ${e.whyWrong}` : ''),

    // §12 Competitive Differentiation
    s12_competitive_differentiation: list(fw.s12?.competitors, (c) => c.type ? `${c.type}: ${c.positioning} → Counter: ${c.counter} (${c.whenComesUp})` : ''),

    // §13 Customer Quotes + Testimonials
    s13_customer_quotes: list(fw.s13?.quotes, (q) => q.quoteText ? [
      `"${q.quoteText}" — ${q.attribution}`,
      q.context    ? `Context: ${q.context}`          : '',
      q.bestUsedIn ? `Best Used In: ${q.bestUsedIn}`  : '',
      q.approved   ? `Approved: ${q.approved}`        : '',
    ].filter(Boolean).join('\n') : ''),

    // §14 Campaign Themes + Asset Mapping
    s14_campaign_themes: list(fw.s14?.campaigns, (c) => c.theme ? [
      `Theme: ${c.theme}`,
      c.targetAudience ? `Audience: ${c.targetAudience}` : '',
      c.primaryAssets  ? `Assets: ${c.primaryAssets}`    : '',
      c.keyMessage     ? `Message: ${c.keyMessage}`      : '',
    ].filter(Boolean).join('\n') : ''),

    // §15 Frequently Asked Questions
    s15_faqs: list(fw.s15?.faqs, (f) => f.question ? [
      `Q: ${f.question}`,
      f.answer           ? `A: ${f.answer}`                       : '',
      f.bestAddressedIn  ? `Best addressed in: ${f.bestAddressedIn}` : '',
    ].filter(Boolean).join('\n') : ''),

    // §16 Content Funnel Mapping
    s16_funnel_mapping: list(fw.s16?.funnelStages, (f) => f.assets ? `${f.stage}: ${f.assets} → CTA: ${f.primaryCTA} (${f.buyerState})` : ''),
    s16_cta_sequencing: str(fw.s16?.ctaSequencing),

    // §17 Regulatory + Compliance Context
    s17_regulatory_context:    list(fw.s17?.regulations, (r) => r.requirement ? `${r.requirement}: ${r.capability} (${r.servicePillar}) — ${r.salesNote}` : ''),
    s17_regulatory_sales_note: str(fw.s17?.regulatorySalesNote),

    // §18 CTAs + Next Steps
    s18_ctas: list(fw.s18?.ctas, (c) => c.ctaName ? `${c.ctaName}: ${c.description} | Audience: ${c.targetAudienceTrigger} | Assets: ${c.assets}` : ''),
  }
}

// ── Default framework data ───────────────────────────────────────────────────

function defaultFramework() {
  return {
    sectionOwners: {} as Record<string, string>,
    sectionNotes: {} as Record<string, string>,
    s01: { positioningStatement: '', taglineOptions: '', howToUse: '', whatIsNot: '', platformName: '', platformBenefit: '' },
    s02: {
      industry: '', companySize: '', geography: '', itPosture: '',
      complianceStatus: '', contractProfile: '',
      buyerTable: [{ segment: '', primaryBuyer: '', corePain: '', entryPoint: '' }],
      secondaryTargets: '',
    },
    s03: {
      marketPressureNarrative: '',
      statsTable: [{ stat: '', context: '', source: '', year: '' }],
      additionalContext: '',
    },
    s04: {
      challenges: [{ name: '', whyExists: '', consequence: '', solution: '', pillarsText: '', _open: true }],
    },
    s05: {
      pillars: [
        { pillar: '', valueProp: '', keyServices: '', relevantTo: '', _open: true },
        { pillar: '', valueProp: '', keyServices: '', relevantTo: '', _open: false },
        { pillar: '', valueProp: '', keyServices: '', relevantTo: '', _open: false },
        { pillar: '', valueProp: '', keyServices: '', relevantTo: '', _open: false },
      ],
      serviceStack: [{ service: '', regulatoryDomain: '', whatItDelivers: '', priority: '', _open: true }],
    },
    s06: {
      differentiators: [{ label: '', position: '', _open: true }],
    },
    s07: {
      segments: [{ name: '', primaryBuyerTitles: '', whatIsDifferent: '', keyPressures: '', leadHook: '', complianceNotes: '', _open: true }],
    },
    s08: {
      problems: '', solution: '', outcomes: '',
      valuePropTable: [
        { pillar: '', meaning: '', proofPoint: '', citation: '' },
        { pillar: '', meaning: '', proofPoint: '', citation: '' },
        { pillar: '', meaning: '', proofPoint: '', citation: '' },
        { pillar: '', meaning: '', proofPoint: '', citation: '' },
      ],
    },
    s09: {
      proofPoints: [
        { text: '', source: '' }, { text: '', source: '' }, { text: '', source: '' },
      ],
      caseStudies: [{ clientProfile: '', url: '', situation: '', engagement: '', outcomes: '', thirtySecond: '', headlineStat: '', _open: true }],
    },
    s10: {
      objections: [{ objection: '', response: '', followUp: '' }],
    },
    s11: {
      toneTarget: '', vocabularyLevel: '', sentenceStyle: '', whatToAvoid: '',
      goodExamples: [{ text: '' }, { text: '' }, { text: '' }],
      badExamples: [{ bad: '', whyWrong: '' }],
    },
    s12: {
      competitors: [{ type: '', positioning: '', counter: '', whenComesUp: '' }],
    },
    s13: {
      quotes: [{ quoteText: '', attribution: '', context: '', bestUsedIn: '', approved: '', _open: true }],
    },
    s14: {
      campaigns: [{ theme: '', targetAudience: '', primaryAssets: '', keyMessage: '' }],
    },
    s15: {
      faqs: [{ question: '', answer: '', bestAddressedIn: '' }],
    },
    s16: {
      funnelStages: [
        { stage: 'Top of Funnel', assets: '', primaryCTA: '', buyerState: '' },
        { stage: 'Mid Funnel',    assets: '', primaryCTA: '', buyerState: '' },
        { stage: 'Bottom Funnel', assets: '', primaryCTA: '', buyerState: '' },
      ], // stage labels are display-only and excluded from completion status
      ctaSequencing: '',
    },
    s17: {
      regulations: [{ requirement: '', capability: '', servicePillar: '', salesNote: '' }],
      regulatorySalesNote: '',
    },
    s18: {
      ctas: [{ ctaName: '', description: '', targetAudienceTrigger: '', assets: '' }],
      campaignThemes: [{ campaignName: '', description: '' }],
      contact: { verticalOwner: '', marketingContact: '', salesLead: '', documentVersion: '', lastUpdated: '', nextReviewDate: '' },
    },
  }
}

export type FrameworkData = ReturnType<typeof defaultFramework>

// ── Helper: section completion status ────────────────────────────────────────

function getSectionStatus(fw: FrameworkData, num: string): 'complete' | 'in-progress' | 'not-started' {
  const sKey = `s${num}` as keyof FrameworkData
  const sec = fw[sKey] as Record<string, unknown> | undefined
  if (!sec) return 'not-started'

  // Keys that are structural display labels, not user-entered content
  const SKIP_KEYS = new Set(['_open', 'stage'])

  // Count filled fields recursively
  let filled = 0
  let total = 0
  function count(val: unknown, key?: string) {
    if (key && SKIP_KEYS.has(key)) return
    if (typeof val === 'string') { total++; if (val.trim()) filled++ }
    else if (Array.isArray(val)) val.forEach((item) => count(item))
    else if (val && typeof val === 'object') Object.entries(val as Record<string, unknown>).forEach(([k, v]) => count(v, k))
  }
  Object.entries(sec).forEach(([k, v]) => {
    if (SKIP_KEYS.has(k)) return
    count(v, k)
  })
  if (total === 0) return 'not-started'
  if (filled === 0) return 'not-started'
  if (filled < total) return 'in-progress'
  return 'complete'
}

// ── Overflow tooltip ─────────────────────────────────────────────────────────

function OverflowTooltip({ value, threshold = 40, children }: { value: string; threshold?: number; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const show = (value?.length ?? 0) > threshold
  return (
    <div
      className="relative"
      onMouseEnter={() => show && setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: 0,
          minWidth: '100%',
          maxWidth: 460,
          zIndex: 9999,
          backgroundColor: '#1c1c1c',
          color: '#f0f0f0',
          border: '1px solid #444',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 11,
          lineHeight: 1.6,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.7)',
        }}>
          {value}
        </div>
      )}
    </div>
  )
}

// ── Shared small components ───────────────────────────────────────────────────

function FwLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-semibold text-foreground">{children}</div>
}

function FwHelp({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[11px] text-muted-foreground">{children}</p>
}

function FwField({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>
}

function DraftButton({ fieldId, sectionNum, sectionTitle, fieldLabel, current, onDrafted }: {
  fieldId: string; sectionNum: string; sectionTitle: string; fieldLabel: string
  current: string; onDrafted: (v: string) => void
}) {
  const { researchReady, requestDraft, draftingField, getDraft, acceptDraft, discardDraft } = useContext(DraftContext)
  const draft = getDraft(fieldId)
  const isMe = draftingField === fieldId

  if (!researchReady && !draft) return null

  if (draft) {
    return (
      <div className="mt-1 rounded-md border border-amber-300 bg-amber-50/60 px-2 py-1.5 text-xs">
        <p className="mb-1 text-[10px] font-semibold text-amber-700 uppercase tracking-wide">AI Draft</p>
        <p className="text-foreground whitespace-pre-wrap">{draft}</p>
        <div className="mt-1.5 flex gap-2">
          <button
            className="rounded bg-amber-500 px-2 py-0.5 text-[10px] text-white hover:bg-amber-600 font-medium"
            onClick={() => { acceptDraft(fieldId, onDrafted) }}
          >Accept</button>
          <button
            className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => discardDraft(fieldId)}
          >Discard</button>
        </div>
      </div>
    )
  }

  return (
    <button
      title={researchReady ? 'Draft with AI' : 'Run research first in Attachments tab'}
      disabled={!researchReady || !!draftingField}
      onClick={() => requestDraft(fieldId, sectionNum, sectionTitle, fieldLabel, current)}
      className={cn(
        'absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
        researchReady && !draftingField
          ? 'text-blue-500 hover:bg-blue-50 hover:text-blue-700 opacity-0 group-hover:opacity-100'
          : 'cursor-not-allowed text-muted-foreground/40',
        isMe && 'opacity-100',
      )}
    >
      {isMe
        ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-blue-400 border-t-transparent" />
        : <span>✦</span>
      }
      {isMe ? 'Drafting…' : 'Draft'}
    </button>
  )
}

function FwTextarea({ value, onChange, rows = 3, placeholder, fieldId, sectionNum = '', sectionTitle = '', fieldLabel = '' }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string
  fieldId?: string; sectionNum?: string; sectionTitle?: string; fieldLabel?: string
}) {
  return (
    <div className="group relative">
      <OverflowTooltip value={value} threshold={120}>
        <textarea
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </OverflowTooltip>
      {fieldId && <DraftButton fieldId={fieldId} sectionNum={sectionNum} sectionTitle={sectionTitle} fieldLabel={fieldLabel} current={value} onDrafted={onChange} />}
    </div>
  )
}

function FwInput({ value, onChange, placeholder, type = 'text', fieldId, sectionNum = '', sectionTitle = '', fieldLabel = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
  fieldId?: string; sectionNum?: string; sectionTitle?: string; fieldLabel?: string
}) {
  return (
    <div className="group relative">
      <OverflowTooltip value={value} threshold={40}>
        <input
          type={type}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </OverflowTooltip>
      {fieldId && <DraftButton fieldId={fieldId} sectionNum={sectionNum} sectionTitle={sectionTitle} fieldLabel={fieldLabel} current={value} onDrafted={onChange} />}
    </div>
  )
}

function FwSectionHeader({ num, title, usedIn }: { num: string; title: string; usedIn?: string }) {
  return (
    <div className="mb-6">
      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Section {num}</div>
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      {usedIn && <p className="mt-1 text-[11px] text-muted-foreground">USED IN: {usedIn}</p>}
    </div>
  )
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function FwTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function FwTableCell({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-border p-1 align-top">{children}</td>
}

function FwTableTextarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number
}) {
  return (
    <OverflowTooltip value={value} threshold={120}>
      <textarea
        className="w-full resize-none rounded border border-transparent bg-transparent px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-blue-400 focus:outline-none focus:bg-background"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </OverflowTooltip>
  )
}

function FwTableInput({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <OverflowTooltip value={value} threshold={40}>
      <input
        className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-blue-400 focus:outline-none focus:bg-background"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </OverflowTooltip>
  )
}

// ── Collapsible card ──────────────────────────────────────────────────────────

function FwCard({ title, subtitle, onDelete, canDelete = true, children }: {
  title: string; subtitle?: string; onDelete: () => void; canDelete?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-3 rounded-lg border border-border">
      <div
        className="flex cursor-pointer items-center justify-between px-4 py-3 hover:bg-muted/30"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-foreground">{title || <span className="italic text-muted-foreground">Untitled</span>}</span>
          {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted-foreground">{open ? '▲' : '▼'}</span>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="rounded px-1 py-0.5 text-[11px] text-red-400 hover:bg-red-50 hover:text-red-600"
            >✕</button>
          )}
        </div>
      </div>
      {open && <div className="border-t border-border px-4 py-4">{children}</div>}
    </div>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-2 text-xs text-blue-500 hover:text-blue-700 font-medium"
    >
      + {label}
    </button>
  )
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'complete' | 'in-progress' | 'not-started' }) {
  return (
    <span className={cn(
      'inline-block h-2 w-2 rounded-full shrink-0',
      status === 'complete'    ? 'bg-green-500'  :
      status === 'in-progress' ? 'bg-amber-400'  :
                                 'bg-muted-foreground/30',
    )} />
  )
}

// ── Section 00: Progress tracker ──────────────────────────────────────────────

function ProgressSection({ fw, onNavigate, onOwnerChange, onNoteChange, clientName }: {
  fw: FrameworkData
  onNavigate: (num: string) => void
  onOwnerChange: (num: string, val: string) => void
  onNoteChange: (num: string, val: string) => void
  clientName: string
}) {
  const statuses = SECTIONS.map((s) => getSectionStatus(fw, s.num))
  const complete = statuses.filter((s) => s === 'complete').length
  const inProgress = statuses.filter((s) => s === 'in-progress').length
  const notStarted = statuses.filter((s) => s === 'not-started').length

  return (
    <div>
      <div className="mb-6">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Overview</div>
        <h2 className="text-xl font-bold text-foreground">Document Completion Tracker</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">Click any row to navigate to that section.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        {[
          { val: complete,    label: 'Complete',    color: 'text-green-600' },
          { val: inProgress,  label: 'In Progress', color: 'text-amber-600' },
          { val: notStarted,  label: 'Not Started', color: 'text-muted-foreground' },
          { val: `${Math.round(complete / SECTIONS.length * 100)}%`, label: 'Done', color: 'text-blue-600' },
        ].map(({ val, label, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-5 py-3 text-center min-w-[80px]">
            <div className={cn('text-2xl font-extrabold', color)}>{val}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="w-8 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Section</th>
              <th className="w-28 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="w-36 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Owner</th>
              <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notes</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((sec) => {
              const st = getSectionStatus(fw, sec.num)
              return (
                <tr
                  key={sec.num}
                  className="cursor-pointer border-b border-border hover:bg-muted/20"
                  onClick={() => onNavigate(sec.num)}
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{sec.num}</td>
                  <td className="px-3 py-2 font-medium">{sec.short.replace('[Client]', clientName)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <StatusDot status={st} />
                      <span className={cn(
                        'text-[11px]',
                        st === 'complete'    ? 'text-green-600'  :
                        st === 'in-progress' ? 'text-amber-600'  :
                                              'text-muted-foreground',
                      )}>
                        {st === 'complete' ? 'Complete' : st === 'in-progress' ? 'In progress' : 'Not started'}
                      </span>
                    </span>
                  </td>
                  <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                    <FwTableInput
                      value={fw.sectionOwners?.[sec.num] ?? ''}
                      onChange={(v) => onOwnerChange(sec.num, v)}
                      placeholder="Owner"
                    />
                  </td>
                  <td className="px-1 py-1" onClick={(e) => e.stopPropagation()}>
                    <FwTableInput
                      value={fw.sectionNotes?.[sec.num] ?? ''}
                      onChange={(v) => onNoteChange(sec.num, v)}
                      placeholder="Notes"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section renderers ─────────────────────────────────────────────────────────

function S01({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  const s = fw.s01
  const u = (k: keyof typeof s, v: string) => set((d) => { d.s01[k] = v })
  return (
    <div>
      <FwSectionHeader num="01" title="Vertical Overview" />

      {/* Vertical Context table */}
      <div className="mb-6 overflow-hidden rounded-md border border-border">
        {/* Header row */}
        <div className="bg-muted/50 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Vertical Context
        </div>
        {/* Platform name row */}
        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <span className="w-36 shrink-0 text-sm font-medium text-foreground">Platform name:</span>
          <input
            type="text"
            value={s.platformName}
            onChange={(e) => u('platformName', e.target.value)}
            placeholder="e.g. Salesforce, HubSpot…"
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {/* Platform benefit row */}
        <div className="border-t border-border px-4 py-3">
          <textarea
            value={s.platformBenefit}
            onChange={(e) => u('platformBenefit', e.target.value)}
            rows={4}
            placeholder={`How does ${s.platformName || '[Platform name]'} specifically benefit this vertical? What operational outcomes does it enable?`}
            className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <FwField>
        <FwLabel>One-Line Positioning Statement</FwLabel>
        <FwHelp>{clientName} is the [role] for [target] that need [outcome] without [pain point].</FwHelp>
        <FwTextarea value={s.positioningStatement} onChange={(v) => u('positioningStatement', v)} rows={2} placeholder={`${clientName} is the…`}
          fieldId="s01.positioningStatement" sectionNum="01" sectionTitle="Vertical Overview" fieldLabel="One-Line Positioning Statement" />
      </FwField>
      <FwField>
        <FwLabel>Primary Tagline Options</FwLabel>
        <FwHelp>Short, punchy. 2–3 options. Works as hero headline on brochure and web page.</FwHelp>
        <FwTextarea value={s.taglineOptions} onChange={(v) => u('taglineOptions', v)} rows={3} placeholder={"1. \n2. \n3. "}
          fieldId="s01.taglineOptions" sectionNum="01" sectionTitle="Vertical Overview" fieldLabel="Primary Tagline Options (3 options)" />
      </FwField>
      <FwField>
        <FwLabel>How to Use This Document</FwLabel>
        <FwHelp>Describe the primary uses: sales prospecting, marketing campaign inputs, partner enablement.</FwHelp>
        <FwTextarea value={s.howToUse} onChange={(v) => u('howToUse', v)} rows={4} placeholder="This document is used for…"
          fieldId="s01.howToUse" sectionNum="01" sectionTitle="Vertical Overview" fieldLabel="How to Use This Document" />
      </FwField>
      <FwField>
        <FwLabel>What {clientName} Is NOT</FwLabel>
        <FwTextarea value={s.whatIsNot} onChange={(v) => u('whatIsNot', v)} rows={4} placeholder={`${clientName} is not…`}
          fieldId="s01.whatIsNot" sectionNum="01" sectionTitle="Vertical Overview" fieldLabel={`What ${clientName} Is NOT`} />
      </FwField>
    </div>
  )
}

function S02({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  const s = fw.s02
  const u = (k: keyof typeof s, v: unknown) => set((d) => { (d.s02 as Record<string, unknown>)[k] = v })
  return (
    <div>
      <FwSectionHeader num="02" title="Customer Definition + Profile" />
      <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Primary Target Profile</p>
      {(['industry','companySize','geography','itPosture','complianceStatus','contractProfile'] as const).map((k) => {
        const labels: Record<string, string> = {
          industry: 'Industry / Vertical', companySize: 'Company Size', geography: 'Geography',
          itPosture: 'IT Posture', complianceStatus: 'Compliance Status', contractProfile: 'Contract Profile',
        }
        const placeholders: Record<string, string> = {
          industry: 'Enter industry description', companySize: 'Company size if known',
          geography: 'US only / specific regions / international',
          itPosture: 'Lean, none, break-fix MSP, etc.',
          complianceStatus: 'Where they typically are in the compliance/maturity journey',
          contractProfile: 'What types of contracts or obligations drive the need',
        }
        const multiline = ['itPosture','complianceStatus','contractProfile','industry'].includes(k)
        return (
          <FwField key={k}>
            <FwLabel>{labels[k]}</FwLabel>
            {multiline
              ? <FwTextarea value={(s as unknown as Record<string, string>)[k]} onChange={(v) => u(k, v)} rows={2} placeholder={placeholders[k]} fieldId={`s02.${k}`} sectionNum="02" sectionTitle="Customer Definition + Profile" fieldLabel={labels[k]} />
              : <FwInput value={(s as unknown as Record<string, string>)[k]} onChange={(v) => u(k, v)} placeholder={placeholders[k]} fieldId={`s02.${k}`} sectionNum="02" sectionTitle="Customer Definition + Profile" fieldLabel={labels[k]} />
            }
          </FwField>
        )
      })}

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Primary Buyer Table</p>
        <button onClick={() => set((d) => { d.s02.buyerTable.push({ segment: '', primaryBuyer: '', corePain: '', entryPoint: '' }) })} className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Add Row</button>
      </div>
      <div className="mb-4">
        <FwTable headers={['Segment', 'Primary Buyer (Title / Role)', 'Core Pain', 'Entry Point', '']}>
          {s.buyerTable.map((row, i) => (
            <tr key={i} className="border-b border-border">
              {(['segment','primaryBuyer','corePain','entryPoint'] as const).map((k) => (
                <FwTableCell key={k}><FwTableTextarea value={row[k]} onChange={(v) => set((d) => { d.s02.buyerTable[i][k] = v })} rows={3} placeholder={k === 'segment' ? 'e.g. Regional Hospitals' : k === 'primaryBuyer' ? 'e.g. CIO, VP IT' : k} /></FwTableCell>
              ))}
              <FwTableCell>
                {s.buyerTable.length > 1 && <button onClick={() => set((d) => { d.s02.buyerTable.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
              </FwTableCell>
            </tr>
          ))}
        </FwTable>
        <AddButton onClick={() => set((d) => { d.s02.buyerTable.push({ segment: '', primaryBuyer: '', corePain: '', entryPoint: '' }) })} label="Add Row" />
      </div>

      <FwField>
        <FwLabel>Secondary Targets</FwLabel>
        <FwHelp>Adjacent industries, roles, or use cases that share the same challenges.</FwHelp>
        <FwTextarea value={s.secondaryTargets} onChange={(v) => u('secondaryTargets', v)} rows={4} placeholder="Describe secondary targets — adjacent industries, roles, or use cases." fieldId="s02.secondaryTargets" sectionNum="02" sectionTitle="Customer Definition + Profile" fieldLabel="Secondary Targets" />
      </FwField>
    </div>
  )
}

function S03({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  const s = fw.s03
  return (
    <div>
      <FwSectionHeader num="03" title="Market Pressures + Statistics" usedIn={SECTIONS[2].usedIn} />
      <FwField>
        <FwLabel>Market Pressure Narrative</FwLabel>
        <FwHelp>2-3 sentences describing the macro pressures facing this market right now. Becomes the opening of the brochure and eBook introduction.</FwHelp>
        <FwTextarea value={s.marketPressureNarrative} onChange={(v) => set((d) => { d.s03.marketPressureNarrative = v })} rows={4} placeholder="Describe 3-4 simultaneous pressures this market is experiencing." fieldId="s03.marketPressureNarrative" sectionNum="03" sectionTitle="Market Pressures + Statistics" fieldLabel="Market Pressure Narrative" />
      </FwField>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Key Statistics (with sources)</p>
        <button onClick={() => set((d) => { d.s03.statsTable.push({ stat: '', context: '', source: '', year: '' }) })} className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Add Row</button>
      </div>
      <FwHelp>4-6 stats that make the urgency undeniable. Include source and year for every stat.</FwHelp>
      <div className="mb-4">
        <FwTable headers={['Stat', 'Context / Label', 'Source', 'Year', '']}>
          {s.statsTable.map((row, i) => (
            <tr key={i} className="border-b border-border">
              <FwTableCell><FwTableInput value={row.stat} onChange={(v) => set((d) => { d.s03.statsTable[i].stat = v })} placeholder="e.g. 67%" /></FwTableCell>
              <FwTableCell><FwTableInput value={row.context} onChange={(v) => set((d) => { d.s03.statsTable[i].context = v })} placeholder="Context / label" /></FwTableCell>
              <FwTableCell><FwTableInput value={row.source} onChange={(v) => set((d) => { d.s03.statsTable[i].source = v })} placeholder="Source name" /></FwTableCell>
              <FwTableCell><FwTableInput value={row.year} onChange={(v) => set((d) => { d.s03.statsTable[i].year = v })} placeholder="Year" /></FwTableCell>
              <FwTableCell>
                {s.statsTable.length > 1 && <button onClick={() => set((d) => { d.s03.statsTable.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
              </FwTableCell>
            </tr>
          ))}
        </FwTable>
        <AddButton onClick={() => set((d) => { d.s03.statsTable.push({ stat: '', context: '', source: '', year: '' }) })} label="Add Row" />
      </div>

      <FwField>
        <FwLabel>Additional Context / Supporting Data</FwLabel>
        <FwHelp>Market sizing, analyst forecasts, contextual data. Include sources.</FwHelp>
        <FwTextarea value={s.additionalContext} onChange={(v) => set((d) => { d.s03.additionalContext = v })} rows={4} placeholder="e.g. Gartner estimates IT spending will reach $XXX billion by YYYY." fieldId="s03.additionalContext" sectionNum="03" sectionTitle="Market Pressures + Statistics" fieldLabel="Additional Context / Supporting Data" />
      </FwField>
    </div>
  )
}

function S04({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  return (
    <div>
      <FwSectionHeader num="04" title="Core Challenges" usedIn={SECTIONS[3].usedIn} />
      {fw.s04.challenges.map((ch, i) => (
        <FwCard key={i} title={ch.name || `Challenge ${i + 1}`} canDelete={fw.s04.challenges.length > 1}
          onDelete={() => set((d) => { d.s04.challenges.splice(i, 1) })}>
          <FwField><FwLabel>Challenge Name</FwLabel><FwInput value={ch.name} onChange={(v) => set((d) => { d.s04.challenges[i].name = v })} placeholder="Short descriptive title" fieldId={`s04.${i}.name`} sectionNum="04" sectionTitle="Core Challenges" fieldLabel="Challenge Name" /></FwField>
          <FwField><FwLabel>Why It Exists</FwLabel><FwTextarea value={ch.whyExists} onChange={(v) => set((d) => { d.s04.challenges[i].whyExists = v })} rows={3} placeholder="Explain the root cause" fieldId={`s04.${i}.whyExists`} sectionNum="04" sectionTitle="Core Challenges" fieldLabel="Why It Exists" /></FwField>
          <FwField><FwLabel>Business Consequence</FwLabel><FwTextarea value={ch.consequence} onChange={(v) => set((d) => { d.s04.challenges[i].consequence = v })} rows={3} placeholder="What happens if this isn't addressed" fieldId={`s04.${i}.consequence`} sectionNum="04" sectionTitle="Core Challenges" fieldLabel="Business Consequence" /></FwField>
          <FwField><FwLabel>{clientName} Solution</FwLabel><FwTextarea value={ch.solution} onChange={(v) => set((d) => { d.s04.challenges[i].solution = v })} rows={3} placeholder="Which service(s) address this" fieldId={`s04.${i}.solution`} sectionNum="04" sectionTitle="Core Challenges" fieldLabel={`${clientName} Solution`} /></FwField>
          <FwField><FwLabel>Service Pillars</FwLabel><FwInput value={ch.pillarsText} onChange={(v) => set((d) => { d.s04.challenges[i].pillarsText = v })} placeholder="e.g. Cloud / Cybersecurity / IT Operations" fieldId={`s04.${i}.pillarsText`} sectionNum="04" sectionTitle="Core Challenges" fieldLabel="Service Pillars" /></FwField>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s04.challenges.push({ name: '', whyExists: '', consequence: '', solution: '', pillarsText: '', _open: true }) })} label="Add Challenge" />
    </div>
  )
}

function S05({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  return (
    <div>
      <FwSectionHeader num="05" title="Solutions + Service Stack" usedIn={SECTIONS[4].usedIn} />
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Solution Pillars — Vertical Positioning</p>
      <FwHelp>For each pillar, write the vertical-specific value proposition.</FwHelp>
      {fw.s05.pillars.map((p, i) => (
        <FwCard key={i} title={p.pillar} canDelete={false} onDelete={() => {}}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div><FwLabel>Pillar Name</FwLabel><FwInput value={p.pillar} onChange={(v) => set((d) => { d.s05.pillars[i].pillar = v })} placeholder="Pillar name" fieldId={`s05.pillar.${i}.name`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Pillar Name" /></div>
            <div><FwLabel>Vertical Value Prop</FwLabel><FwTextarea value={p.valueProp} onChange={(v) => set((d) => { d.s05.pillars[i].valueProp = v })} rows={4} placeholder="What this pillar means for this market specifically…" fieldId={`s05.pillar.${i}.valueProp`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Vertical Value Prop" /></div>
            <div><FwLabel>Key Services</FwLabel><FwTextarea value={p.keyServices} onChange={(v) => set((d) => { d.s05.pillars[i].keyServices = v })} rows={4} placeholder="Key services" fieldId={`s05.pillar.${i}.keyServices`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Key Services" /></div>
            <div><FwLabel>Relevant To</FwLabel><FwTextarea value={p.relevantTo} onChange={(v) => set((d) => { d.s05.pillars[i].relevantTo = v })} rows={4} placeholder="Which sub-segments" fieldId={`s05.pillar.${i}.relevantTo`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Relevant To" /></div>
          </div>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s05.pillars.push({ pillar: `Pillar ${d.s05.pillars.length + 1}`, valueProp: '', keyServices: '', relevantTo: '', _open: true }) })} label="Add Pillar" />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Full Service Stack — Mapped to Vertical Needs</p>
        <button onClick={() => set((d) => { d.s05.serviceStack.push({ service: '', regulatoryDomain: '', whatItDelivers: '', priority: '', _open: true }) })} className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Add Service</button>
      </div>
      <FwHelp>List every {clientName} service relevant to this vertical. For each, describe what it delivers in context.</FwHelp>
      {fw.s05.serviceStack.map((row, i) => (
        <FwCard key={i} title={row.service || `Service ${i + 1}`} canDelete={fw.s05.serviceStack.length > 1}
          onDelete={() => set((d) => { d.s05.serviceStack.splice(i, 1) })}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div><FwLabel>Service Name</FwLabel><FwInput value={row.service} onChange={(v) => set((d) => { d.s05.serviceStack[i].service = v })} placeholder="Service name" fieldId={`s05.service.${i}.name`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Service Name" /></div>
            <div><FwLabel>Regulatory Domain (if applicable)</FwLabel><FwInput value={row.regulatoryDomain ?? ''} onChange={(v) => set((d) => { d.s05.serviceStack[i].regulatoryDomain = v })} placeholder="e.g. HIPAA, SOX, GDPR…" fieldId={`s05.service.${i}.regulatoryDomain`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Regulatory Domain" /></div>
            <div><FwLabel>What It Delivers (in this vertical)</FwLabel><FwTextarea value={row.whatItDelivers} onChange={(v) => set((d) => { d.s05.serviceStack[i].whatItDelivers = v })} rows={3} placeholder="What this delivers specifically for this market…" fieldId={`s05.service.${i}.whatItDelivers`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="What It Delivers (in this vertical)" /></div>
            <div><FwLabel>Priority / Relevance</FwLabel><FwInput value={row.priority} onChange={(v) => set((d) => { d.s05.serviceStack[i].priority = v })} placeholder="High / Medium / Low" fieldId={`s05.service.${i}.priority`} sectionNum="05" sectionTitle="Solutions + Service Stack" fieldLabel="Priority / Relevance" /></div>
          </div>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s05.serviceStack.push({ service: '', regulatoryDomain: '', whatItDelivers: '', priority: '', _open: true }) })} label="Add Service" />
    </div>
  )
}

function S06({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  return (
    <div>
      <FwSectionHeader num="06" title={`Why ${clientName}`} usedIn={SECTIONS[5].usedIn} />
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Differentiator Table</p>
      <FwHelp>6-8 differentiators specific to this vertical. Generic company-wide proof points go in Section 09.</FwHelp>
      {fw.s06.differentiators.map((d, i) => (
        <FwCard key={i} title={d.label || `Differentiator ${i + 1}`} canDelete={fw.s06.differentiators.length > 1}
          onDelete={() => set((dd) => { dd.s06.differentiators.splice(i, 1) })}>
          <FwField><FwLabel>Label</FwLabel><FwInput value={d.label} onChange={(v) => set((dd) => { dd.s06.differentiators[i].label = v })} placeholder="e.g. 'Local expertise + national capabilities'" fieldId={`s06.${i}.label`} sectionNum="06" sectionTitle={`Why ${clientName}`} fieldLabel="Differentiator Label" /></FwField>
          <FwField><FwLabel>{clientName} Position</FwLabel><FwTextarea value={d.position} onChange={(v) => set((dd) => { dd.s06.differentiators[i].position = v })} rows={4} placeholder="What makes this true and specific to this vertical." fieldId={`s06.${i}.position`} sectionNum="06" sectionTitle={`Why ${clientName}`} fieldLabel={`${clientName} Position`} /></FwField>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s06.differentiators.push({ label: '', position: '', _open: true }) })} label="Add Differentiator" />
    </div>
  )
}

function S07({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  return (
    <div>
      <FwSectionHeader num="07" title="Segments + Buyer Profiles" usedIn={SECTIONS[6].usedIn} />
      {fw.s07.segments.map((sg, i) => (
        <FwCard key={i} title={sg.name || `Segment ${i + 1}`} canDelete={fw.s07.segments.length > 1}
          onDelete={() => set((d) => { d.s07.segments.splice(i, 1) })}>
          <FwField><FwLabel>Segment Name</FwLabel><FwInput value={sg.name} onChange={(v) => set((d) => { d.s07.segments[i].name = v })} placeholder="Short descriptive name" fieldId={`s07.${i}.name`} sectionNum="07" sectionTitle="Segments + Buyer Profiles" fieldLabel="Segment Name" /></FwField>
          <FwField><FwLabel>Primary Buyer Title(s)</FwLabel><FwInput value={sg.primaryBuyerTitles} onChange={(v) => set((d) => { d.s07.segments[i].primaryBuyerTitles = v })} placeholder="Role / Title / Function" fieldId={`s07.${i}.primaryBuyerTitles`} sectionNum="07" sectionTitle="Segments + Buyer Profiles" fieldLabel="Primary Buyer Title(s)" /></FwField>
          <FwField><FwLabel>What Is Different</FwLabel><FwTextarea value={sg.whatIsDifferent} onChange={(v) => set((d) => { d.s07.segments[i].whatIsDifferent = v })} rows={3} placeholder="What makes this sub-segment unique vs. the others" fieldId={`s07.${i}.whatIsDifferent`} sectionNum="07" sectionTitle="Segments + Buyer Profiles" fieldLabel="What Is Different" /></FwField>
          <FwField><FwLabel>Key Pressures</FwLabel><FwTextarea value={sg.keyPressures} onChange={(v) => set((d) => { d.s07.segments[i].keyPressures = v })} rows={3} placeholder="2–3 specific pressures for this sub-segment" fieldId={`s07.${i}.keyPressures`} sectionNum="07" sectionTitle="Segments + Buyer Profiles" fieldLabel="Key Pressures" /></FwField>
          <FwField><FwLabel>Lead Hook</FwLabel><FwTextarea value={sg.leadHook} onChange={(v) => set((d) => { d.s07.segments[i].leadHook = v })} rows={2} placeholder="The opening question or statement that opens the conversation" fieldId={`s07.${i}.leadHook`} sectionNum="07" sectionTitle="Segments + Buyer Profiles" fieldLabel="Lead Hook" /></FwField>
          <FwField><FwLabel>Compliance / Context Notes</FwLabel><FwTextarea value={sg.complianceNotes} onChange={(v) => set((d) => { d.s07.segments[i].complianceNotes = v })} rows={3} placeholder="Sub-segment-specific regulatory, operational, or technical context" fieldId={`s07.${i}.complianceNotes`} sectionNum="07" sectionTitle="Segments + Buyer Profiles" fieldLabel="Compliance / Context Notes" /></FwField>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s07.segments.push({ name: '', primaryBuyerTitles: '', whatIsDifferent: '', keyPressures: '', leadHook: '', complianceNotes: '', _open: true }) })} label="Add Segment" />
    </div>
  )
}

function S08({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  const s = fw.s08
  return (
    <div>
      <FwSectionHeader num="08" title="Messaging Framework" usedIn={SECTIONS[7].usedIn} />
      <FwField>
        <FwLabel>Problems (2-3 sentences)</FwLabel>
        <FwHelp>The overarching problem statement. Pain-first. No solution language yet.</FwHelp>
        <FwTextarea value={s.problems} onChange={(v) => set((d) => { d.s08.problems = v })} rows={4} placeholder="Describe the core problem in 2-3 sentences."
          fieldId="s08.problems" sectionNum="08" sectionTitle="Messaging Framework" fieldLabel="Core Problems (pain-first, 2-3 sentences)" />
      </FwField>
      <FwField>
        <FwLabel>Solution (2-3 sentences)</FwLabel>
        <FwHelp>How {clientName} solves the problem. High-level — not a service list.</FwHelp>
        <FwTextarea value={s.solution} onChange={(v) => set((d) => { d.s08.solution = v })} rows={4} placeholder={`Describe the ${clientName} solution in 2-3 sentences. Outcome-focused.`}
          fieldId="s08.solution" sectionNum="08" sectionTitle="Messaging Framework" fieldLabel={`How ${clientName} solves the problem (2-3 sentences, outcome-focused)`} />
      </FwField>
      <FwField>
        <FwLabel>Outcomes (2-3 sentences)</FwLabel>
        <FwHelp>What the client achieves. The 'after' state.</FwHelp>
        <FwTextarea value={s.outcomes} onChange={(v) => set((d) => { d.s08.outcomes = v })} rows={4} placeholder="Describe measurable or observable outcomes."
          fieldId="s08.outcomes" sectionNum="08" sectionTitle="Messaging Framework" fieldLabel="Outcomes — the 'after' state (measurable, 2-3 sentences)" />
      </FwField>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Value Proposition by Pillar</p>
        <button onClick={() => set((d) => { d.s08.valuePropTable.push({ pillar: '', meaning: '', proofPoint: '', citation: '' }) })} className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Add Row</button>
      </div>
      <FwTable headers={['Pillar', 'For This Vertical, This Means…', 'Proof Point', 'Citation', '']}>
        {s.valuePropTable.map((row, i) => (
          <tr key={i} className="border-b border-border">
            <FwTableCell><FwTableTextarea value={row.pillar} onChange={(v) => set((d) => { d.s08.valuePropTable[i].pillar = v })} rows={4} placeholder="Pillar name…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.meaning} onChange={(v) => set((d) => { d.s08.valuePropTable[i].meaning = v })} rows={4} placeholder="What this pillar means for this vertical…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.proofPoint} onChange={(v) => set((d) => { d.s08.valuePropTable[i].proofPoint = v })} rows={4} placeholder="e.g. 99.9% uptime SLA" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.citation} onChange={(v) => set((d) => { d.s08.valuePropTable[i].citation = v })} rows={4} placeholder="Name & URL" /></FwTableCell>
            <FwTableCell>
              {s.valuePropTable.length > 1 && (
                <button onClick={() => set((d) => { d.s08.valuePropTable.splice(i, 1) })} className="text-muted-foreground hover:text-destructive transition-colors" title="Remove row">✕</button>
              )}
            </FwTableCell>
          </tr>
        ))}
      </FwTable>
    </div>
  )
}

function S09({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  const s = fw.s09
  return (
    <div>
      <FwSectionHeader num="09" title="Proof Points + Case Studies" usedIn={SECTIONS[8].usedIn} />
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{clientName} Company-Wide Proof Points</p>
      <FwHelp>Standard proof points — update if numbers have changed.</FwHelp>
      <div className="mb-6">
        <FwTable headers={['Proof Point', 'Source / Context', '']}>
          {s.proofPoints.map((pp, i) => (
            <tr key={i} className="border-b border-border">
              <FwTableCell><FwTableInput value={pp.text} onChange={(v) => set((d) => { d.s09.proofPoints[i].text = v })} placeholder="Proof point text" /></FwTableCell>
              <FwTableCell><FwTableInput value={pp.source} onChange={(v) => set((d) => { d.s09.proofPoints[i].source = v })} placeholder="Source" /></FwTableCell>
              <FwTableCell>
                {s.proofPoints.length > 1 && <button onClick={() => set((d) => { d.s09.proofPoints.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
              </FwTableCell>
            </tr>
          ))}
        </FwTable>
        <AddButton onClick={() => set((d) => { d.s09.proofPoints.push({ text: '', source: '' }) })} label="Add Proof Point" />
      </div>

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Case Studies</p>
      {s.caseStudies.map((cs, i) => (
        <FwCard key={i} title={cs.clientProfile || `Case Study ${i + 1}`} canDelete={s.caseStudies.length > 1}
          onDelete={() => set((d) => { d.s09.caseStudies.splice(i, 1) })}>
          <FwField><FwLabel>Client Profile</FwLabel><FwInput value={cs.clientProfile} onChange={(v) => set((d) => { d.s09.caseStudies[i].clientProfile = v })} placeholder="Industry, size, geography — or anonymized descriptor" fieldId={`s09.${i}.clientProfile`} sectionNum="09" sectionTitle="Proof Points + Case Studies" fieldLabel="Client Profile" /></FwField>
          <FwField><FwLabel>Case Study URL</FwLabel><FwInput value={cs.url} onChange={(v) => set((d) => { d.s09.caseStudies[i].url = v })} placeholder="URL" /></FwField>
          <FwField><FwLabel>Situation / Challenge</FwLabel><FwTextarea value={cs.situation} onChange={(v) => set((d) => { d.s09.caseStudies[i].situation = v })} rows={3} placeholder={`What was happening before ${clientName}`} fieldId={`s09.${i}.situation`} sectionNum="09" sectionTitle="Proof Points + Case Studies" fieldLabel="Situation / Challenge" /></FwField>
          <FwField><FwLabel>{clientName} Engagement</FwLabel><FwTextarea value={cs.engagement} onChange={(v) => set((d) => { d.s09.caseStudies[i].engagement = v })} rows={3} placeholder={`What ${clientName} delivered`} fieldId={`s09.${i}.engagement`} sectionNum="09" sectionTitle="Proof Points + Case Studies" fieldLabel={`${clientName} Engagement`} /></FwField>
          <FwField><FwLabel>Outcomes</FwLabel><FwTextarea value={cs.outcomes} onChange={(v) => set((d) => { d.s09.caseStudies[i].outcomes = v })} rows={3} placeholder="Measurable results — time, cost, risk reduction, uptime, etc." fieldId={`s09.${i}.outcomes`} sectionNum="09" sectionTitle="Proof Points + Case Studies" fieldLabel="Outcomes" /></FwField>
          <FwField><FwLabel>30-Second Version</FwLabel><FwTextarea value={cs.thirtySecond} onChange={(v) => set((d) => { d.s09.caseStudies[i].thirtySecond = v })} rows={3} placeholder="2–3 bullets for BDR emails and cheat sheet" fieldId={`s09.${i}.thirtySecond`} sectionNum="09" sectionTitle="Proof Points + Case Studies" fieldLabel="30-Second Version" /></FwField>
          <FwField><FwLabel>Headline Stat or Badge</FwLabel><FwInput value={cs.headlineStat} onChange={(v) => set((d) => { d.s09.caseStudies[i].headlineStat = v })} placeholder="e.g. '60 days. Complete IT transformation.'" fieldId={`s09.${i}.headlineStat`} sectionNum="09" sectionTitle="Proof Points + Case Studies" fieldLabel="Headline Stat or Badge" /></FwField>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s09.caseStudies.push({ clientProfile: '', url: '', situation: '', engagement: '', outcomes: '', thirtySecond: '', headlineStat: '', _open: true }) })} label="Add Case Study" />
    </div>
  )
}

function S10({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  return (
    <div>
      <FwSectionHeader num="10" title="Objection Handling" usedIn={SECTIONS[9].usedIn} />
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Objection Handling Table</p>
      <FwHelp>6-8 most common objections in this vertical. Include the follow-up question or next action.</FwHelp>
      <FwTable headers={['Objection', 'Sales Response', 'Follow-Up Question / Action', '']}>
        {fw.s10.objections.map((row, i) => (
          <tr key={i} className="border-b border-border">
            <FwTableCell><FwTableTextarea value={row.objection} onChange={(v) => set((d) => { d.s10.objections[i].objection = v })} rows={4} placeholder="e.g. 'We already have an MSP'" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.response} onChange={(v) => set((d) => { d.s10.objections[i].response = v })} rows={4} placeholder="Sales response…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.followUp} onChange={(v) => set((d) => { d.s10.objections[i].followUp = v })} rows={4} placeholder="Follow-up question…" /></FwTableCell>
            <FwTableCell>
              {fw.s10.objections.length > 1 && <button onClick={() => set((d) => { d.s10.objections.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
            </FwTableCell>
          </tr>
        ))}
      </FwTable>
      <AddButton onClick={() => set((d) => { d.s10.objections.push({ objection: '', response: '', followUp: '' }) })} label="Add Objection" />
    </div>
  )
}

function S11({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  const s = fw.s11
  return (
    <div>
      <FwSectionHeader num="11" title="Brand Voice Examples" usedIn={SECTIONS[10].usedIn} />
      <FwHelp>This is the single biggest quality lever for asset generation — the more specific your examples, the better every output.</FwHelp>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Voice Characteristics</p>
      {([
        ['toneTarget', 'Tone Target', "e.g. Confident, direct, peer-to-peer. Never condescending or fear-mongering."],
        ['vocabularyLevel', 'Vocabulary Level', "e.g. Technical enough to be credible, accessible enough for a CFO or COO"],
        ['sentenceStyle', 'Sentence Style', "e.g. Short declarative sentences. Active voice. No passive constructions."],
        ['whatToAvoid', 'What to Avoid', "e.g. Jargon, buzzwords, vague claims, passive voice, excessive hedging"],
      ] as const).map(([k, label, placeholder]) => (
        <FwField key={k}>
          <FwLabel>{label}</FwLabel>
          <FwTextarea value={(s as unknown as Record<string, string>)[k]} onChange={(v) => set((d) => { (d.s11 as unknown as Record<string, unknown>)[k] = v })} rows={2} placeholder={placeholder} fieldId={`s11.${k}`} sectionNum="11" sectionTitle="Brand Voice Examples" fieldLabel={label} />
        </FwField>
      ))}

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-green-600">Sounds Like — Good Examples (3-5)</p>
      <FwHelp>Write 3-5 sample sentences that are exactly on-voice. These should feel like they could go directly into the brochure or web page.</FwHelp>
      {s.goodExamples.map((ex, i) => (
        <div key={i} className="mb-2 flex items-start gap-2">
          <span className="mt-2.5 shrink-0 text-[11px] font-bold text-green-600">Ex {i + 1}</span>
          <FwTextarea value={ex.text} onChange={(v) => set((d) => { d.s11.goodExamples[i].text = v })} rows={2} placeholder="Write a sentence that perfectly captures the right tone." />
          {s.goodExamples.length > 1 && (
            <button onClick={() => set((d) => { d.s11.goodExamples.splice(i, 1) })} className="mt-2 text-red-400 hover:text-red-600 text-xs shrink-0">✕</button>
          )}
        </div>
      ))}
      <AddButton onClick={() => set((d) => { d.s11.goodExamples.push({ text: '' }) })} label="Add Good Example" />

      <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-widest text-red-500">Does NOT Sound Like — Bad Examples</p>
      {s.badExamples.map((ex, i) => (
        <div key={i} className="mb-3 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-red-500">Bad Example {i + 1}</span>
            {s.badExamples.length > 1 && <button onClick={() => set((d) => { d.s11.badExamples.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
          </div>
          <FwTextarea value={ex.bad} onChange={(v) => set((d) => { d.s11.badExamples[i].bad = v })} rows={2} placeholder="Write an off-voice example." />
          <div className="mt-2 text-[11px] font-bold text-green-600">Why it's wrong:</div>
          <FwInput value={ex.whyWrong} onChange={(v) => set((d) => { d.s11.badExamples[i].whyWrong = v })} placeholder="e.g. Too jargon-heavy / Too fear-based / Too generic" />
        </div>
      ))}
      <AddButton onClick={() => set((d) => { d.s11.badExamples.push({ bad: '', whyWrong: '' }) })} label="Add Bad Example" />
    </div>
  )
}

function S12({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  return (
    <div>
      <FwSectionHeader num="12" title="Competitive Differentiation" usedIn={SECTIONS[11].usedIn} />
      <FwHelp>Keep specific competitor names out of public-facing assets. Use this internally to sharpen the cheat sheet, BDR emails, and deck speaker notes.</FwHelp>
      <FwTable headers={['Alternative / Competitor Type', 'Their Positioning', `${clientName} Counter`, 'When This Comes Up', '']}>
        {fw.s12.competitors.map((row, i) => (
          <tr key={i} className="border-b border-border">
            <FwTableCell><FwTableTextarea value={row.type} onChange={(v) => set((d) => { d.s12.competitors[i].type = v })} rows={4} placeholder="e.g. Incumbent MSP with no compliance depth" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.positioning} onChange={(v) => set((d) => { d.s12.competitors[i].positioning = v })} rows={4} placeholder="They already have an MSP relationship" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.counter} onChange={(v) => set((d) => { d.s12.competitors[i].counter = v })} rows={4} placeholder={`${clientName} counter…`} /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.whenComesUp} onChange={(v) => set((d) => { d.s12.competitors[i].whenComesUp = v })} rows={4} placeholder="Almost every deal" /></FwTableCell>
            <FwTableCell>
              {fw.s12.competitors.length > 1 && <button onClick={() => set((d) => { d.s12.competitors.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
            </FwTableCell>
          </tr>
        ))}
      </FwTable>
      <AddButton onClick={() => set((d) => { d.s12.competitors.push({ type: '', positioning: '', counter: '', whenComesUp: '' }) })} label="Add Competitor" />
    </div>
  )
}

function S13({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  return (
    <div>
      <FwSectionHeader num="13" title="Customer Quotes + Testimonials" usedIn={SECTIONS[12].usedIn} />
      <FwHelp>Even anonymized or paraphrased quotes add human credibility that stats alone cannot provide.</FwHelp>
      {fw.s13.quotes.map((q, i) => (
        <FwCard key={i} title={q.attribution || (q.quoteText?.slice(0, 40) ?? `Quote ${i + 1}`)} canDelete={fw.s13.quotes.length > 1}
          onDelete={() => set((d) => { d.s13.quotes.splice(i, 1) })}>
          <FwField><FwLabel>Quote Text</FwLabel><FwTextarea value={q.quoteText} onChange={(v) => set((d) => { d.s13.quotes[i].quoteText = v })} rows={4} placeholder="The actual or paraphrased quote — in the customer's words, not ours" fieldId={`s13.${i}.quoteText`} sectionNum="13" sectionTitle="Customer Quotes + Testimonials" fieldLabel="Quote Text" /></FwField>
          <FwField><FwLabel>Attribution</FwLabel><FwInput value={q.attribution} onChange={(v) => set((d) => { d.s13.quotes[i].attribution = v })} placeholder="Role + company type (anonymized if needed)" fieldId={`s13.${i}.attribution`} sectionNum="13" sectionTitle="Customer Quotes + Testimonials" fieldLabel="Attribution" /></FwField>
          <FwField><FwLabel>Context</FwLabel><FwTextarea value={q.context} onChange={(v) => set((d) => { d.s13.quotes[i].context = v })} rows={2} placeholder="When / why this was said" fieldId={`s13.${i}.context`} sectionNum="13" sectionTitle="Customer Quotes + Testimonials" fieldLabel="Context" /></FwField>
          <FwField><FwLabel>Best Used In</FwLabel><FwInput value={q.bestUsedIn} onChange={(v) => set((d) => { d.s13.quotes[i].bestUsedIn = v })} placeholder="Which asset this quote is best suited for" fieldId={`s13.${i}.bestUsedIn`} sectionNum="13" sectionTitle="Customer Quotes + Testimonials" fieldLabel="Best Used In" /></FwField>
          <FwField><FwLabel>Approved for Use?</FwLabel><FwInput value={q.approved} onChange={(v) => set((d) => { d.s13.quotes[i].approved = v })} placeholder="Yes (direct quote) / Paraphrased / Internal only" fieldId={`s13.${i}.approved`} sectionNum="13" sectionTitle="Customer Quotes + Testimonials" fieldLabel="Approved for Use?" /></FwField>
        </FwCard>
      ))}
      <AddButton onClick={() => set((d) => { d.s13.quotes.push({ quoteText: '', attribution: '', context: '', bestUsedIn: '', approved: '', _open: true }) })} label="Add Quote" />
    </div>
  )
}

function S14({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  return (
    <div>
      <FwSectionHeader num="14" title="Campaign Themes + Asset Mapping" usedIn={SECTIONS[13].usedIn} />
      <FwHelp>Define 3-4 themes, then map each to the assets it drives. Campaign themes give the asset suite coherence.</FwHelp>
      <FwTable headers={['Campaign Theme', 'Target Audience', 'Primary Assets', 'Key Message', '']}>
        {fw.s14.campaigns.map((row, i) => (
          <tr key={i} className="border-b border-border">
            <FwTableCell><FwTableTextarea value={row.theme} onChange={(v) => set((d) => { d.s14.campaigns[i].theme = v })} rows={3} placeholder="Campaign theme…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.targetAudience} onChange={(v) => set((d) => { d.s14.campaigns[i].targetAudience = v })} rows={3} placeholder="Target audience…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.primaryAssets} onChange={(v) => set((d) => { d.s14.campaigns[i].primaryAssets = v })} rows={3} placeholder="Assets…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.keyMessage} onChange={(v) => set((d) => { d.s14.campaigns[i].keyMessage = v })} rows={3} placeholder="Key message…" /></FwTableCell>
            <FwTableCell>
              {fw.s14.campaigns.length > 1 && <button onClick={() => set((d) => { d.s14.campaigns.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
            </FwTableCell>
          </tr>
        ))}
      </FwTable>
      <AddButton onClick={() => set((d) => { d.s14.campaigns.push({ theme: '', targetAudience: '', primaryAssets: '', keyMessage: '' }) })} label="Add Campaign" />
    </div>
  )
}

function S15({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  return (
    <div>
      <FwSectionHeader num="15" title="Frequently Asked Questions" usedIn={SECTIONS[14].usedIn} />
      <FwHelp>The closer these are to verbatim questions from real discovery calls, the better. 10-15 questions ideal.</FwHelp>
      <FwTable headers={['Question (verbatim if possible)', `${clientName} Answer`, 'Best Addressed In', '']}>
        {fw.s15.faqs.map((row, i) => (
          <tr key={i} className="border-b border-border">
            <FwTableCell><FwTableTextarea value={row.question} onChange={(v) => set((d) => { d.s15.faqs[i].question = v })} rows={4} placeholder="Question…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.answer} onChange={(v) => set((d) => { d.s15.faqs[i].answer = v })} rows={4} placeholder="Answer…" /></FwTableCell>
            <FwTableCell><FwTableTextarea value={row.bestAddressedIn} onChange={(v) => set((d) => { d.s15.faqs[i].bestAddressedIn = v })} rows={4} placeholder="e.g. Brochure, Sales deck" /></FwTableCell>
            <FwTableCell>
              {fw.s15.faqs.length > 1 && <button onClick={() => set((d) => { d.s15.faqs.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
            </FwTableCell>
          </tr>
        ))}
      </FwTable>
      <AddButton onClick={() => set((d) => { d.s15.faqs.push({ question: '', answer: '', bestAddressedIn: '' }) })} label="Add FAQ" />
    </div>
  )
}

function S16({ fw, set }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void }) {
  return (
    <div>
      <FwSectionHeader num="16" title="Content Funnel Mapping" usedIn={SECTIONS[15].usedIn} />
      <FwHelp>Mapping assets to funnel stages ensures CTAs point to the right next step.</FwHelp>
      <div className="mb-6">
        <FwTable headers={['Funnel Stage', 'Assets at This Stage', 'Primary CTA from This Stage', 'Buyer State']}>
          {fw.s16.funnelStages.map((row, i) => (
            <tr key={i} className="border-b border-border">
              <FwTableCell><FwTableTextarea value={row.stage} onChange={(v) => set((d) => { d.s16.funnelStages[i].stage = v })} rows={3} placeholder="Funnel stage…" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.assets} onChange={(v) => set((d) => { d.s16.funnelStages[i].assets = v })} rows={3} placeholder="Assets…" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.primaryCTA} onChange={(v) => set((d) => { d.s16.funnelStages[i].primaryCTA = v })} rows={3} placeholder="Primary CTA…" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.buyerState} onChange={(v) => set((d) => { d.s16.funnelStages[i].buyerState = v })} rows={3} placeholder="Buyer state / intent signal…" /></FwTableCell>
            </tr>
          ))}
        </FwTable>
      </div>
      <FwField>
        <FwLabel>CTA Sequencing Notes</FwLabel>
        <FwHelp>Describe how the CTAs should chain together — what does each asset lead to next?</FwHelp>
        <FwTextarea value={fw.s16.ctaSequencing} onChange={(v) => set((d) => { d.s16.ctaSequencing = v })} rows={5} placeholder="e.g. Video → web page → eBook gate → assessment → brochure leave-behind → deck → proposal." fieldId="s16.ctaSequencing" sectionNum="16" sectionTitle="Content Funnel Mapping" fieldLabel="CTA Sequencing Notes" />
      </FwField>
    </div>
  )
}

function S17({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  return (
    <div>
      <FwSectionHeader num="17" title="Regulatory + Compliance Context" usedIn={SECTIONS[16].usedIn} />
      <FwHelp>Include only frameworks where {clientName} has a direct service capability.</FwHelp>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Regulatory Framework Table</p>
        <button onClick={() => set((d) => { d.s17.regulations.push({ requirement: '', capability: '', servicePillar: '', salesNote: '' }) })} className="text-xs text-blue-500 hover:text-blue-700 font-medium">+ Add Row</button>
      </div>
      <div className="mb-4">
        <FwTable headers={['Regulatory Requirement', `${clientName} Capability`, 'Service Pillar', 'Sales Note', '']}>
          {fw.s17.regulations.map((row, i) => (
            <tr key={i} className="border-b border-border">
              <FwTableCell><FwTableTextarea value={row.requirement} onChange={(v) => set((d) => { d.s17.regulations[i].requirement = v })} rows={4} placeholder="Framework / Requirement" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.capability} onChange={(v) => set((d) => { d.s17.regulations[i].capability = v })} rows={4} placeholder={`${clientName} capability`} /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.servicePillar} onChange={(v) => set((d) => { d.s17.regulations[i].servicePillar = v })} rows={4} placeholder="Service pillar" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.salesNote} onChange={(v) => set((d) => { d.s17.regulations[i].salesNote = v })} rows={4} placeholder="Sales note" /></FwTableCell>
              <FwTableCell>
                {fw.s17.regulations.length > 1 && <button onClick={() => set((d) => { d.s17.regulations.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
              </FwTableCell>
            </tr>
          ))}
        </FwTable>
        <AddButton onClick={() => set((d) => { d.s17.regulations.push({ requirement: '', capability: '', servicePillar: '', salesNote: '' }) })} label="Add Row" />
      </div>
      <FwField>
        <FwLabel>Regulatory Sales Note</FwLabel>
        <FwHelp>How should sales use regulatory pressure in the conversation? Lead with it or use it as reinforcement?</FwHelp>
        <FwTextarea value={fw.s17.regulatorySalesNote} onChange={(v) => set((d) => { d.s17.regulatorySalesNote = v })} rows={4} placeholder="e.g. Use regulatory pressure as the urgency trigger, not the primary value proposition." fieldId="s17.regulatorySalesNote" sectionNum="17" sectionTitle="Regulatory + Compliance Context" fieldLabel="Regulatory Sales Note" />
      </FwField>
    </div>
  )
}

function S18({ fw, set, clientName }: { fw: FrameworkData; set: (fn: (d: FrameworkData) => void) => void; clientName: string }) {
  const s = fw.s18
  return (
    <div>
      <FwSectionHeader num="18" title="CTAs + Next Steps" usedIn={SECTIONS[17].usedIn} />

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Primary CTAs</p>
      <FwHelp>3-4 CTAs in order of preference. Each should have a clear description, target audience, and trigger condition.</FwHelp>
      <div className="mb-6">
        <FwTable headers={['CTA Name', 'Description', 'Target Audience / Trigger', 'Asset(s)', '']}>
          {s.ctas.map((row, i) => (
            <tr key={i} className="border-b border-border">
              <FwTableCell><FwTableTextarea value={row.ctaName} onChange={(v) => set((d) => { d.s18.ctas[i].ctaName = v })} rows={3} placeholder={`CTA ${i + 1}`} /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.description} onChange={(v) => set((d) => { d.s18.ctas[i].description = v })} rows={3} placeholder="What happens in this assessment / conversation" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.targetAudienceTrigger} onChange={(v) => set((d) => { d.s18.ctas[i].targetAudienceTrigger = v })} rows={3} placeholder="Who it's for and when to offer it" /></FwTableCell>
              <FwTableCell><FwTableTextarea value={row.assets} onChange={(v) => set((d) => { d.s18.ctas[i].assets = v })} rows={3} placeholder="Brochure · Web page · Deck CTA slide" /></FwTableCell>
              <FwTableCell>
                {s.ctas.length > 1 && <button onClick={() => set((d) => { d.s18.ctas.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
              </FwTableCell>
            </tr>
          ))}
        </FwTable>
        <AddButton onClick={() => set((d) => { d.s18.ctas.push({ ctaName: '', description: '', targetAudienceTrigger: '', assets: '' }) })} label="Add CTA" />
      </div>

      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Campaign Theme Suggestions</p>
      <FwHelp>2-4 campaign names with a one-sentence description of what each campaign is for.</FwHelp>
      {s.campaignThemes.map((ct, i) => (
        <div key={i} className="mb-3 rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-blue-500">Campaign {i + 1}</span>
            {s.campaignThemes.length > 1 && <button onClick={() => set((d) => { d.s18.campaignThemes.splice(i, 1) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
          </div>
          <FwField><FwLabel>Campaign Name</FwLabel><FwInput value={ct.campaignName} onChange={(v) => set((d) => { d.s18.campaignThemes[i].campaignName = v })} placeholder="Campaign name" fieldId={`s18.campaign.${i}.name`} sectionNum="18" sectionTitle="CTAs + Next Steps" fieldLabel="Campaign Name" /></FwField>
          <FwField><FwLabel>Description</FwLabel><FwTextarea value={ct.description} onChange={(v) => set((d) => { d.s18.campaignThemes[i].description = v })} rows={2} placeholder="One sentence: what this campaign is, who it targets, and what it drives." fieldId={`s18.campaign.${i}.description`} sectionNum="18" sectionTitle="CTAs + Next Steps" fieldLabel="Campaign Description" /></FwField>
        </div>
      ))}
      <AddButton onClick={() => set((d) => { d.s18.campaignThemes.push({ campaignName: '', description: '' }) })} label="Add Campaign Theme" />

      <p className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Contact Information</p>
      <FwHelp>Who internally owns this document? Who should be contacted for questions about this messaging document?</FwHelp>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {([
          ['verticalOwner', 'Vertical Owner', 'Name or role'],
          ['marketingContact', 'Marketing Contact', 'Name or role'],
          ['salesLead', 'Sales Lead', 'Name or role'],
          ['documentVersion', 'Document Version', 'v1.0'],
        ] as const).map(([k, label, placeholder]) => (
          <FwField key={k}>
            <FwLabel>{label}</FwLabel>
            <FwInput value={(s.contact as Record<string, string>)[k]} onChange={(v) => set((d) => { (d.s18.contact as Record<string, string>)[k] = v })} placeholder={placeholder} />
          </FwField>
        ))}
        <FwField>
          <FwLabel>Last Updated</FwLabel>
          <FwInput type="date" value={s.contact.lastUpdated} onChange={(v) => set((d) => { d.s18.contact.lastUpdated = v })} />
        </FwField>
        <FwField>
          <FwLabel>Next Review Date</FwLabel>
          <FwInput type="date" value={s.contact.nextReviewDate} onChange={(v) => set((d) => { d.s18.contact.nextReviewDate = v })} />
        </FwField>
      </div>

      {clientName && (
        <div className="mt-6 rounded-lg border border-dashed border-border p-4 text-center">
          <p className="text-xs text-muted-foreground">
            This framework powers {clientName}'s GTM Content Engine. Complete all 18 sections to generate campaign-ready assets.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Attachments section ───────────────────────────────────────────────────────

interface Attachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  storageKey: string
  summaryStatus: 'pending' | 'processing' | 'ready' | 'failed'
  summary: string | null
  brandSummary?: string | null
  brandSummaryStatus?: string | null
  brandAttachmentId?: string | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith('audio/')) return '🎵'
  if (mimeType.startsWith('video/')) return '🎬'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('word') || mimeType.includes('docx')) return '📝'
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return '📊'
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑'
  return '📎'
}

// ── Attachment row with expand/collapse ───────────────────────────────────────

function renderSummaryMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let key = 0

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+?)\s+—\s+(High|Medium|Low) importance$/i)
    if (sectionMatch) {
      nodes.push(
        <div key={key++} className="mt-3 mb-1 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-foreground">{sectionMatch[1]}</span>
          <span className={cn(
            'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
            sectionMatch[2].toLowerCase() === 'high' && 'bg-blue-100 text-blue-700',
            sectionMatch[2].toLowerCase() === 'medium' && 'bg-amber-100 text-amber-700',
            sectionMatch[2].toLowerCase() === 'low' && 'bg-muted text-muted-foreground',
          )}>{sectionMatch[2]}</span>
        </div>
      )
    } else if (line.startsWith('- ')) {
      nodes.push(
        <div key={key++} className="flex gap-1.5 text-[11px] text-foreground/80 leading-relaxed">
          <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
          <span>{line.slice(2)}</span>
        </div>
      )
    } else if (line.trim()) {
      nodes.push(
        <p key={key++} className="text-[11px] text-muted-foreground">{line}</p>
      )
    }
  }
  return <div>{nodes}</div>
}

function AttachmentRow({ attachment: a, base, brandBase, deletingId, onDelete, onSummaryUpdated }: {
  attachment: Attachment
  base: string
  brandBase: string
  deletingId: string | null
  onDelete: (a: Attachment) => void
  onSummaryUpdated: (id: string, summary: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(a.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [editingBrand, setEditingBrand] = useState(false)
  const [brandEditValue, setBrandEditValue] = useState(a.brandSummary ?? '')
  const [savingBrand, setSavingBrand] = useState(false)
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
      if (res.ok) {
        onSummaryUpdated(a.id, editValue)
        setEditing(false)
      }
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const handleSaveBrand = async () => {
    if (!a.brandAttachmentId) return
    setSavingBrand(true)
    try {
      const res = await apiFetch(`${brandBase}/${a.brandAttachmentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary: brandEditValue }),
      })
      if (res.ok) setEditingBrand(false)
    } catch { /* ignore */ } finally {
      setSavingBrand(false)
    }
  }

  const handleViewText = async () => {
    if (rawText !== null) { setShowText(true); return }
    setLoadingText(true)
    try {
      const res = await apiFetch(`${base}/${a.id}/text`)
      if (res.ok) {
        const { data } = await res.json()
        setRawText(data.text ?? '')
      }
    } catch { /* ignore */ } finally {
      setLoadingText(false)
      setShowText(true)
    }
  }

  const statusBadge = () => {
    if (a.summaryStatus === 'processing' || a.summaryStatus === 'pending') {
      return (
        <span className="flex items-center gap-1 text-[10px] text-blue-500">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-blue-400 border-t-transparent" />
          Processing…
        </span>
      )
    }
    if (a.summaryStatus === 'ready') {
      return <span className="text-[10px] text-green-600 font-medium">✓ Interpreted</span>
    }
    if (a.summaryStatus === 'failed') {
      return <span className="text-[10px] text-red-500">Failed to process</span>
    }
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
        <span className="text-lg shrink-0">{fileIcon(a.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{a.filename}</p>
          <div className="flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground">
              {formatBytes(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}
            </p>
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
            : <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          }
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {(a.summaryStatus === 'pending' || a.summaryStatus === 'processing') && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              Claude is reading and interpreting this file…
            </div>
          )}
          {a.summaryStatus === 'failed' && (
            <p className="py-2 text-sm text-red-500">Could not extract readable content from this file.</p>
          )}
          {a.summaryStatus === 'ready' && (
            <div className="space-y-3">
              {/* GTM Framework Read */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">GTM Framework Read</p>
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
                        className="text-[10px] text-blue-500 underline hover:text-blue-700"
                      >Edit</button>
                    </div>
                  )}
                </div>
                {editing ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Edit Claude's Interpretation</p>
                    <textarea
                      className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      rows={14}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditing(false); setEditValue(a.summary ?? '') }}
                        className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md bg-muted/30 px-3 py-2">
                    {a.summary ? renderSummaryMarkdown(a.summary) : <p className="text-[11px] text-muted-foreground italic">No interpretation yet</p>}
                  </div>
                )}
              </div>

              {/* Brand Read */}
              {(a.brandSummary || a.brandSummaryStatus === 'pending' || a.brandSummaryStatus === 'processing' || a.brandSummaryStatus === 'ready') && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Brand Read</p>
                    {!editingBrand && a.brandSummaryStatus === 'ready' && a.brandAttachmentId && (
                      <button
                        onClick={() => { setBrandEditValue(a.brandSummary ?? ''); setEditingBrand(true) }}
                        className="text-[10px] text-blue-500 underline hover:text-blue-700"
                      >Edit</button>
                    )}
                  </div>
                  {(a.brandSummaryStatus === 'pending' || a.brandSummaryStatus === 'processing') ? (
                    <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                      <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                      Brand analyst is reading this file…
                    </div>
                  ) : editingBrand ? (
                    <div>
                      <textarea
                        className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                        rows={8}
                        value={brandEditValue}
                        onChange={(e) => setBrandEditValue(e.target.value)}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={handleSaveBrand} disabled={savingBrand} className="rounded bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50">
                          {savingBrand ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingBrand(false); setBrandEditValue(a.brandSummary ?? '') }} className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/30 px-3 py-2.5">
                      {a.brandSummary
                        ? <p className="text-[11px] leading-relaxed text-foreground/80">{a.brandSummary}</p>
                        : <p className="text-[11px] text-muted-foreground italic">No brand interpretation yet</p>
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Raw text modal */}
          {showText && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowText(false)}
            >
              <div
                className="flex flex-col w-full max-w-2xl max-h-[80vh] rounded-xl border border-border bg-white shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Sticky header */}
                <div
                  className="flex shrink-0 items-center justify-between rounded-t-xl px-5 py-4"
                  style={{ backgroundColor: '#a200ee' }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Original Extracted Text</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-white">{a.filename}</p>
                  </div>
                  <button
                    onClick={() => setShowText(false)}
                    className="ml-4 shrink-0 rounded p-1 text-white/70 hover:text-white"
                  >✕</button>
                </div>
                {/* Scrollable body */}
                <div className="overflow-auto p-6" style={{ backgroundColor: '#ffffff' }}>
                  {rawText ? (
                    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono" style={{ color: '#374151' }}>{rawText}</pre>
                  ) : (
                    <p className="text-sm italic" style={{ color: '#6b7280' }}>No extracted text available for this file.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AttachmentsSection({ clientId, verticalId, websiteStatus, onScrapeWebsite, onReadyChange }: {
  clientId: string
  verticalId: string | null
  websiteStatus: 'none' | 'pending' | 'running' | 'ready' | 'failed'
  onScrapeWebsite: (websiteUrl: string) => Promise<void>
  onReadyChange: (hasReady: boolean) => void
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingCount, setUploadingCount] = useState(0)
  const uploading = uploadingCount > 0
  const [dragging, setDragging] = useState(false)
  const [filenameIssues, setFilenameIssues] = useState<FilenameIssue[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Company (no vertical) → client brain; specific vertical → framework brain
  const base = verticalId
    ? `/api/v1/clients/${clientId}/framework/${verticalId}/attachments`
    : `/api/v1/clients/${clientId}/brand-profile/attachments`
  const brandBase = `/api/v1/clients/${clientId}/brand-profile/attachments`

  const fetchAttachments = useCallback(() => {
    return apiFetch(base).then((r) => r.json()).then(({ data }) => setAttachments(data ?? [])).catch(() => {})
  }, [base])

  useEffect(() => {
    setLoading(true)
    fetchAttachments().finally(() => setLoading(false))
  }, [fetchAttachments])

  // Poll while any attachment is still processing
  useEffect(() => {
    const hasInProgress = attachments.some(
      (a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing' ||
             a.brandSummaryStatus === 'pending' || a.brandSummaryStatus === 'processing'
    )
    if (!hasInProgress) return
    const t = setTimeout(() => { fetchAttachments() }, 4000)
    return () => clearTimeout(t)
  }, [attachments, fetchAttachments])

  // Notify parent when ready count changes
  useEffect(() => {
    onReadyChange(attachments.some((a) => a.summaryStatus === 'ready'))
  }, [attachments, onReadyChange])

  const uploadFile = async (file: File) => {
    setUploadingCount((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await apiFetch(base, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = (body as { error?: string }).error ?? 'Upload failed'
        setUploadError(msg)
        setTimeout(() => setUploadError(null), 8000)
        return
      }
      setUploadError(null)
      const { data } = await res.json()
      setAttachments((prev) => [data, ...prev])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error — upload failed'
      setUploadError(msg)
      setTimeout(() => setUploadError(null), 8000)
    } finally {
      setUploadingCount((n) => n - 1)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    const fileArr = Array.from(files)
    const issues = checkFilenames(fileArr)
    setFilenameIssues(issues)
    fileArr.forEach(uploadFile)
  }

  const handleDelete = async (a: Attachment) => {
    if (!confirm(`Delete "${a.filename}"?`)) return
    setDeletingId(a.id)
    try {
      await apiFetch(`${base}/${a.id}`, { method: 'DELETE' })
      setAttachments((prev) => prev.filter((x) => x.id !== a.id))
    } catch { /* ignore */ } finally {
      setDeletingId(null)
    }
  }

  const [websiteUrl, setWebsiteUrl] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  return (
    <div>
      <div className="mb-6">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-widest text-blue-500">Brain</div>
        <h2 className="text-xl font-bold text-foreground">Research & Supporting Files</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {verticalId
            ? 'Upload anything relevant to this vertical — meeting notes, capability decks, audio recordings, strategy docs. These will be used as research context when drafting framework sections.'
            : 'Upload company-wide research — positioning docs, sales decks, strategy notes. These feed into the client brain and inform all verticals.'
          }
        </p>
      </div>

      {/* Brain status */}
      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
        {(() => {
          const ready = attachments.filter((a) => a.summaryStatus === 'ready').length
          const processing = attachments.filter((a) => a.summaryStatus === 'pending' || a.summaryStatus === 'processing').length
          const failed = attachments.filter((a) => a.summaryStatus === 'failed').length
          if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>
          if (attachments.length === 0) {
            return (
              <div>
                <p className="text-sm font-semibold text-foreground">No files in brain yet</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Upload files below — each is automatically read and interpreted by Claude. Interpreted files permanently feed the ✦ Draft buttons.</p>
              </div>
            )
          }
          return (
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {ready > 0 ? `✓ ${ready} file${ready !== 1 ? 's' : ''} in brain` : 'Files processing…'}
                  {processing > 0 && ` · ${processing} processing`}
                  {failed > 0 && ` · ${failed} failed`}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ready > 0
                    ? 'Hover any field in the framework to see the ✦ Draft button. Editing a file\'s interpretation updates the brain immediately.'
                    : 'Files are being read and interpreted — draft buttons will activate when ready.'
                  }
                </p>
              </div>
              {ready > 0 && (
                <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Brain active</span>
              )}
            </div>
          )
        })()}
      </div>

      {/* Website scraping — only for vertical-specific brain */}
      {verticalId && <div className="mb-6 rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Website context <span className="text-[10px] font-normal text-muted-foreground ml-1">optional</span></p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {websiteStatus === 'none' && 'Scrape the client\'s website to add it to the brain.'}
              {(websiteStatus === 'pending' || websiteStatus === 'running') && 'Scraping website…'}
              {websiteStatus === 'ready' && '✓ Website scraped and in brain. Re-scrape anytime to refresh.'}
              {websiteStatus === 'failed' && 'Scrape failed — check the URL and try again.'}
            </p>
          </div>
          {(websiteStatus === 'running' || websiteStatus === 'pending') && (
            <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="https://clientwebsite.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
          <button
            disabled={!websiteUrl.trim() || websiteStatus === 'running' || websiteStatus === 'pending'}
            onClick={() => onScrapeWebsite(websiteUrl.trim())}
            className="shrink-0 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {websiteStatus === 'ready' ? 'Re-scrape' : 'Scrape Website'}
          </button>
        </div>
      </div>}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mb-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 transition-colors',
          dragging ? 'border-blue-400 bg-blue-50/20' : 'border-border hover:border-blue-300 hover:bg-muted/20',
        )}
      >
        <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.mp4,.mov,.mp3,.m4a,.wav,.webm" onChange={(e) => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            Uploading{uploadingCount > 1 ? ` ${uploadingCount} files` : ''}…
          </div>
        ) : (
          <>
            <div className="text-2xl">📎</div>
            <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
            <p className="text-[11px] text-muted-foreground">Notes, PDFs, Word docs, audio recordings, slide decks — any format</p>
          </>
        )}
      </div>

      {filenameIssues.length > 0 && (
        <FilenameWarning issues={filenameIssues} />
      )}

      {uploadError && (
        <div className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <span>⚠</span> {uploadError}
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
        </div>
      ) : attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">No files yet</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">Uploaded files will appear here and feed into AI research when drafting sections</p>
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              base={base}
              brandBase={brandBase}
              deletingId={deletingId}
              onDelete={handleDelete}
              onSummaryUpdated={(id, summary) =>
                setAttachments((prev) => prev.map((x) => x.id === id ? { ...x, summary } : x))
              }
            />
          ))}
        </div>
      )}

      {/* Scheduled research results for this vertical */}
      {verticalId && <ScheduledResearchSection clientId={clientId} verticalId={verticalId} />}
    </div>
  )
}

interface ScheduledEntry {
  id: string
  filename: string
  summary: string | null
  summaryStatus: string
  extractedText: string | null
  createdAt: string
}

function ScheduledResearchSection({ clientId, verticalId }: { clientId: string; verticalId: string }) {
  const [entries, setEntries] = useState<ScheduledEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/brain/scheduled?verticalId=${verticalId}`)
      .then((r) => r.json())
      .then(({ data }) => setEntries(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [clientId, verticalId])

  if (loading || entries.length === 0) return null

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Research Intelligence</p>
        <span className="rounded-full bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-purple-600">Scheduled</span>
      </div>
      <div className="space-y-2">
        {entries.map((e) => {
          const isOpen = expanded.has(e.id)
          const label = e.filename.replace(/^\[Scheduled\]\s*/, '')
          return (
            <div key={e.id} className="rounded-lg border border-border bg-card overflow-hidden">
              <div
                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/20 transition-colors"
                onClick={() => setExpanded((prev) => { const s = new Set(prev); s.has(e.id) ? s.delete(e.id) : s.add(e.id); return s })}
              >
                <span className="text-[11px] text-muted-foreground shrink-0 w-3">{isOpen ? '▼' : '▶'}</span>
                <span className="text-lg shrink-0">🔬</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</p>
                </div>
                <span className="shrink-0 text-[10px] text-green-600 font-medium">✓ Ready</span>
              </div>
              {isOpen && e.extractedText && (
                <div className="border-t border-border px-4 pb-4 pt-3">
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80" style={{ fontFamily: 'inherit' }}>
                    {e.extractedText}
                  </pre>
                  <button
                    onClick={() => navigator.clipboard.writeText(e.extractedText ?? '')}
                    className="mt-3 flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Vertical selector ─────────────────────────────────────────────────────────

interface Vertical extends DimensionItem { id: string; name: string; dimensionType: string }

function VerticalSelector({ verticals, selected, onSelect, onSelectCompany }: {
  verticals: Vertical[]
  selected: Vertical | null
  onSelect: (v: Vertical) => void
  onSelectCompany: () => void
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
        <span className="font-medium truncate">{selected ? selected.name : 'Company'}</span>
        <svg className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover shadow-xl" style={{ backgroundColor: 'hsl(var(--popover))' }}>
          <div className="max-h-48 overflow-y-auto p-1">
            {/* Company — always first */}
            <button
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
              onClick={() => { onSelectCompany(); setOpen(false) }}
            >
              {!selected && <span className="text-blue-500">✓</span>}
              <span className="truncate">Company</span>
            </button>
            {[...verticals].sort((a, b) => a.name.localeCompare(b.name)).map((v) => (
              <button
                key={v.id}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
                onClick={() => { onSelect(v); setOpen(false) }}
              >
                {selected?.id === v.id && <span className="text-blue-500">✓</span>}
                <span className="truncate">{v.name}</span>
              </button>
            ))}
            {verticals.length === 0 && (
              <p className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                No verticals assigned — go to Structure tab to add
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AttachedTemplate {
  id: string
  name: string
  assignmentId: string
}

export function ClientFrameworkTab({ clientId, clientName, initialVerticalId }: { clientId: string; clientName: string; initialVerticalId?: string }) {
  const { canManageTemplates } = useCurrentUser()
  const verticalTerm = useVerticalTerm()
  const [verticals, setVerticals] = useState<Vertical[]>([])
  const [selectedDimensions, setSelectedDimensions] = useState<Record<string, string>>({})
  const selectedVertical = verticals.find((v) => Object.values(selectedDimensions).includes(v.id)) ?? null
  const setSelectedVertical = (v: Vertical | null) => setSelectedDimensions(v ? { [v.dimensionType]: v.id } : {})
  const [fw, setFwRaw] = useState<FrameworkData | null>(null)
  const [activeSection, setActiveSection] = useState<string>('brain')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [verticalsLoading, setVerticalsLoading] = useState(true)
  const [downloadingDocx, setDownloadingDocx] = useState(false)
  const [docStyle, setDocStyle] = useState<DocStyleConfig>(DEFAULT_DOC_STYLE)
  const [attachedTemplate, setAttachedTemplate] = useState<AttachedTemplate | null>(null)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  const [reimporting, setReimporting] = useState(false)
  const [reimportResult, setReimportResult] = useState<ReimportResult | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestFwRef = useRef<FrameworkData | null>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const templateInputRef = useRef<HTMLInputElement>(null)
  const reimportInputRef = useRef<HTMLInputElement>(null)

  // Research + draft state
  const [websiteStatus, setWebsiteStatus] = useState<'none' | 'pending' | 'running' | 'ready' | 'failed'>('none')
  const [hasReadyAttachment, setHasReadyAttachment] = useState(false)
  const [draftingField, setDraftingField] = useState<string | null>(null)
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, string>>({})
  const websitePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load verticals assigned to this client
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/verticals`)
      .then((r) => r.json())
      .then(({ data }) => {
        const list: Vertical[] = [...(data ?? [])].sort((a: Vertical, b: Vertical) => a.name.localeCompare(b.name))
        setVerticals(list)
        if (initialVerticalId) {
          const match = list.find((v) => v.id === initialVerticalId)
          if (match) setSelectedVertical(match)
        }
      })
      .catch(() => {})
      .finally(() => setVerticalsLoading(false))
  }, [clientId, initialVerticalId])

  // Pre-fetch doc style so download is instant
  useEffect(() => {
    apiFetch(`/api/v1/clients/${clientId}/doc-style/merged`)
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json?.data) setDocStyle({ ...DEFAULT_DOC_STYLE, ...json.data }) })
      .catch(() => {})
  }, [clientId])

  // Load attached template when vertical changes
  useEffect(() => {
    if (!selectedVertical) { setAttachedTemplate(null); return }
    setAttachedTemplate(null)
    apiFetch(`/api/v1/doc-templates/resolve?docType=gtm&clientId=${clientId}&verticalId=${selectedVertical.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        const t = json?.data
        if (t?.id) setAttachedTemplate({ id: t.id, name: t.name, assignmentId: t.assignmentId })
      })
      .catch(() => {})
  }, [clientId, selectedVertical])

  // Load framework when vertical selected
  useEffect(() => {
    if (!selectedVertical) { setFwRaw(null); return }
    setFwRaw(null)
    apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}`)
      .then((r) => r.json())
      .then(({ data }) => {
        const base = defaultFramework()
        if (data && typeof data === 'object') {
          const merged = { ...base, ...(data as Partial<FrameworkData>) }
          setFwRaw(merged)
          latestFwRef.current = merged
        } else {
          setFwRaw(base)
          latestFwRef.current = base
        }
      })
      .catch(() => {
        const base = defaultFramework()
        setFwRaw(base)
        latestFwRef.current = base
      })
  }, [clientId, selectedVertical])

  // Load website scrape status when vertical changes, and poll while running
  useEffect(() => {
    if (!selectedVertical) { setWebsiteStatus('none'); return }
    const endpoint = `/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`

    const fetchStatus = () => {
      apiFetch(endpoint).then((r) => r.json()).then(({ data }) => {
        const s = data?.status ?? 'none'
        setWebsiteStatus(s as typeof websiteStatus)
        if (s !== 'running' && s !== 'pending') {
          if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null }
        }
      }).catch(() => {})
    }

    fetchStatus()
    return () => { if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null } }
  }, [clientId, selectedVertical])

  // Scroll content area to top whenever section changes
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeSection])

  const startWebsitePolling = useCallback(() => {
    if (websitePollRef.current) clearInterval(websitePollRef.current)
    websitePollRef.current = setInterval(() => {
      if (!selectedVertical) return
      apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`)
        .then((r) => r.json()).then(({ data }) => {
          const s = data?.status ?? 'none'
          setWebsiteStatus(s as typeof websiteStatus)
          if (s !== 'running' && s !== 'pending') {
            if (websitePollRef.current) { clearInterval(websitePollRef.current); websitePollRef.current = null }
          }
        }).catch(() => {})
    }, 4000)
  }, [clientId, selectedVertical])

  const scrapeWebsite = useCallback(async (websiteUrl: string) => {
    if (!selectedVertical || !websiteUrl) return
    setWebsiteStatus('pending')
    await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl }),
    })
    startWebsitePolling()
  }, [clientId, selectedVertical, startWebsitePolling])

  const handleReadyChange = useCallback((hasReady: boolean) => {
    setHasReadyAttachment(hasReady)
  }, [])

  const handleTemplateUpload = useCallback(async (file: File) => {
    if (!selectedVertical) return
    if (!file.name.toLowerCase().endsWith('.docx')) { alert('Only .docx files are supported'); return }
    setUploadingTemplate(true)
    try {
      // 1. Upload and analyse
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', file.name.replace(/\.docx$/i, ''))
      fd.append('docType', 'gtm')
      const uploadRes = await apiFetch('/api/v1/doc-templates', { method: 'POST', body: fd })
      if (!uploadRes.ok) { const b = await uploadRes.json().catch(() => ({})); alert('Upload failed: ' + ((b as any).error ?? uploadRes.status)); return }
      const { data: tmpl } = await uploadRes.json()

      // 2. Auto-confirm AI suggestions so template is immediately usable
      if (tmpl.suggestions?.length) {
        await apiFetch(`/api/v1/doc-templates/${tmpl.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ confirmedVars: tmpl.suggestions }),
        })
      }

      // 3. Process (bake {{vars}} into docx XML) — only if there are confirmed vars
      if (tmpl.suggestions?.length) {
        await apiFetch(`/api/v1/doc-templates/${tmpl.id}/process`, { method: 'POST' })
      }

      // 4. Assign to this vertical + client scope
      const assignRes = await apiFetch(`/api/v1/doc-templates/${tmpl.id}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ clientId, verticalId: selectedVertical.id, docType: 'gtm' }),
      })
      if (!assignRes.ok) { alert('Template uploaded but could not be assigned.'); return }
      const { data: assignment } = await assignRes.json()

      setAttachedTemplate({ id: tmpl.id, name: tmpl.name, assignmentId: assignment.id })
    } catch (err) {
      alert('Failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setUploadingTemplate(false)
      if (templateInputRef.current) templateInputRef.current.value = ''
    }
  }, [selectedVertical, clientId])

  const removeTemplate = useCallback(async () => {
    if (!attachedTemplate) return
    await apiFetch(`/api/v1/doc-templates/assignments/${attachedTemplate.assignmentId}`, { method: 'DELETE' })
    setAttachedTemplate(null)
  }, [attachedTemplate])

  const handleDownload = useCallback(async () => {
    if (!fw || !selectedVertical) return
    setDownloadingDocx(true)
    try {
      if (attachedTemplate) {
        const variables = buildGtmVariableValues(fw, clientName, selectedVertical.name)
        const res = await apiFetch(`/api/v1/doc-templates/${attachedTemplate.id}/fill`, {
          method: 'POST',
          body: JSON.stringify({
            variables,
            filename: `${clientName} GTM Framework - ${selectedVertical.name}.docx`,
          }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string; detail?: string; hint?: string }
          const msg = [errBody.error, errBody.detail, errBody.hint].filter(Boolean).join('\n\n')
          alert(msg || 'Download failed')
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${clientName} GTM Framework - ${selectedVertical.name}.docx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        // Fire-and-forget: snapshot this export as a revision for the review lifecycle
        apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/revisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionType: 'internal' }),
        }).catch(() => {/* non-fatal */})
      } else {
        await downloadGTMFrameworkDocx(fw, clientName, selectedVertical.name, docStyle)
        // Fire-and-forget: snapshot this export as a revision for the review lifecycle
        apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/revisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revisionType: 'internal' }),
        }).catch(() => {/* non-fatal */})
      }
    } catch (err) {
      console.error('[GTM Download] failed:', err)
      alert('Download failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setDownloadingDocx(false)
    }
  }, [fw, selectedVertical, attachedTemplate, clientName, docStyle, clientId])

  const handleReimport = useCallback(async (file: File) => {
    if (!selectedVertical || !fw) return
    if (!file.name.toLowerCase().endsWith('.docx')) { alert('Only .docx files are supported'); return }
    setReimporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/reimport`, { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) { alert((body as { error?: string }).error ?? 'Re-import failed'); return }
      const result = (body as { data: ReimportResult }).data
      if (result.totalUpdated === 0 && result.styleSignals.length === 0) {
        alert('No changes detected — the document matches the current framework data.')
        return
      }
      setReimportResult(result)
    } catch (err) {
      alert('Network error: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setReimporting(false)
      if (reimportInputRef.current) reimportInputRef.current.value = ''
    }
  }, [clientId, selectedVertical, fw, reimportInputRef])

  const applyReimport = useCallback(async () => {
    if (!reimportResult || !selectedVertical || !fw) return
    const mergedData: Record<string, unknown> = { ...(fw as Record<string, unknown>) }
    for (const f of reimportResult.updatedFields) {
      mergedData[f.id] = f.newValue
    }
    if (reimportResult.styleSignals.length > 0) {
      mergedData['_style_signals'] = reimportResult.styleSignals
    }
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedData),
      })
      if (res.ok) {
        const { data } = await res.json()
        setFwRaw(data)
        setReimportResult(null)
      } else {
        alert('Failed to apply changes')
      }
    } catch {
      alert('Network error applying changes')
    }
  }, [reimportResult, selectedVertical, fw, clientId])

  const requestDraft = useCallback(async (fieldId: string, sectionNum: string, sectionTitle: string, fieldLabel: string, current: string) => {
    if (!selectedVertical || draftingField) return
    setDraftingField(fieldId)
    try {
      const res = await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionNum, sectionTitle, fieldKey: fieldId, fieldLabel, currentValue: current }),
      })
      if (!res.ok) return
      const { data } = await res.json()
      if (data?.draft) setPendingDrafts((prev) => ({ ...prev, [fieldId]: data.draft }))
    } catch { /* ignore */ } finally {
      setDraftingField(null)
    }
  }, [clientId, selectedVertical, draftingField])

  const acceptDraft = useCallback((fieldId: string, setValue: (v: string) => void) => {
    const draft = pendingDrafts[fieldId]
    if (draft) { setValue(draft); setPendingDrafts((prev) => { const n = { ...prev }; delete n[fieldId]; return n }) }
  }, [pendingDrafts])

  const discardDraft = useCallback((fieldId: string) => {
    setPendingDrafts((prev) => { const n = { ...prev }; delete n[fieldId]; return n })
  }, [])

  const getDraft = useCallback((fieldId: string): string | null => pendingDrafts[fieldId] ?? null, [pendingDrafts])

  // Save (debounced)
  const scheduleSave = useCallback((data: FrameworkData) => {
    if (!selectedVertical) return
    latestFwRef.current = data
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/v1/clients/${clientId}/framework/${selectedVertical.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(latestFwRef.current),
        })
        if (!res.ok) throw new Error('Save failed')
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('error')
      }
    }, 1500)
  }, [clientId, selectedVertical])

  // Immutable update helper
  const set = useCallback((fn: (d: FrameworkData) => void) => {
    setFwRaw((prev) => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev)) as FrameworkData
      fn(next)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const handleOwnerChange = (num: string, val: string) => set((d) => {
    if (!d.sectionOwners) d.sectionOwners = {}
    d.sectionOwners[num] = val
  })
  const handleNoteChange = (num: string, val: string) => set((d) => {
    if (!d.sectionNotes) d.sectionNotes = {}
    d.sectionNotes[num] = val
  })

  function renderSection() {
    if (activeSection === 'brain' && selectedVertical) {
      return null // rendered directly in JSX with props
    }
    if (!fw) return null
    const props = { fw, set, clientName }
    switch (activeSection) {
      case '00': return <ProgressSection fw={fw} onNavigate={setActiveSection} onOwnerChange={handleOwnerChange} onNoteChange={handleNoteChange} clientName={clientName} />
      case '01': return <S01 {...props} />
      case '02': return <S02 {...props} />
      case '03': return <S03 {...props} />
      case '04': return <S04 {...props} />
      case '05': return <S05 {...props} />
      case '06': return <S06 {...props} />
      case '07': return <S07 {...props} />
      case '08': return <S08 {...props} />
      case '09': return <S09 {...props} />
      case '10': return <S10 {...props} />
      case '11': return <S11 {...props} />
      case '12': return <S12 {...props} />
      case '13': return <S13 {...props} />
      case '14': return <S14 {...props} />
      case '15': return <S15 {...props} />
      case '16': return <S16 {...props} />
      case '17': return <S17 {...props} />
      case '18': return <S18 {...props} />
      default: return null
    }
  }

  const draftContextValue: DraftContextValue = {
    researchReady: hasReadyAttachment || websiteStatus === 'ready',
    requestDraft,
    draftingField,
    acceptDraft,
    discardDraft,
    getDraft,
  }

  // ── gtmPILOT: compute filled/empty sections ───────────────────────────────
  function hasData(obj: unknown, key = ''): boolean {
    if (key === 'id' || key === '_open') return false
    if (typeof obj === 'string') return obj.trim().length > 0
    if (Array.isArray(obj)) return obj.some((item) => hasData(item))
    if (typeof obj === 'object' && obj !== null)
      return Object.entries(obj as Record<string, unknown>).some(([k, v]) => hasData(v, k))
    return false
  }

  const SECTION_KEYS = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18']
  const filledSections = fw
    ? SECTION_KEYS.filter((k) => hasData((fw as Record<string, unknown>)[`s${k}`]))
    : []
  const emptySections = SECTION_KEYS.filter((k) => !filledSections.includes(k))

  return (
    <DraftContext.Provider value={draftContextValue}>
    <div className="flex h-full flex-col" style={{ minHeight: 0 }}>

      {/* Dimension selector bar */}
      <DimensionBar
        items={verticals}
        selected={selectedDimensions}
        onChange={(type, id) => { setSelectedDimensions(id ? { [type]: id } : {}); setActiveSection('brain') }}
        loading={verticalsLoading}
        verticalTerm={verticalTerm}
      >
        {selectedVertical && (
          <>
            {saveStatus !== 'idle' && (
              <span className="text-[10px] text-muted-foreground">
                {saveStatus === 'saving' && 'Saving…'}
                {saveStatus === 'saved'  && <span className="text-green-600">Saved</span>}
                {saveStatus === 'error'  && <span className="text-red-500">Save failed</span>}
              </span>
            )}
            {/* Hidden file input */}
            <input
              ref={templateInputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleTemplateUpload(f) }}
            />

            {/* Hidden file input for reimport */}
            <input
              ref={reimportInputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReimport(f) }}
            />

            {/* Attached template pill */}
            {attachedTemplate && (
              <div
                className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px]"
                style={{ maxWidth: 180 }}
                title={attachedTemplate.name}
              >
                <svg className="h-3 w-3 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate text-muted-foreground">{attachedTemplate.name}</span>
                {canManageTemplates && (
                  <button
                    onClick={removeTemplate}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-red-500"
                    title="Remove template"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Upload template button — managers and above only */}
            {canManageTemplates && (
              <button
                onClick={() => !uploadingTemplate && templateInputRef.current?.click()}
                disabled={uploadingTemplate}
                className={cn(
                  'flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-xs transition-colors',
                  uploadingTemplate ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/40',
                )}
              >
                {uploadingTemplate ? (
                  <svg className="h-3 w-3 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                )}
                <span>{uploadingTemplate ? 'Uploading…' : 'Upload .docx template'}</span>
              </button>
            )}

            {/* Download button */}
            {fw && (
              <button
                onClick={handleDownload}
                disabled={downloadingDocx}
                className={cn(
                  'flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-xs transition-colors',
                  downloadingDocx ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/40',
                )}
                title={attachedTemplate ? 'Download using attached template' : 'Download as plain docx'}
              >
                {downloadingDocx ? (
                  <svg className="h-3 w-3 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                <span>{downloadingDocx ? 'Generating…' : 'Download .docx'}</span>
              </button>
            )}

            {/* Re-import button */}
            {fw && (
              <button
                onClick={() => !reimporting && reimportInputRef.current?.click()}
                disabled={reimporting}
                className={cn(
                  'flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-xs transition-colors',
                  reimporting ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/40',
                )}
                title="Re-import an edited .docx to sync changes back into the framework"
              >
                {reimporting ? (
                  <svg className="h-3 w-3 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="h-3 w-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                )}
                <span>{reimporting ? 'Analysing…' : 'Re-import edited .docx'}</span>
              </button>
            )}
          </>
        )}
      </DimensionBar>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">

      {/* Left nav */}
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border bg-card">
        <div className="px-3 py-3">
          {/* Brain nav item */}
          <button
            onClick={() => setActiveSection('brain')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
              activeSection === 'brain'
                ? 'bg-blue-50 text-blue-600 font-semibold'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            <span>🧠</span>
            <span>Brain</span>
          </button>

          <div className="my-2 border-t border-border/50" />
          <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">18 Sections</div>

          {/* Progress nav item */}
          <button
            onClick={() => setActiveSection('00')}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
              activeSection === '00'
                ? 'bg-blue-50 text-blue-600 font-semibold'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            <span className="text-blue-500">✦</span>
            <span>Progress</span>
          </button>

          {/* Section nav items */}
          {SECTIONS.map((sec) => {
            const status = fw ? getSectionStatus(fw, sec.num) : 'not-started'
            return (
              <button
                key={sec.num}
                onClick={() => setActiveSection(sec.num)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                  activeSection === sec.num
                    ? 'bg-blue-50 text-blue-600 font-semibold'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">{sec.num}</span>
                <StatusDot status={status} />
                <span className="truncate">{sec.short.replace('[Client]', clientName)}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto px-8 py-6">
        {activeSection === 'brain' ? (
          <div className="mx-auto max-w-4xl">
            <AttachmentsSection
              clientId={clientId}
              verticalId={selectedVertical?.id ?? null}
              websiteStatus={websiteStatus}
              onScrapeWebsite={scrapeWebsite}
              onReadyChange={handleReadyChange}
            />
          </div>
        ) : !selectedVertical ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="text-2xl">📋</div>
            <p className="text-sm font-medium text-foreground">Select a vertical above to fill in its GTM Framework</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Each vertical gets its own 18-section GTM Framework — e.g. Healthcare, Financial Services, Manufacturing.
            </p>
          </div>
        ) : !fw ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div className="mx-auto max-w-4xl">
            {renderSection()}
          </div>
        )}
      </div>

      </div>{/* /Body */}

      {/* gtmPILOT — always visible; handles no-vertical state internally */}
      <GTMPilot
        clientId={clientId}
        verticalId={selectedVertical?.id ?? null}
        verticalName={selectedVertical?.name ?? null}
        filledSections={filledSections}
        emptySections={emptySections}
        onNavigateToSection={(num) => setActiveSection(num)}
      />

      {/* Re-import preview modal */}
      {reimportResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="flex flex-col w-full max-w-2xl rounded-2xl border border-border bg-white shadow-2xl overflow-hidden" style={{ maxHeight: '80vh' }}>
            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <svg className="h-5 w-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">Re-import preview</h3>
                <p className="text-xs text-muted-foreground">
                  {reimportResult.totalUpdated} field{reimportResult.totalUpdated !== 1 ? 's' : ''} changed
                  {reimportResult.styleSignals.length > 0 ? ` · ${reimportResult.styleSignals.length} style signal${reimportResult.styleSignals.length !== 1 ? 's' : ''} detected` : ''}
                </p>
              </div>
              <button onClick={() => setReimportResult(null)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
              {reimportResult.updatedFields.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Changed Fields</p>
                  <div className="space-y-2">
                    {reimportResult.updatedFields.map((f) => (
                      <div key={f.id} className="rounded-xl border border-border bg-zinc-50 p-3 space-y-1.5">
                        <p className="text-[11px] font-semibold text-foreground">{f.label}</p>
                        {f.oldValue && (
                          <p className="text-[11px] text-red-600 line-through leading-relaxed">{f.oldValue.slice(0, 200)}{f.oldValue.length > 200 ? '…' : ''}</p>
                        )}
                        <p className="text-[11px] text-green-700 leading-relaxed">{f.newValue.slice(0, 200)}{f.newValue.length > 200 ? '…' : ''}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reimportResult.styleSignals.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Style Signals Detected</p>
                  <p className="text-[11px] text-muted-foreground mb-2">These will be saved to the framework and used to guide future AI generation for this client.</p>
                  <div className="space-y-1.5">
                    {reimportResult.styleSignals.map((s, i) => (
                      <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-white px-3 py-2">
                        <span className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                          s.confidence === 'high' ? 'bg-blue-100 text-blue-700' :
                          s.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                          'bg-zinc-100 text-zinc-500'
                        )}>{s.confidence}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-foreground">{s.rule}</p>
                          <p className="text-[10px] text-muted-foreground">Example: &ldquo;{s.example}&rdquo;</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setReimportResult(null)}
                className="rounded-lg px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void applyReimport()}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Apply changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </DraftContext.Provider>
  )
}
