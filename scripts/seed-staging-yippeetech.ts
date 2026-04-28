/**
 * Staging seed — creates "Yippee Tech" as a fully-baked fake client.
 *
 * Run against staging DB:
 *   DATABASE_URL=<staging-url> pnpm tsx scripts/seed-staging-yippeetech.ts
 *
 * Or if .env.staging is set up:
 *   dotenv -e .env.staging -- pnpm tsx scripts/seed-staging-yippeetech.ts
 *
 * Safe to re-run — uses upsert where possible, skips creation if client exists.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Find the first agency
  const agency = await prisma.agency.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!agency) throw new Error('No agency found — run the normal seed first')
  console.log(`Using agency: ${agency.name} (${agency.id})`)

  // 2. Upsert Yippee Tech client
  const client = await prisma.client.upsert({
    where: { agencyId_slug: { agencyId: agency.id, slug: 'yippee-tech' } },
    create: {
      agencyId: agency.id,
      name: 'Yippee Tech',
      slug: 'yippee-tech',
      industry: 'SaaS / B2B Software',
      status: 'active',
    },
    update: { name: 'Yippee Tech', industry: 'SaaS / B2B Software' },
  })
  console.log(`Client: ${client.name} (${client.id})`)

  // 3. Upsert "SaaS" vertical
  const existing = await prisma.vertical.findFirst({
    where: { agencyId: agency.id, name: 'SaaS' },
  })
  const vertical = existing ?? await prisma.vertical.create({
    data: { agencyId: agency.id, name: 'SaaS' },
  })
  console.log(`Vertical: ${vertical.name} (${vertical.id})`)

  // 4. Link client ↔ vertical
  await prisma.clientVertical.upsert({
    where: { clientId_verticalId: { clientId: client.id, verticalId: vertical.id } },
    create: { agencyId: agency.id, clientId: client.id, verticalId: vertical.id },
    update: {},
  })

  // 5. Upsert DocStyle (brand colors + fonts)
  await prisma.clientDocStyle.upsert({
    where: { clientId: client.id },
    create: {
      agencyId: agency.id,
      clientId: client.id,
      primaryColor: '#0057FF',
      secondaryColor: '#FF6B00',
      headingFont: 'Inter',
      bodyFont: 'Inter',
    },
    update: {
      primaryColor: '#0057FF',
      secondaryColor: '#FF6B00',
    },
  })

  // 6. Upsert GTM Framework data
  const frameworkData = buildFrameworkData()
  await prisma.clientFramework.upsert({
    where: { clientId_verticalId: { clientId: client.id, verticalId: vertical.id } },
    create: {
      agencyId: agency.id,
      clientId: client.id,
      verticalId: vertical.id,
      data: frameworkData as object,
    },
    update: { data: frameworkData as object },
  })
  console.log('GTM Framework: seeded')

  // 7. Add a test stakeholder
  const existing_sh = await prisma.stakeholder.findFirst({
    where: { agencyId: agency.id, clientId: client.id, email: 'demo@yippeetech.com' },
  })
  if (!existing_sh) {
    await prisma.stakeholder.create({
      data: {
        agencyId: agency.id,
        clientId: client.id,
        name: 'Sam Demo',
        email: 'demo@yippeetech.com',
        role: 'CMO',
        seniority: 'senior',
      },
    })
    console.log('Stakeholder: Sam Demo created')
  } else {
    console.log('Stakeholder: already exists')
  }

  console.log('\nDone. Open ContentNode and navigate to the Yippee Tech client.')
  console.log('Client ID:', client.id)
  console.log('Vertical ID:', vertical.id)
}

// ─── Framework JSON — all sections fully filled ────────────────────────────────

function buildFrameworkData() {
  return {
    // ── §01 Positioning ───────────────────────────────────────────────────────
    s01: {
      positioningStatement:
        'Yippee Tech gives mid-market B2B SaaS companies an AI-native content operating system that cuts time-to-market in half — replacing disconnected tools and manual handoffs with a single, intelligent pipeline that writes, approves, and delivers content at scale.',
      taglineOptions:
        '1. "Content at the speed of sales"\n2. "From brief to live — without the chaos"\n3. "One platform. Eight deliverables. Zero bottlenecks."',
      whatIsNot:
        '- Not a general-purpose CMS or website builder\n- Not an AI writing assistant for individual authors\n- Not a project management tool with a doc editor bolted on\n- Not a replacement for your creative team — it multiplies them',
      howToUse:
        'Use this GTM Framework as the single source of truth for all SaaS vertical content. Pull directly into the Kit Generator for Assets 01–08. Reference the messaging hierarchy when briefing designers or campaign managers.',
    },

    // ── §02 ICP ───────────────────────────────────────────────────────────────
    s02: {
      industry: 'B2B SaaS — primarily horizontal (workflow, analytics, CRM, RevOps)',
      companySize: '50–500 employees; Series A through Series C',
      geography: 'North America (US-primary), English-speaking markets',
      itPosture: 'Modern cloud-native stack; open to AI tooling; low tolerance for procurement cycles',
      complianceStatus: 'SOC 2 Type II awareness; GDPR for EU-facing customers',
      contractProfile: 'Annual contracts with quarterly check-ins; champion-led buying',
      secondaryTargets: 'Content agencies managing multiple SaaS clients',
      buyerTable: [
        {
          segment: 'Growth SaaS',
          primaryBuyer: 'VP Marketing / CMO',
          corePain: 'Content backlog blocks pipeline — team can\'t produce enough qualified top-of-funnel material',
          entryPoint: 'Paid social + Google — "AI content operations"',
        },
        {
          segment: 'Enterprise SaaS',
          primaryBuyer: 'Director of Content / Head of Demand Gen',
          corePain: 'Inconsistent messaging across channels; approvals slow down campaigns',
          entryPoint: 'Referral from agency partner or Slack community',
        },
        {
          segment: 'Agency',
          primaryBuyer: 'Agency Owner / Strategy Lead',
          corePain: 'Margin compression from content production time; can\'t scale clients without hiring',
          entryPoint: 'LinkedIn organic + partner channel',
        },
      ],
    },

    // ── §03 Market & Statistics ────────────────────────────────────────────────
    s03: {
      marketPressureNarrative:
        'B2B SaaS buyers consume 13+ pieces of content before talking to sales. Marketing teams are expected to produce more — with the same headcount — while sales cycles get longer. AI writing tools have flooded the market, but most produce generic output that still needs heavy editing. The real bottleneck is not writing speed, it\'s the pipeline from brief to approved, published, delivered — and Yippee Tech owns that entire pipeline.',
      additionalContext:
        'Analyst firms project AI content tooling to reach $12B by 2028. Early adopters among mid-market SaaS are seeing 40–60% reduction in content cycle time within 90 days.',
      statsTable: [
        { stat: '13+', context: 'Content pieces a B2B buyer consumes before engaging sales', source: 'Forrester B2B Buyer Survey 2024', year: '2024' },
        { stat: '67%', context: 'Of SaaS marketing teams say content production is their #1 bottleneck', source: 'Content Marketing Institute SaaS Benchmark', year: '2024' },
        { stat: '3.2×', context: 'More pipeline generated by companies with structured content operations vs. ad hoc', source: 'Gartner Demand Gen Research', year: '2023' },
        { stat: '52 days', context: 'Average time from campaign brief to first published asset for mid-market SaaS', source: 'HubSpot State of Marketing', year: '2024' },
        { stat: '40%', context: 'Reduction in content cycle time Yippee Tech clients see in first 90 days', source: 'Yippee Tech customer data', year: '2025' },
        { stat: '$12B', context: 'Projected AI content tooling market by 2028', source: 'IDC AI Content Market Report', year: '2024' },
      ],
    },

    // ── §04 Challenges ────────────────────────────────────────────────────────
    s04: {
      challenges: [
        {
          name: 'Content backlog paralysis',
          whyExists: 'Sales and demand gen are constantly requesting new assets, but content teams can\'t batch-produce at that speed without sacrificing quality',
          consequence: 'Pipeline stalls while content is in draft; campaigns launch late or with off-brand copy',
          solution: 'Yippee Tech generates a full 8-asset GTM Kit from a single intake — brochure, eBook, emails, deck, video script, web copy, internal brief — in hours, not weeks',
          pillarsText: 'Speed · Quality',
        },
        {
          name: 'Brand inconsistency across channels',
          whyExists: 'Multiple writers, agencies, and tools produce content with no shared style or messaging source of truth',
          consequence: 'Buyers receive conflicting messages; brand trust erodes; sales can\'t use marketing content confidently',
          solution: 'Yippee Tech\'s Brand Brain locks tone, vocabulary, and positioning at the framework level — every asset generated is on-brand by construction',
          pillarsText: 'Consistency · Brand Intelligence',
        },
        {
          name: 'Approval bottlenecks kill momentum',
          whyExists: 'Content moves through email threads, shared drives, and competing comment streams with no clear decision point',
          consequence: 'Good content dies in review; campaigns miss their windows; stakeholder trust in marketing erodes',
          solution: 'Yippee Tech\'s client portal puts content in front of the right stakeholder at the right time — with structured feedback, one-click approval, and automatic next-step triggering',
          pillarsText: 'Speed · Workflow',
        },
        {
          name: 'Scaling without hiring',
          whyExists: 'Demand gen goals grow faster than headcount budgets; agencies face margin pressure from production time',
          consequence: 'Companies either under-produce and miss pipeline targets, or over-hire and destroy margin',
          solution: 'Yippee Tech acts as a force multiplier — a single strategist can run the entire content pipeline for multiple clients simultaneously',
          pillarsText: 'Scale · ROI',
        },
        {
          name: 'Disconnected tools create data silos',
          whyExists: 'The average SaaS marketing stack has 12+ tools, each with its own content format, audience assumption, and export format',
          consequence: 'Insights from one channel never reach another; the same research is done repeatedly; no cumulative intelligence builds',
          solution: 'Yippee Tech is the connective layer — it reads from your GTM Framework, writes to Box and Monday, and feeds stakeholder feedback back into the Brand Brain',
          pillarsText: 'Integration · Intelligence',
        },
      ],
    },

    // ── §05 Pillars & Service Stack ───────────────────────────────────────────
    s05: {
      pillars: [
        { pillar: 'Speed', valueProp: 'From intake to 8 deliverables in hours, not weeks', keyServices: 'Kit Generator, Quick Generate mode', relevantTo: 'Growth SaaS, Agency' },
        { pillar: 'Quality', valueProp: 'Brand Brain ensures every word is on-message, on-tone, on-brief', keyServices: 'Brand Brain, GTM Framework, Humanizer', relevantTo: 'All segments' },
        { pillar: 'Consistency', valueProp: 'One framework. All assets. Zero drift.', keyServices: 'GTM Framework, Brand Brain, Kit Generator', relevantTo: 'Enterprise SaaS' },
        { pillar: 'Scale', valueProp: 'One strategist runs content operations for multiple clients simultaneously', keyServices: 'Multi-client workspace, Campaign layer, Workflow automation', relevantTo: 'Agency' },
        { pillar: 'Integration', valueProp: 'Connects to Box, Monday.com, and your existing stack — not a walled garden', keyServices: 'Box delivery, Monday sync, Webhook nodes', relevantTo: 'Enterprise SaaS, Agency' },
      ],
      serviceStack: [
        { service: 'GTM Kit Generator', regulatoryDomain: '', whatItDelivers: 'Full 8-asset content kit from one framework intake', priority: 'Core' },
        { service: 'Brand Brain', regulatoryDomain: '', whatItDelivers: 'Persistent intelligence layer from uploads, feedback, and edits', priority: 'Core' },
        { service: 'Workflow Canvas', regulatoryDomain: '', whatItDelivers: 'Visual AI workflow builder with 20+ node types', priority: 'Core' },
        { service: 'Client Portal', regulatoryDomain: '', whatItDelivers: 'Stakeholder-facing review + approval interface', priority: 'Core' },
        { service: 'Monday.com Integration', regulatoryDomain: '', whatItDelivers: 'Bi-directional sync for project tracking and delivery', priority: 'Add-on' },
        { service: 'Box Integration', regulatoryDomain: '', whatItDelivers: 'Automatic file delivery + edit-to-brain feedback loop', priority: 'Add-on' },
      ],
    },

    // ── §06 Differentiators ───────────────────────────────────────────────────
    s06: {
      differentiators: [
        { label: 'End-to-end pipeline — not just writing', position: 'We take you from intake JSON to 8 formatted, downloadable, deliverable assets. Competitors stop at the draft.' },
        { label: 'Brand Brain gets smarter with every edit', position: 'Every Box revision, every stakeholder note, every approval feeds back into the Brand Brain — it never forgets what works.' },
        { label: 'GTM Framework as the single source of truth', position: 'Your positioning, ICP, challenges, and CTAs live in one place. Every asset draws from it. Nothing drifts.' },
        { label: 'Built for agencies, not just brands', position: 'Multi-client workspace, client firewalls, and agency-level reporting make Yippee Tech the only AI content platform designed for the agency model.' },
        { label: 'Integrates with your existing stack', position: 'Box, Monday.com, webhooks, and custom nodes — Yippee Tech works with how your team already operates.' },
      ],
    },

    // ── §07 Segment Detail ────────────────────────────────────────────────────
    s07: {
      segments: [
        {
          name: 'Growth SaaS',
          leadHook: 'What if you could generate a full GTM content kit — brochure, eBook, email sequence, deck, video script — in the time it takes to write one blog post?',
          keyPressures: '- Sales is asking for more content\n- Demand gen budget is under scrutiny\n- Content team is 1–3 people',
          whatIsDifferent: 'We generate the whole kit, not just the draft. And it\'s brand-locked from the start — no rewrites.',
          complianceNotes: '',
        },
        {
          name: 'Enterprise SaaS',
          leadHook: 'Your messaging is inconsistent across channels and your approval process is slower than your competitors\' launch cycles.',
          keyPressures: '- Multiple stakeholders slow approval\n- Brand standards are hard to enforce at scale\n- Content doesn\'t connect across the buyer journey',
          whatIsDifferent: 'The GTM Framework is the lock. Every asset inherits it. Every approval goes through the structured portal — not email.',
          complianceNotes: 'SOC 2 Type II in progress. GDPR-ready data handling for EU-facing content.',
        },
        {
          name: 'Agency',
          leadHook: 'You\'re leaving margin on the table every time a writer rewrites the same brief from scratch for a new client.',
          keyPressures: '- Production time is killing margin\n- Clients want more, faster\n- Can\'t scale without hiring',
          whatIsDifferent: 'One strategist can run 5 clients simultaneously. The Brand Brain makes every new client smarter over time.',
          complianceNotes: '',
        },
      ],
    },

    // ── §08 Messaging ─────────────────────────────────────────────────────────
    s08: {
      problems: 'B2B SaaS marketing teams are drowning in content requests, fighting brand inconsistency, and losing weeks to approval cycles — while AI writing tools flood them with generic, unbranded output that still needs heavy editing.',
      solution: 'Yippee Tech is an AI-native content operating system that generates a full 8-asset GTM Kit from a single framework intake — branded, formatted, and delivered — in hours.',
      outcomes: 'Cut content cycle time by 40%. Eliminate brand drift. Give sales assets they\'ll actually use. Scale content operations without adding headcount.',
      valuePropTable: [
        { pillar: 'Speed', meaning: 'From intake to 8 deliverables in hours', proofPoint: '40% reduction in cycle time', citation: 'Yippee Tech customer data 2025' },
        { pillar: 'Quality', meaning: 'Brand Brain ensures every word is on-brief', proofPoint: '95% first-pass approval rate', citation: 'Yippee Tech customer data 2025' },
        { pillar: 'Consistency', meaning: 'One framework, all assets, zero drift', proofPoint: 'Used by 3 of the top 10 growth-stage SaaS companies', citation: 'Internal client list' },
        { pillar: 'Scale', meaning: 'One strategist runs content for 5+ clients', proofPoint: '3× output without hiring', citation: 'Agency partner survey 2025' },
        { pillar: 'Integration', meaning: 'Box + Monday + your stack — not a silo', proofPoint: 'Native integrations, no middleware required', citation: 'Product spec' },
      ],
    },

    // ── §09 Proof Points + Case Studies ──────────────────────────────────────
    s09: {
      proofPoints: [
        { text: '40% reduction in content cycle time within 90 days', source: 'Average across Yippee Tech customers, 2025' },
        { text: '3× content output without adding headcount', source: 'Agency partner survey, Q1 2025' },
        { text: '95% first-pass stakeholder approval rate', source: 'Yippee Tech platform data, 2025' },
        { text: '8 formatted deliverables from a single 45-minute intake session', source: 'GTM Kit Generator, product specification' },
      ],
      caseStudies: [
        {
          clientProfile: 'Series B RevOps SaaS — 120 employees, US-based, 3-person marketing team',
          url: 'https://yippeetech.com/case-studies/revops-saas',
          situation: 'Marketing team was spending 6–8 weeks per content cycle. Sales was creating their own decks because marketing couldn\'t keep up. Brand consistency was deteriorating.',
          engagement: 'Deployed Yippee Tech with GTM Framework + Kit Generator for their core vertical. Ran first full kit in 4 hours. Brand Brain trained on existing brand assets.',
          outcomes: 'Content cycle time dropped from 52 days to 11 days. Sales adoption of marketing materials increased from 34% to 81%. CMO promoted to Chief Growth Officer.',
          thirtySecond: 'A 120-person RevOps SaaS went from 52-day content cycles to 11 days. Sales is actually using marketing materials. And the CMO got promoted.',
          headlineStat: '52 days → 11 days',
        },
        {
          clientProfile: 'Digital marketing agency — 22-person team, managing 14 SaaS clients',
          url: 'https://yippeetech.com/case-studies/agency-scale',
          situation: 'Agency was turning down new clients because content production was the bottleneck. Writers were re-briefing the same clients from scratch every campaign cycle.',
          engagement: 'Onboarded all 14 clients with individual GTM Frameworks and Brand Brains. Enabled Quick Generate mode for campaign refreshes.',
          outcomes: 'Agency took on 6 new clients without hiring. Content production margin improved by 34%. Three clients renewed at higher contract values citing quality improvement.',
          thirtySecond: 'A 22-person agency serving 14 SaaS clients added 6 more without a single new hire — and improved margin by 34%.',
          headlineStat: '+6 clients, 0 new hires',
        },
      ],
    },

    // ── §10 Objections ────────────────────────────────────────────────────────
    s10: {
      objections: [
        {
          objection: 'We already use [ChatGPT / Claude / Jasper] for writing',
          response: 'General-purpose AI writes drafts. Yippee Tech generates finished, formatted, brand-locked deliverables — brochure, eBook, email sequence, deck, video script — from a single intake. Your writers spend zero time on first drafts.',
          followUp: 'How much time does your team spend turning AI drafts into finished, on-brand assets?',
        },
        {
          objection: 'We\'re concerned about content quality from AI',
          response: 'Every asset Yippee Tech generates draws from your GTM Framework — your positioning, your language, your proof points. The Brand Brain is trained on your own materials. The output starts on-brief, not generic.',
          followUp: 'Would you like to see a sample kit generated from your actual framework data?',
        },
        {
          objection: 'We don\'t have the budget right now',
          response: 'What does 6 weeks of delayed campaigns cost you in pipeline? Yippee Tech customers recover the annual investment within the first two content cycles — just from time saved.',
          followUp: 'Can we put a number on what your current cycle time is costing in missed pipeline?',
        },
        {
          objection: 'We have a great content team — we don\'t need to replace them',
          response: 'Yippee Tech multiplies your team, it doesn\'t replace them. Your strategists focus on positioning and judgment. The platform handles the production. Your best people do less copy-pasting and more thinking.',
          followUp: 'How much of your team\'s time today is production vs. strategy?',
        },
        {
          objection: 'How does this integrate with our existing tools?',
          response: 'Yippee Tech integrates with Box for file delivery and Monday.com for project tracking out of the box. Webhook nodes connect to anything with an API. You keep using what you have — Yippee Tech sits upstream.',
          followUp: 'What\'s your current stack? We can show you how it maps.',
        },
      ],
    },

    // ── §11 Brand Voice ───────────────────────────────────────────────────────
    s11: {
      toneTarget: 'Confident and direct. Never hype. Sharp — the kind of language a good CMO would write. Informed without being academic. Opinionated about how content operations should work.',
      vocabularyLevel: 'Senior B2B marketing professional. No jargon for its own sake. Plain English that respects the reader\'s intelligence.',
      sentenceStyle: 'Short to medium sentences. Active voice. Statements, not questions. Numbers when available.',
      whatToAvoid: 'revolutionary, game-changer, synergy, leverage (verb), unlock, seamlessly, world-class, best-in-class, AI-powered (use specific capability names instead)',
      goodExamples: [
        { text: 'Eight formatted deliverables. One intake session. No rewrites.' },
        { text: 'Your brand voice, baked into every asset from the start.' },
        { text: 'Sales is asking for more content. This is how you say yes.' },
      ],
      badExamples: [
        { bad: 'Revolutionizing the way teams leverage AI to unlock world-class content at scale' },
        { bad: 'Our game-changing, AI-powered platform seamlessly integrates into your workflow' },
        { bad: 'Supercharge your content strategy with cutting-edge technology' },
      ],
    },

    // ── §17 Regulatory ────────────────────────────────────────────────────────
    s17: {
      regulations: [
        { requirement: 'SOC 2 Type II', capability: 'In progress — Type I complete. All data encrypted at rest and in transit.', servicePillar: 'Quality · Integration', salesNote: 'Available for enterprise prospects. Share compliance roadmap on request.' },
        { requirement: 'GDPR', capability: 'EU data residency options available. DPA templates on file.', servicePillar: 'Integration', salesNote: 'Lead with DPA availability for EU prospects. Do not promise specific residency regions without confirming with engineering.' },
        { requirement: 'CCPA', capability: 'Data access and deletion workflows in place. Privacy policy current.', servicePillar: 'Quality', salesNote: 'Standard mention in enterprise deals. Not a differentiator — table stakes.' },
      ],
    },

    // ── §18 CTA / Contact ─────────────────────────────────────────────────────
    s18: {
      ctas: [
        {
          ctaName: 'Book a Kit Demo',
          description: 'A 30-minute live demo where we generate a real GTM Kit asset from the prospect\'s own framework data — not a slide deck.',
          targetAudienceTrigger: 'https://yippeetech.com/demo',
          assets: 'Screen recording of live kit generation, sample kit PDF, pricing one-pager',
        },
        {
          ctaName: 'Start Free Trial',
          description: 'Self-serve 14-day trial with Brand Brain setup, one free Kit Generator run, and access to all node types.',
          targetAudienceTrigger: 'https://yippeetech.com/trial',
          assets: 'Onboarding checklist, GTM Framework template, sample prompts library',
        },
      ],
      contact: {
        verticalOwner: 'Alex Chen, VP of Sales',
        marketingContact: 'Jamie Park, Director of Demand Gen',
        salesLead: 'Alex Chen',
        documentVersion: 'v1.0 — Staging Seed',
      },
    },
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
