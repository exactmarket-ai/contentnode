/**
 * ProductMarketingTab.tsx
 *
 * productPILOT — skill browser + launcher for the Product Marketing tab on ClientDetailPage.
 * 7 skill categories, each with a grid of skill cards.
 * Clicking a skill opens the ProductPilot chat modal.
 */

import { useState } from 'react'
import * as Icons from 'lucide-react'
import { ProductPilot } from '@/components/pilot/ProductPilot'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Skill {
  key: string
  name: string
  description: string
}

interface SkillCategory {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  skills: Skill[]
}

// ─── Skill catalog (mirrors API skills/productMarketing.ts) ───────────────────

const CATEGORIES: SkillCategory[] = [
  {
    key: 'pm-product-strategy',
    label: 'Product Strategy',
    icon: Icons.Layers,
    skills: [
      { key: 'product-vision',       name: 'Product Vision',         description: 'Craft an inspiring, achievable vision statement.' },
      { key: 'product-strategy',     name: 'Product Strategy',       description: '9-section canvas: vision, segments, trade-offs, growth.' },
      { key: 'value-proposition',    name: 'Value Proposition',      description: 'JTBD 6-part template: Who, Why, Before, How, After, Alternatives.' },
      { key: 'swot-analysis',        name: 'SWOT Analysis',          description: 'Strengths, weaknesses, opportunities, threats + cross-referenced actions.' },
      { key: 'business-model',       name: 'Business Model Canvas',  description: 'All 9 building blocks: partners, activities, resources, channels, revenue.' },
      { key: 'lean-canvas',          name: 'Lean Canvas',            description: 'Startup hypothesis testing across 9 sections.' },
      { key: 'pricing-strategy',     name: 'Pricing Strategy',       description: '7 pricing models evaluated for fit, unit economics, and positioning.' },
      { key: 'monetization-strategy',name: 'Monetization Strategy',  description: 'Brainstorm 3–5 models with audience fit and validation experiments.' },
      { key: 'ansoff-matrix',        name: 'Ansoff Matrix',          description: 'Map growth: penetration, market dev, product dev, diversification.' },
      { key: 'pestle-analysis',      name: 'PESTLE Analysis',        description: 'Political, economic, social, tech, legal, environmental factors.' },
      { key: 'porters-five-forces',  name: "Porter's Five Forces",   description: 'Competitive dynamics: rivalry, suppliers, buyers, substitutes, entrants.' },
      { key: 'startup-canvas',       name: 'Startup Canvas',         description: 'Product strategy + business model for a new venture.' },
    ],
  },
  {
    key: 'pm-product-discovery',
    label: 'Product Discovery',
    icon: Icons.Search,
    skills: [
      { key: 'opportunity-solution-tree', name: 'Opportunity Solution Tree', description: 'Outcome → opportunities → solutions → experiments (Teresa Torres).' },
      { key: 'interview-script',          name: 'Customer Interview Script', description: 'The Mom Test interview scripts with JTBD probing questions.' },
      { key: 'user-stories',              name: 'User Stories',             description: 'INVEST-compliant stories with acceptance criteria and edge cases.' },
      { key: 'brainstorm-ideas-existing', name: 'Brainstorm Ideas',         description: 'PM, Designer, Engineer perspectives — top 5 ideas prioritized.' },
      { key: 'identify-assumptions-existing', name: 'Identify Assumptions', description: 'Value, Usability, Viability, Feasibility risk analysis.' },
      { key: 'prioritize-features',       name: 'Prioritize Features',      description: 'Rank backlog by impact, effort, risk, and strategic alignment.' },
      { key: 'metrics-dashboard',         name: 'Metrics Dashboard',        description: 'North Star, input metrics, health metrics, alerts, cadence.' },
      { key: 'summarize-interview',       name: 'Summarize Interview',      description: 'JTBD-structured summary from interview transcripts.' },
      { key: 'analyze-feature-requests',  name: 'Analyze Feature Requests', description: 'Cluster and prioritize requests by underlying JTBD.' },
      { key: 'prioritize-assumptions',    name: 'Prioritize Assumptions',   description: 'Impact × Risk matrix with experiment suggestions.' },
    ],
  },
  {
    key: 'pm-market-research',
    label: 'Market Research',
    icon: Icons.BarChart2,
    skills: [
      { key: 'user-personas',         name: 'User Personas',         description: 'Research-backed personas with JTBD, goals, fears, and buying behavior.' },
      { key: 'competitor-analysis',   name: 'Competitor Analysis',   description: 'Positioning, strengths, weaknesses, pricing, and strategic movements.' },
      { key: 'market-sizing',         name: 'Market Sizing',         description: 'TAM, SAM, SOM with top-down and bottom-up approaches.' },
      { key: 'market-segments',       name: 'Market Segments',       description: 'Identify and prioritize segments by fit, size, and strategic value.' },
      { key: 'customer-journey-map',  name: 'Customer Journey Map',  description: 'Full journey from awareness to advocacy with gaps and emotions.' },
      { key: 'user-segmentation',     name: 'User Segmentation',     description: 'Segment users by behavior, value, and activation status.' },
      { key: 'sentiment-analysis',    name: 'Sentiment Analysis',    description: 'Theme clusters from reviews, support tickets, and interviews.' },
    ],
  },
  {
    key: 'pm-go-to-market',
    label: 'Go-to-Market',
    icon: Icons.Rocket,
    skills: [
      { key: 'ideal-customer-profile', name: 'Ideal Customer Profile', description: 'ICP with firmographic, behavioral, JTBD, and disqualification criteria.' },
      { key: 'beachhead-segment',      name: 'Beachhead Segment',      description: 'Find the first market to dominate before expanding.' },
      { key: 'gtm-strategy',           name: 'GTM Strategy',           description: 'Channels, messaging, metrics, timeline, and 90-day execution plan.' },
      { key: 'gtm-motions',            name: 'GTM Motions',            description: 'Inbound, outbound, PLG, ABM, partner, community, paid — evaluated.' },
      { key: 'competitive-battlecard', name: 'Competitive Battlecard', description: 'Win/loss patterns, objections, responses, and landmines.' },
      { key: 'growth-loops',           name: 'Growth Loops',           description: 'Viral, usage, collaboration, UGC, referral flywheels designed.' },
    ],
  },
  {
    key: 'pm-marketing-growth',
    label: 'Marketing & Growth',
    icon: Icons.TrendingUp,
    skills: [
      { key: 'north-star-metric',    name: 'North Star Metric',    description: 'The one metric that captures value delivery and leads to revenue.' },
      { key: 'positioning-ideas',    name: 'Positioning Ideas',    description: 'Generate and evaluate positioning territories.' },
      { key: 'value-prop-statements',name: 'Value Prop Statements', description: 'Headlines, elevator pitches, and audience-specific variants.' },
      { key: 'marketing-ideas',      name: 'Marketing Ideas',      description: 'Creative ideas by channel, budget, and growth stage.' },
      { key: 'product-name',         name: 'Product Name',         description: 'Generate and evaluate names for memorability and positioning fit.' },
    ],
  },
  {
    key: 'pm-execution',
    label: 'Execution',
    icon: Icons.ClipboardList,
    skills: [
      { key: 'create-prd',               name: 'Product Requirements Doc', description: 'Problem, solution, requirements, metrics, and out-of-scope.' },
      { key: 'brainstorm-okrs',          name: 'Brainstorm OKRs',          description: 'Outcome-oriented objectives and key results.' },
      { key: 'outcome-roadmap',          name: 'Outcome Roadmap',          description: 'Now/Next/Later organized around outcomes, not features.' },
      { key: 'sprint-plan',              name: 'Sprint Plan',              description: 'Goal, stories, capacity, dependencies, and definition of done.' },
      { key: 'pre-mortem',               name: 'Pre-Mortem',               description: 'Imagine failure — identify risks and prevention strategies.' },
      { key: 'retro',                    name: 'Sprint Retrospective',     description: 'What went well, what to improve, concrete next actions.' },
      { key: 'stakeholder-map',          name: 'Stakeholder Map',          description: 'Influence, interest, support level, and engagement strategy.' },
      { key: 'release-notes',            name: 'Release Notes',            description: 'Customer-facing notes that communicate value, not features.' },
      { key: 'job-stories',              name: 'Job Stories',              description: '"When / I want to / So I can" — context and motivation.' },
      { key: 'test-scenarios',           name: 'Test Scenarios',           description: 'Happy path, edge cases, errors, permissions, performance.' },
      { key: 'summarize-meeting',        name: 'Summarize Meeting',        description: 'Decisions, action items, and context — not discussions.' },
      { key: 'dummy-dataset',            name: 'Dummy Dataset',            description: 'Realistic synthetic data for testing and demos.' },
      { key: 'prioritization-frameworks',name: 'Prioritization Frameworks',description: 'ICE, RICE, Kano, MoSCoW, Opportunity Scoring compared.' },
    ],
  },
  {
    key: 'pm-data-analytics',
    label: 'Data & Analytics',
    icon: Icons.LineChart,
    skills: [
      { key: 'ab-test-analysis', name: 'A/B Test Analysis',   description: 'Statistical significance, guardrail metrics, ship/extend/stop.' },
      { key: 'cohort-analysis',  name: 'Cohort Analysis',     description: 'Retention and engagement patterns by cohort.' },
      { key: 'sql-queries',      name: 'SQL Query Builder',   description: 'Optimized queries for product analytics across all major platforms.' },
    ],
  },
]

