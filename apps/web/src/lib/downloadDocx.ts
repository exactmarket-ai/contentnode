import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType,
} from 'docx'
import { stripMarkdown } from './utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

function heading1(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 120 },
  })
}

function heading2(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
  })
}

function field(label: string, value: string | null | undefined): Paragraph[] {
  if (!value?.trim()) return []
  return [
    new Paragraph({
      children: [
        new TextRun({ text: `${label}: `, bold: true, size: 20 }),
        new TextRun({ text: value, size: 20 }),
      ],
      spacing: { after: 80 },
    }),
  ]
}

function fieldArea(label: string, value: string | null | undefined): Paragraph[] {
  if (!value?.trim()) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
    new Paragraph({ children: [new TextRun({ text: value, size: 20 })], spacing: { after: 120 } }),
  ]
}

function bulletList(label: string, items: string[]): Paragraph[] {
  const filled = items.filter(Boolean)
  if (filled.length === 0) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
    ...filled.map((item) => new Paragraph({
      children: [new TextRun({ text: item, size: 20 })],
      bullet: { level: 0 },
      spacing: { after: 40 },
    })),
    new Paragraph({ spacing: { after: 80 } }),
  ]
}

function spacer(): Paragraph {
  return new Paragraph({ spacing: { after: 160 } })
}

// ── Brand Profile docx ────────────────────────────────────────────────────────

interface ClientProfile {
  label?: string | null
  brandTone?: string | null
  formality?: string | null
  pov?: string | null
  signaturePhrases?: string[]
  avoidPhrases?: string[]
  primaryBuyer?: Record<string, unknown>
  secondaryBuyer?: Record<string, unknown>
  buyerMotivations?: string[]
  buyerFears?: string[]
  visualStyle?: string | null
  colorTemperature?: string | null
  photographyVsIllustration?: string | null
  approvedVisualThemes?: string[]
  avoidVisual?: string[]
  currentPositioning?: string | null
  campaignThemesApproved?: string[]
  crawledFrom?: string | null
  updatedAt?: string
  sources?: Array<{ url: string; label: string; addedAt?: string }>
}

function buyerParagraphs(label: string, buyer: Record<string, unknown>): Paragraph[] {
  if (!buyer || Object.keys(buyer).length === 0) return []
  const lines: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
  ]
  if (buyer.title) lines.push(new Paragraph({ children: [new TextRun({ text: `  Role: ${buyer.title}`, size: 20 })], spacing: { after: 40 } }))
  if (buyer.age_range) lines.push(new Paragraph({ children: [new TextRun({ text: `  Age: ${buyer.age_range}`, size: 20 })], spacing: { after: 40 } }))
  const pain = (buyer.pain_points as string[]) ?? []
  if (pain.length) {
    lines.push(new Paragraph({ children: [new TextRun({ text: '  Pain Points:', size: 20 })], spacing: { after: 20 } }))
    pain.forEach((p) => lines.push(new Paragraph({ children: [new TextRun({ text: p, size: 20 })], bullet: { level: 1 }, spacing: { after: 20 } })))
  }
  const goals = (buyer.goals as string[]) ?? []
  if (goals.length) {
    lines.push(new Paragraph({ children: [new TextRun({ text: '  Goals:', size: 20 })], spacing: { after: 20 } }))
    goals.forEach((g) => lines.push(new Paragraph({ children: [new TextRun({ text: g, size: 20 })], bullet: { level: 1 }, spacing: { after: 20 } })))
  }
  lines.push(spacer())
  return lines
}