// Quick Tools (no pilot session — just direct AI assistance)
const QUICK_TOOLS: Skill[] = [
  { key: 'grammar-check',  name: 'Grammar & Flow Check', description: 'Fix grammar, logic, and flow in any text.' },
  { key: 'draft-nda',      name: 'Draft NDA',             description: 'Non-disclosure agreement template.' },
  { key: 'privacy-policy', name: 'Privacy Policy',        description: 'Privacy policy template for web apps.' },
]

// ─── Skill card ───────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  categoryKey,
  savedSkills,
  onLaunch,
}: {
  skill: Skill
  categoryKey: string
  savedSkills: Set<string>
  onLaunch: (categoryKey: string, skillKey: string, skillName: string) => void
}) {
  const isSaved = savedSkills.has(`${categoryKey}/${skill.key}`)
  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 transition-all hover:border-purple-300 hover:shadow-sm">
      {isSaved && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5">
          <Icons.Brain className="h-2.5 w-2.5 text-emerald-600" />
          <span className="text-[9px] font-medium text-emerald-700">In Brain</span>
        </div>
      )}
      <p className="text-[12px] font-semibold text-foreground pr-14 leading-snug">{skill.name}</p>
      <p className="text-[11px] text-muted-foreground leading-snug flex-1">{skill.description}</p>
      <button
        onClick={() => onLaunch(categoryKey, skill.key, skill.name)}
        className="mt-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold text-white transition-colors opacity-0 group-hover:opacity-100"
        style={{ backgroundColor: '#a200ee' }}
      >
        <Icons.Zap className="h-3 w-3" />
        {isSaved ? 'Run again' : 'Launch session'}
      </button>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function ProductMarketingTab({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].key)
  const [pilotSkill, setPilotSkill] = useState<{ categoryKey: string; skillKey: string; skillName: string } | null>(null)
  const [savedSkills, setSavedSkills] = useState<Set<string>>(new Set())

  const activeCat = CATEGORIES.find((c) => c.key === activeCategory) ?? CATEGORIES[0]

  const launchSkill = (categoryKey: string, skillKey: string, skillName: string) => {
    setPilotSkill({ categoryKey, skillKey, skillName })
  }

  const handleSynthesisSaved = (skillKey: string) => {
    if (pilotSkill) {
      setSavedSkills((prev) => new Set([...prev, `${pilotSkill.categoryKey}/${skillKey}`]))
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <div className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-muted/20 p-3 overflow-y-auto">
        <div className="px-2 pb-2">
          <div className="flex items-center gap-1.5">
            <Icons.Zap className="h-3.5 w-3.5 shrink-0" style={{ color: '#a200ee' }} />
            <span className="text-[11px] font-bold tracking-wide" style={{ color: '#a200ee' }}>productPILOT</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">AI-guided skill sessions</p>
        </div>

        {CATEGORIES.map((cat) => {
          const CatIcon = cat.icon
          const isActive = cat.key === activeCategory
          const savedCount = cat.skills.filter((s) => savedSkills.has(`${cat.key}/${s.key}`)).length
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                isActive ? 'text-white' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              style={isActive ? { backgroundColor: '#a200ee' } : {}}
            >
              <CatIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-medium flex-1">{cat.label}</span>
              {savedCount > 0 && (
                <span className={cn(
                  'text-[9px] font-semibold rounded-full px-1.5 py-0.5',
                  isActive ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700',
                )}>{savedCount}</span>
              )}
            </button>
          )
        })}

        <div className="mt-2 border-t border-border pt-2">
          <p className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Quick Tools</p>
          {QUICK_TOOLS.map((tool) => (
            <button
              key={tool.key}
              onClick={() => launchSkill('pm-toolkit', tool.key, tool.name)}
              className="flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-left text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Icons.Wrench className="h-3 w-3 shrink-0" />
              <span className="text-[11px]">{tool.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Skill grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            {(() => { const CatIcon = activeCat.icon; return <CatIcon className="h-4 w-4 text-muted-foreground" /> })()}
            <h2 className="text-base font-semibold text-foreground">{activeCat.label}</h2>
            <span className="text-[11px] text-muted-foreground">{activeCat.skills.length} skills</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Click any skill to launch a guided productPILOT session. Completed sessions save synthesis to this client's Brain.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {activeCat.skills.map((skill) => (
            <SkillCard
              key={skill.key}
              skill={skill}
              categoryKey={activeCat.key}
              savedSkills={savedSkills}
              onLaunch={launchSkill}
            />
          ))}
        </div>
      </div>

      {/* ProductPilot modal */}
      {pilotSkill && (
        <ProductPilot
          clientId={clientId}
          clientName={clientName}
          categoryKey={pilotSkill.categoryKey}
          skillKey={pilotSkill.skillKey}
          skillName={pilotSkill.skillName}
          onClose={() => setPilotSkill(null)}
          onSkillSuggestionClick={(catKey, skKey) => {
            const cat = CATEGORIES.find((c) => c.key === catKey)
            const sk  = cat?.skills.find((s) => s.key === skKey) ?? QUICK_TOOLS.find((t) => t.key === skKey)
            if (sk) {
              setPilotSkill({ categoryKey: catKey, skillKey: skKey, skillName: sk.name })
            }
          }}
          onSynthesisSaved={handleSynthesisSaved}
        />
      )}
    </div>
  )
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