export async function downloadBrandProfileDocx(profile: ClientProfile, clientName: string) {
  const title = profile.label ?? profile.crawledFrom ?? clientName
  const children: Paragraph[] = [
    heading1(`Brand Profile — ${title}`),
    new Paragraph({
      children: [new TextRun({ text: `Client: ${clientName}`, size: 18, color: '666666' })],
      spacing: { after: 60 },
    }),
    ...(profile.updatedAt ? [new Paragraph({
      children: [new TextRun({ text: `Last updated: ${new Date(profile.updatedAt).toLocaleDateString()}`, size: 18, color: '666666' })],
      spacing: { after: 240 },
    })] : []),

    heading2('Brand Voice'),
    ...field('Brand Tone', profile.brandTone),
    ...field('Formality', profile.formality),
    ...field('Point of View', profile.pov),
    ...bulletList('Signature Phrases', profile.signaturePhrases ?? []),
    ...bulletList('Phrases to Avoid', profile.avoidPhrases ?? []),

    heading2('Audience'),
    ...buyerParagraphs('Primary Buyer', (profile.primaryBuyer as Record<string, unknown>) ?? {}),
    ...buyerParagraphs('Secondary Buyer', (profile.secondaryBuyer as Record<string, unknown>) ?? {}),
    ...bulletList('Buyer Motivations', profile.buyerMotivations ?? []),
    ...bulletList('Buyer Fears', profile.buyerFears ?? []),

    heading2('Visual Identity'),
    ...field('Visual Style', profile.visualStyle),
    ...field('Color Temperature', profile.colorTemperature),
    ...field('Imagery Style', profile.photographyVsIllustration),
    ...bulletList('Approved Visual Themes', profile.approvedVisualThemes ?? []),
    ...bulletList('Visual Elements to Avoid', profile.avoidVisual ?? []),

    heading2('Strategic Direction'),
    ...fieldArea('Current Positioning', profile.currentPositioning),
    ...bulletList('Approved Campaign Themes', profile.campaignThemesApproved ?? []),
  ]

  const sources = (profile.sources ?? []).filter((s) => s.url?.trim())
  if (sources.length > 0) {
    children.push(heading2('Sources & Citations'))
    sources.forEach((s, i) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${i + 1}. ${s.label || s.url}`, size: 20 })],
        spacing: { after: 40 },
      }))
      if (s.label && s.url !== s.label) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   ${s.url}`, size: 18, color: '555555' })],
          spacing: { after: 80 },
        }))
      }
    })
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 28, color: '1a1a2e' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 22, color: 'a200ee' } },
      ],
    },
    sections: [{ children }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[^a-z0-9]/gi, '_')}_brand_profile.docx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Company Profile docx ──────────────────────────────────────────────────────

interface LeadershipMember { name?: string; title?: string; location?: string; linkedin?: string }

interface CompanyProfile {
  label?: string | null
  about?: string | null
  founded?: string | null
  headquarters?: string | null
  industry?: string | null
  globalReach?: string | null
  companyCategory?: string | null
  businessType?: string | null
  employees?: string | null
  coreValues?: string[]
  keyAchievements?: string[]
  leadershipMessage?: string | null
  leadershipTeam?: LeadershipMember[]
  whatTheyDo?: string | null
  keyOfferings?: string[]
  industriesServed?: string[]
  partners?: string[]
  milestones?: string[]
  visionForFuture?: string | null
  website?: string | null
  generalInquiries?: string | null
  phone?: string | null
  headquartersAddress?: string | null
  crawledFrom?: string | null
  updatedAt?: string
  sources?: Array<{ url: string; label: string; addedAt?: string }>
}

export async function downloadCompanyProfileDocx(profile: CompanyProfile, clientName: string) {
  const title = profile.label ?? profile.crawledFrom ?? clientName
  const children: Paragraph[] = [
    heading1(`Company Profile — ${title}`),
    new Paragraph({
      children: [new TextRun({ text: `Research for: ${clientName}`, size: 18, color: '666666' })],
      spacing: { after: 60 },
    }),
    ...(profile.updatedAt ? [new Paragraph({
      children: [new TextRun({ text: `Last updated: ${new Date(profile.updatedAt).toLocaleDateString()}`, size: 18, color: '666666' })],
      spacing: { after: 240 },
    })] : []),

    heading2('About'),
    ...fieldArea('Overview', profile.about),
    ...field('Founded', profile.founded),
    ...field('Headquarters', profile.headquarters),
    ...field('Industry', profile.industry),
    ...field('Employees', profile.employees),
    ...field('Global Reach', profile.globalReach),
    ...field('Company Category', profile.companyCategory),
    ...field('Business Type', profile.businessType),
    ...bulletList('Core Values', profile.coreValues ?? []),
    ...bulletList('Key Achievements', profile.keyAchievements ?? []),

    heading2('Leadership'),
    ...fieldArea('Leadership Message', profile.leadershipMessage),
    ...((profile.leadershipTeam ?? []).length > 0 ? [
      new Paragraph({ children: [new TextRun({ text: 'Leadership Team', bold: true, size: 20 })], spacing: { after: 80 } }),
      ...(profile.leadershipTeam ?? []).flatMap((m) => [
        new Paragraph({
          children: [
            new TextRun({ text: `${m.name ?? ''}`, bold: true, size: 20 }),
            new TextRun({ text: m.title ? ` — ${m.title}` : '', size: 20 }),
            new TextRun({ text: m.location ? `  (${m.location})` : '', size: 18, color: '666666' }),
          ],
          spacing: { after: 40 },
        }),
        ...(m.linkedin ? [new Paragraph({ children: [new TextRun({ text: `  LinkedIn: ${m.linkedin}`, size: 18, color: '0563C1' })], spacing: { after: 60 } })] : []),
      ]),
      spacer(),
    ] : []),

    heading2('Products & Services'),
    ...fieldArea('What They Do', profile.whatTheyDo),
    ...bulletList('Key Offerings', profile.keyOfferings ?? []),
    ...bulletList('Industries Served', profile.industriesServed ?? []),

    heading2('Partners & Milestones'),
    ...bulletList('Partners', profile.partners ?? []),
    ...bulletList('Milestones & Success Stories', profile.milestones ?? []),

    heading2('Vision'),
    ...fieldArea('Vision for the Future', profile.visionForFuture),

    heading2('Contact Information'),
    ...field('Website', profile.website),
    ...field('General Inquiries', profile.generalInquiries),
    ...field('Phone', profile.phone),
    ...fieldArea('Headquarters Address', profile.headquartersAddress),
  ]

  const companySources = (profile.sources ?? []).filter((s) => s.url?.trim())
  if (companySources.length > 0) {
    children.push(heading2('Sources & Citations'))
    companySources.forEach((s, i) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${i + 1}. ${s.label || s.url}`, size: 20 })],
        spacing: { after: 40 },
      }))
      if (s.label && s.url !== s.label) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   ${s.url}`, size: 18, color: '555555' })],
          spacing: { after: 80 },
        }))
      }
    })
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 28, color: '1a1a2e' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 22, color: 'a200ee' } },
      ],
    },
    sections: [{ children }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[^a-z0-9]/gi, '_')}_company_profile.docx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Plain text export (TXT) ───────────────────────────────────────────────────

export function downloadTxt(text: string, filename: string) {
  const blob = new Blob([stripMarkdown(text)], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.txt') ? filename : `${filename}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Deliverable DOCX (multi-output, titled) ───────────────────────────────────

interface DeliverableOutput { label: string; content: string }

/** Convert a markdown line to TextRun children, stripping inline bold/italic. */
function inlineRuns(line: string): TextRun[] {
  // Split on **bold**, *italic*, and plain segments
  const parts: TextRun[] = []
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_([^_]+)_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(new TextRun(line.slice(last, m.index)))
    if (m[2]) parts.push(new TextRun({ text: m[2], bold: true, italics: true }))
    else if (m[3]) parts.push(new TextRun({ text: m[3], bold: true }))
    else if (m[4]) parts.push(new TextRun({ text: m[4], italics: true }))
    else if (m[5]) parts.push(new TextRun({ text: m[5], bold: true }))
    else if (m[6]) parts.push(new TextRun({ text: m[6], italics: true }))
    last = m.index + m[0].length
  }
  if (last < line.length) parts.push(new TextRun(line.slice(last)))
  return parts.length > 0 ? parts : [new TextRun(line)]
}

/** Parse a markdown content string into DOCX Paragraph nodes. */
function markdownToDocxParagraphs(content: string): Paragraph[] {
  const paras: Paragraph[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const h1 = line.match(/^#\s+(.+)/)
    const h2 = line.match(/^##\s+(.+)/)
    const h3 = line.match(/^###\s+(.+)/)
    const bullet = line.match(/^[-*+]\s+(.+)/)
    const hr = line.match(/^---+$/)

    if (h3 && !h2) {
      paras.push(new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 60 } }))
    } else if (h2 && !line.match(/^###/)) {
      paras.push(new Paragraph({ text: line.replace(/^##\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } } }))
    } else if (h1 && !line.match(/^##/)) {
      paras.push(new Paragraph({ text: line.replace(/^#\s+/, ''), heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }))
    } else if (bullet) {
      paras.push(new Paragraph({ children: inlineRuns(bullet[1]), bullet: { level: 0 }, spacing: { after: 60 } }))
    } else if (hr) {
      paras.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } }, spacing: { after: 120 } }))
    } else if (line.trim() === '') {
      paras.push(new Paragraph({ spacing: { after: 80 } }))
    } else {
      paras.push(new Paragraph({ children: inlineRuns(line), spacing: { after: 120 } }))
    }
    i++
  }
  return paras
}

export async function downloadDeliverableDocx(outputs: DeliverableOutput[], title: string) {
  const children: Paragraph[] = [
    heading1(title),
    new Paragraph({
      children: [new TextRun({ text: `Exported ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, size: 18, color: '666666' })],
      spacing: { after: 320 },
    }),
  ]

  outputs.forEach(({ label, content }, i) => {
    if (outputs.length > 1) children.push(heading2(label))
    children.push(...markdownToDocxParagraphs(content))
    if (i < outputs.length - 1) children.push(spacer())
  })

  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 28, color: '1a1a2e' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { bold: true, size: 22, color: 'a200ee' } },
      ],
    },
    sections: [{ children }],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.docx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Company Assessment docx ───────────────────────────────────────────────────

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24, color: '111111' })],
    spacing: { before: 480, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } },
  })
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 20, color: '333333' })],
    spacing: { before: 200, after: 80 },
  })
}

function plainField(label: string, value: string | null | undefined): Paragraph[] {
  if (!value?.trim()) return []
  return [new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20 }),
      new TextRun({ text: value.trim(), size: 20 }),
    ],
    spacing: { after: 80 },
  })]
}

function plainArea(label: string, value: string | null | undefined): Paragraph[] {
  if (!value?.trim()) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
    new Paragraph({ children: [new TextRun({ text: value.trim(), size: 20 })], spacing: { after: 140 } }),
  ]
}

function plainList(label: string, raw: string | null | undefined): Paragraph[] {
  const lines = (raw ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
    ...lines.map((line) => new Paragraph({
      children: [new TextRun({ text: `- ${line}`, size: 20 })],
      spacing: { after: 40 },
    })),
    new Paragraph({ spacing: { after: 80 } }),
  ]
}

interface AssessmentExport {
  meta: { scrapedAt?: string; references?: Array<{ url: string; label: string }> }
  s1: Record<string, unknown>
  s2: Record<string, unknown>
  s3: Record<string, unknown>
  s4: Record<string, unknown>
  s5: Record<string, unknown>
  s6: Record<string, unknown>
  s7: Record<string, unknown>
  s8: Record<string, unknown>
}

export async function downloadAssessmentDocx(data: AssessmentExport, clientName: string) {
  const s1 = data.s1
  const s2 = data.s2
  const s3 = data.s3
  const s4 = data.s4
  const s5 = data.s5
  const s6 = data.s6
  const s7 = data.s7
  const s8 = data.s8

  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const arr = <T,>(v: unknown) => (Array.isArray(v) ? v as T[] : [])

  const children: Paragraph[] = [
    // Title
    new Paragraph({
      children: [new TextRun({ text: 'Company Assessment', bold: true, size: 36, color: '111111' })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: clientName, size: 22, color: '555555' })],
      spacing: { after: 60 },
    }),
    ...(data.meta.scrapedAt ? [new Paragraph({
      children: [new TextRun({ text: `Generated ${new Date(data.meta.scrapedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, size: 18, color: '888888' })],
      spacing: { after: 400 },
    })] : [new Paragraph({ spacing: { after: 400 } })]),

    // Section 1
    sectionHeading('Section 01 — Company Profile'),
    ...plainField('Legal Name', str(s1.legalName)),
    ...plainField('Doing Business As', str(s1.doingBusinessAs)),
    ...plainField('Founded', str(s1.founded)),
    ...plainField('Headquarters', str(s1.hq)),
    ...plainField('Employee Count', str(s1.employeeCount)),
    ...plainField('Revenue Range', str(s1.revenueRange)),
    ...plainField('Funding Stage', str(s1.fundingStage)),
    ...plainField('Investors', str(s1.investors)),
    ...plainField('Industry', str(s1.industry)),
    ...plainField('Company Category', str(s1.companyCategory)),
    ...plainField('Business Type', str(s1.businessType)),
    ...plainField('Global Reach', str(s1.globalReach)),
    ...plainArea('About', str(s1.about)),
    ...plainArea('What They Do', str(s1.whatTheyDo)),
    ...plainArea('Product / Service Summary', str(s1.productServiceSummary)),
    ...plainArea('Vision for the Future', str(s1.visionForFuture)),
    ...plainList('Key Offerings', str(s1.keyOfferings)),
    ...plainList('Industries Served', str(s1.industriesServedList)),
    ...plainList('Core Values', str(s1.coreValues)),
    ...plainList('Key Achievements', str(s1.keyAchievements)),
    ...plainList('Partners', str(s1.partners)),
    ...plainList('Milestones', str(s1.milestones)),
    ...plainArea('Leadership Message', str(s1.leadershipMessage)),
    ...arr<Record<string, string>>(s1.keyExecutives).filter((e) => e.name?.trim()).flatMap((e) => [
      new Paragraph({
        children: [
          new TextRun({ text: e.name ?? '', bold: true, size: 20 }),
          new TextRun({ text: e.title ? ` — ${e.title}` : '', size: 20 }),
        ],
        spacing: { after: 40 },
      }),
      ...(e.linkedIn ? [new Paragraph({ children: [new TextRun({ text: `  LinkedIn: ${e.linkedIn}`, size: 18 })], spacing: { after: 60 } })] : []),
    ]),
    ...plainField('General Inquiries', str(s1.generalInquiries)),
    ...plainField('Phone', str(s1.phone)),
    ...plainArea('Headquarters Address', str(s1.headquartersAddress)),

    // Section 2
    sectionHeading('Section 02 — Competitive Landscape'),
    ...arr<Record<string, string>>(s2.competitors).filter((c) => c.name?.trim()).flatMap((c, i) => [
      subHeading(`Competitor ${i + 1}: ${c.name}`),
      ...plainField('Website', c.website),
      ...plainArea('Strengths', c.strengths),
      ...plainArea('Weaknesses', c.weaknesses),
      ...plainArea('How Client Differs', c.howClientDiffers),
    ]),
    ...plainArea('Competitive Position', str(s2.competitivePosition)),
    ...plainArea('Win / Loss Patterns', str(s2.winLossPatterns)),
    ...plainArea('Landmines', str(s2.landmines)),

    // Section 3
    sectionHeading('Section 03 — GTM Positioning'),
    ...plainArea('Messaging Statement', str(s3.messagingStatement)),
    ...plainArea('Ideal Customer Profile', str(s3.icp)),
    ...plainArea('Value Proposition', str(s3.valueProp)),
    ...plainArea('Key Message 1', str(s3.keyMessage1)),
    ...plainArea('Key Message 2', str(s3.keyMessage2)),
    ...plainArea('Key Message 3', str(s3.keyMessage3)),
    ...plainField('Tone of Voice', str(s3.toneOfVoice)),
    ...plainField('Current Tagline', str(s3.currentTagline)),
    ...plainArea('Biggest Positioning Gap', str(s3.biggestPositioningGap)),

    // Section 4
    sectionHeading('Section 04 — Channel & Partner Strategy'),
    ...arr<Record<string, string>>(s4.channels).filter((c) => c.name?.trim()).flatMap((c, i) => [
      subHeading(`Channel ${i + 1}: ${c.name}`),
      ...plainField('Type', c.type),
      ...plainField('Status', c.status),
      ...plainArea('Notes', c.notes),
    ]),
    ...plainArea('Partner Types', str(s4.partnerTypes)),
    ...plainArea('Partner Programs', str(s4.partnerPrograms)),
    ...plainArea('Channel Gaps', str(s4.channelGaps)),
    ...plainArea('Go-to-Market Motion', str(s4.goToMarketMotion)),

    // Section 5
    sectionHeading('Section 05 — Content & Digital Presence'),
    ...plainField('Website URL', str(s5.websiteUrl)),
    ...plainArea('Website Strengths', str(s5.websiteStrengths)),
    ...plainArea('Website Weaknesses', str(s5.websiteWeaknesses)),
    ...plainArea('Content Types', str(s5.contentTypes)),
    ...plainField('SEO Maturity', str(s5.seoMaturity)),
    ...arr<Record<string, string>>(s5.social).filter((s) => s.platform?.trim()).flatMap((s) => [
      new Paragraph({
        children: [
          new TextRun({ text: s.platform ?? '', bold: true, size: 20 }),
          new TextRun({ text: s.handle ? ` (@${s.handle})` : '', size: 20 }),
          new TextRun({ text: s.activityLevel ? ` — ${s.activityLevel}` : '', size: 20 }),
        ],
        spacing: { after: 60 },
      }),
    ]),
    ...plainArea('Content Gaps', str(s5.contentGaps)),

    // Section 6
    sectionHeading('Section 06 — Target Segments & Verticals'),
    ...arr<Record<string, string>>(s6.primaryVerticals).filter((v) => v.name?.trim()).flatMap((v, i) => [
      subHeading(`Vertical ${i + 1}: ${v.name}`),
      ...plainArea('Why Good Fit', v.whyGoodFit),
      ...plainField('Current Penetration', v.currentPenetration),
      ...plainArea('Expansion Potential', v.expansionPotential),
    ]),
    ...plainArea('Geographies', str(s6.geographies)),
    ...plainField('Customer Size Range', str(s6.customerSizeRange)),
    ...plainArea('Top Use Cases', str(s6.topUseCases)),
    ...plainArea('Underserved Segments', str(s6.underservedSegments)),

    // Section 7
    sectionHeading('Section 07 — Brand & Visual Identity'),
    ...plainArea('Brand Attributes', str(s7.brandAttributes)),
    ...plainArea('Tone Adjectives', str(s7.toneAdjectives)),
    ...plainArea('Brand Personality', str(s7.brandPersonality)),
    ...plainArea('Existing Guidelines', str(s7.existingGuidelines)),
    ...plainField('Primary Colors', str(s7.primaryColors)),
    ...plainArea('Font Notes', str(s7.fontNotes)),
    ...plainArea('Brand Strengths', str(s7.brandStrengths)),
    ...plainArea('Brand Weaknesses', str(s7.brandWeaknesses)),

    // Section 8
    sectionHeading('Section 08 — Goals & Success Metrics'),
    ...plainArea('90-Day Goals', str(s8.goals90Day)),
    ...plainArea('12-Month Goals', str(s8.goals12Month)),
    ...arr<Record<string, string>>(s8.kpis).filter((k) => k.metric?.trim()).flatMap((k, i) => [
      subHeading(`KPI ${i + 1}: ${k.metric}`),
      ...plainField('Current Baseline', k.currentBaseline),
      ...plainField('Target', k.target),
    ]),
    ...plainArea('Definition of Success', str(s8.successDefinition)),
    ...plainArea('Known Blockers', str(s8.knownBlockers)),
    ...plainArea('Existing Wins', str(s8.existingWins)),
    ...plainField('Budget Range', str(s8.budgetRange)),
  ]

  // References
  const refs = arr<{ url: string; label: string }>(data.meta.references).filter((r) => r.url?.trim())
  if (refs.length > 0) {
    children.push(sectionHeading('References'))
    refs.forEach((r, i) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${i + 1}. ${r.label || r.url}`, size: 20 })],
        spacing: { after: 40 },
      }))
      if (r.label && r.url !== r.label) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   ${r.url}`, size: 18, color: '555555' })],
          spacing: { after: 80 },
        }))
      }
    })
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        { id: 'Normal', name: 'Normal', run: { font: 'Calibri', size: 20, color: '111111' } },
      ],
    },
    sections: [{ children }],
  })

  const safeName = clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName}_company_assessment.docx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Plain text fallback ───────────────────────────────────────────────────────

export async function downloadDocx(text: string, filename: string) {
  const paragraphs = markdownToDocxParagraphs(text)
  const doc = new Document({ sections: [{ children: paragraphs }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
