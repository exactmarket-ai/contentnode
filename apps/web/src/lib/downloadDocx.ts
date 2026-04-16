import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType,
  Header, Footer, PageNumber, ImageRun,
} from 'docx'
import { stripMarkdown } from './utils'
import type { FrameworkData } from '@/pages/ClientFrameworkTab'
import { SECTIONS } from '@/pages/ClientFrameworkTab'
// ── Doc style ─────────────────────────────────────────────────────────────────

export interface DocStyleConfig {
  logoStorageKey: string | null
  primaryColor: string
  secondaryColor: string
  headingFont: string
  bodyFont: string
  agencyName: string | null
  coverPage: boolean
  pageNumbers: boolean
  footerText: string | null
  applyToGtm: boolean
  applyToDemandGen: boolean
  applyToBranding: boolean
}

export const DEFAULT_DOC_STYLE: DocStyleConfig = {
  logoStorageKey: null,
  primaryColor: '#1B1F3B',
  secondaryColor: '#4A90D9',
  headingFont: 'Calibri',
  bodyFont: 'Calibri',
  agencyName: null,
  coverPage: true,
  pageNumbers: true,
  footerText: null,
  applyToGtm: true,
  applyToDemandGen: false,
  applyToBranding: false,
}

// Strip leading '#' for docx color strings
function docColor(hex: string): string {
  return hex.replace(/^#/, '')
}

// Convert base64 data URL to Uint8Array for ImageRun
async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array | null> {
  try {
    const base64 = dataUrl.split(',')[1]
    if (!base64) return null
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

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

// ── GTM Framework DOCX ───────────────────────────────────────────────────────

const GTM_PURPLE = '7c3aed'
const GTM_PURPLE_LIGHT = 'ede9fe'
const GTM_GRAY = '6b7280'

/** Creates a styled table with themed header row. widths are percentages (must sum to 100). */
function styledTable(headers: string[], rows: string[][], widths?: number[], primaryColor = GTM_PURPLE): Table {
  const totalCols = headers.length
  const pcts = widths ?? headers.map(() => Math.floor(100 / totalCols))
  // derive a light tint (fallback to GTM_PURPLE_LIGHT)
  const lightColor = primaryColor === GTM_PURPLE ? GTM_PURPLE_LIGHT : primaryColor + '22'

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        width: { size: pcts[i], type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: lightColor, fill: lightColor },
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, size: 18, color: primaryColor })],
          spacing: { before: 60, after: 60 },
        })],
      })
    ),
  })

  const dataRows = rows.map((cells) =>
    new TableRow({
      children: cells.map((cell, i) =>
        new TableCell({
          width: { size: pcts[i] ?? pcts[pcts.length - 1], type: WidthType.PERCENTAGE },
          children: [new Paragraph({
            children: [new TextRun({ text: cell ?? '', size: 18 })],
            spacing: { before: 40, after: 40 },
          })],
        })
      ),
    })
  )

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  })
}

/** GTM section heading with themed border-bottom. Adds a page break before (except first). */
function gtmSectionHeading(num: string, title: string, usedIn: string, addPageBreak: boolean, primaryColor = GTM_PURPLE): (Paragraph | Table)[] {
  const items: Paragraph[] = []
  if (addPageBreak) {
    items.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 } }))
  }
  items.push(
    new Paragraph({
      children: [new TextRun({ text: `§${num} ${title}`, bold: true, size: 26, color: primaryColor })],
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: usedIn ? 60 : 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: primaryColor } },
    })
  )
  if (usedIn) {
    items.push(
      new Paragraph({
        children: [new TextRun({ text: `Used in: ${usedIn}`, italics: true, size: 16, color: GTM_GRAY })],
        spacing: { after: 120 },
      })
    )
  }
  return items
}

function gtmField(label: string, value: string | null | undefined): Paragraph[] {
  if (!value?.trim()) return []
  return [new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20 }),
      new TextRun({ text: value.trim(), size: 20 }),
    ],
    spacing: { after: 80 },
  })]
}

function gtmArea(label: string, value: string | null | undefined): Paragraph[] {
  if (!value?.trim()) return []
  return [
    new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })], spacing: { after: 40 } }),
    new Paragraph({ children: [new TextRun({ text: value.trim(), size: 20 })], spacing: { after: 120 } }),
  ]
}

function gtmSubHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22, color: '111111' })],
    spacing: { before: 160, after: 60 },
  })
}

function gtmSpacer(): Paragraph {
  return new Paragraph({ spacing: { after: 120 } })
}

export async function downloadGTMFrameworkDocx(fw: FrameworkData, clientName: string, verticalName: string, docStyle?: DocStyleConfig): Promise<void> {
  const style = docStyle ?? DEFAULT_DOC_STYLE
  const primaryHex = docColor(style.primaryColor)
  const secondaryHex = docColor(style.secondaryColor)
  const headingFont = style.headingFont
  const bodyFont = style.bodyFont
  const footerAgencyName = style.agencyName ?? 'ContentNode AI'
  const footerText = style.footerText ?? 'Confidential'
  // Bound helpers that close over primaryHex so every heading/table uses the client's brand color
  const sh = (num: string, title: string, usedIn: string, addPageBreak: boolean) =>
    gtmSectionHeading(num, title, usedIn, addPageBreak, primaryHex)
  const st = (headers: string[], rows: string[][], widths?: number[]) =>
    styledTable(headers, rows, widths, primaryHex)
  void secondaryHex // reserved for future secondary-color use

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const children: (Paragraph | Table)[] = []

  // ── Cover page ──────────────────────────────────────────────────────────────
  if (style.coverPage) {
    // Logo
    if (style.logoStorageKey) {
      const bytes = await dataUrlToBytes(style.logoStorageKey)
      if (bytes) {
        children.push(new Paragraph({
          children: [new ImageRun({ data: bytes, transformation: { width: 140, height: 50 }, type: 'png' })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 320 },
        }))
      }
    } else {
      children.push(new Paragraph({ spacing: { after: 400 } }))
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'GTM FRAMEWORK', bold: true, size: 72, color: primaryHex, font: { name: headingFont } })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
      }),
      new Paragraph({
        children: [new TextRun({ text: clientName, bold: true, size: 36, color: '111111', font: { name: headingFont } })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: verticalName, size: 28, color: GTM_GRAY, font: { name: bodyFont } })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
      }),
      new Paragraph({
        children: [new TextRun({ text: dateStr, size: 20, color: GTM_GRAY, font: { name: bodyFont } })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      }),
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: primaryHex } },
        spacing: { after: 0 },
      }),
    )
  }

  // ── §01 Vertical Overview ───────────────────────────────────────────────────
  const s01 = SECTIONS.find((s) => s.num === '01')!
  children.push(...sh('01', s01.short, s01.usedIn, true))
  children.push(...gtmArea('Positioning Statement', fw.s01.positioningStatement))
  children.push(...gtmArea('Tagline Options', fw.s01.taglineOptions))
  children.push(...gtmArea('How to Use', fw.s01.howToUse))
  children.push(...gtmArea(`What ${clientName} Is NOT`, fw.s01.whatIsNot))

  // ── §02 Customer Definition + Profile ──────────────────────────────────────
  const s02 = SECTIONS.find((s) => s.num === '02')!
  children.push(...sh('02', s02.short, s02.usedIn, true))
  children.push(...gtmField('Industry', fw.s02.industry))
  children.push(...gtmField('Company Size', fw.s02.companySize))
  children.push(...gtmField('Geography', fw.s02.geography))
  children.push(...gtmField('IT Posture', fw.s02.itPosture))
  children.push(...gtmField('Compliance Status', fw.s02.complianceStatus))
  children.push(...gtmField('Contract Profile', fw.s02.contractProfile))

  const buyerRows = fw.s02.buyerTable.filter((r) => r.segment?.trim() || r.primaryBuyer?.trim() || r.corePain?.trim() || r.entryPoint?.trim())
  if (buyerRows.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Buyer Table', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(st(
      ['Segment', 'Primary Buyer', 'Core Pain', 'Entry Point'],
      buyerRows.map((r) => [r.segment, r.primaryBuyer, r.corePain, r.entryPoint]),
      [20, 25, 30, 25],
    ))
    children.push(gtmSpacer())
  }
  children.push(...gtmArea('Secondary Targets', fw.s02.secondaryTargets))

  // ── §03 Market Pressures + Stats ────────────────────────────────────────────
  const s03 = SECTIONS.find((s) => s.num === '03')!
  children.push(...sh('03', s03.short, s03.usedIn, true))
  children.push(...gtmArea('Market Pressure Narrative', fw.s03.marketPressureNarrative))

  const statRows = fw.s03.statsTable.filter((r) => r.stat?.trim() || r.context?.trim() || r.source?.trim())
  if (statRows.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Stats', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(st(
      ['Stat', 'Context', 'Source', 'Year'],
      statRows.map((r) => [r.stat, r.context, r.source, r.year]),
      [30, 35, 25, 10],
    ))
    children.push(gtmSpacer())
  }
  children.push(...gtmArea('Additional Context', fw.s03.additionalContext))

  // ── §04 Core Challenges ─────────────────────────────────────────────────────
  const s04 = SECTIONS.find((s) => s.num === '04')!
  children.push(...sh('04', s04.short, s04.usedIn, true))
  fw.s04.challenges.forEach((ch, i) => {
    if (!ch.name?.trim() && !ch.whyExists?.trim() && !ch.consequence?.trim() && !ch.solution?.trim()) return
    if (ch.name?.trim()) children.push(gtmSubHeading(`Challenge ${i + 1}: ${ch.name}`))
    else children.push(gtmSubHeading(`Challenge ${i + 1}`))
    children.push(...gtmArea('Why It Exists', ch.whyExists))
    children.push(...gtmArea('Consequence', ch.consequence))
    children.push(...gtmArea(`${clientName} Solution`, ch.solution))
    children.push(...gtmField('Relevant Pillars', ch.pillarsText))
  })

  // ── §05 Solutions + Service Stack ───────────────────────────────────────────
  const s05 = SECTIONS.find((s) => s.num === '05')!
  children.push(...sh('05', s05.short, s05.usedIn, true))
  fw.s05.pillars.forEach((p, i) => {
    if (!p.pillar?.trim() && !p.valueProp?.trim() && !p.keyServices?.trim()) return
    children.push(gtmSubHeading(p.pillar?.trim() ? `Pillar ${i + 1}: ${p.pillar}` : `Pillar ${i + 1}`))
    children.push(...gtmArea('Value Proposition', p.valueProp))
    children.push(...gtmArea('Key Services', p.keyServices))
    children.push(...gtmField('Relevant To', p.relevantTo))
  })

  const serviceRows = fw.s05.serviceStack.filter((r) => r.service?.trim() || r.whatItDelivers?.trim())
  if (serviceRows.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Service Stack', bold: true, size: 20 })], spacing: { before: 120, after: 60 } }))
    children.push(st(
      ['Service Name', 'Regulatory Domain (if applicable)', 'What It Delivers', 'Priority'],
      serviceRows.map((r) => [r.service, r.regulatoryDomain ?? '', r.whatItDelivers, r.priority]),
      [25, 22, 40, 13],
    ))
    children.push(gtmSpacer())
  }

  // ── §06 Why [clientName] ────────────────────────────────────────────────────
  const s06 = SECTIONS.find((s) => s.num === '06')!
  children.push(...sh('06', `Why ${clientName}`, s06.usedIn, true))
  fw.s06.differentiators.forEach((d, i) => {
    if (!d.label?.trim() && !d.position?.trim()) return
    if (d.label?.trim()) children.push(gtmSubHeading(`${i + 1}. ${d.label}`))
    else children.push(gtmSubHeading(`Differentiator ${i + 1}`))
    children.push(...gtmArea('Position', d.position))
  })

  // ── §07 Segments + Buyer Profiles ───────────────────────────────────────────
  const s07 = SECTIONS.find((s) => s.num === '07')!
  children.push(...sh('07', s07.short, s07.usedIn, true))
  fw.s07.segments.forEach((seg, i) => {
    if (!seg.name?.trim() && !seg.primaryBuyerTitles?.trim() && !seg.whatIsDifferent?.trim()) return
    children.push(gtmSubHeading(seg.name?.trim() ? `Segment ${i + 1}: ${seg.name}` : `Segment ${i + 1}`))
    children.push(...gtmField('Primary Buyer Titles', seg.primaryBuyerTitles))
    children.push(...gtmArea('What Is Different', seg.whatIsDifferent))
    children.push(...gtmArea('Key Pressures', seg.keyPressures))
    children.push(...gtmField('Lead Hook', seg.leadHook))
    children.push(...gtmField('Compliance Notes', seg.complianceNotes))
  })

  // ── §08 Messaging Framework ─────────────────────────────────────────────────
  const s08 = SECTIONS.find((s) => s.num === '08')!
  children.push(...sh('08', s08.short, s08.usedIn, true))
  children.push(...gtmArea('Problems', fw.s08.problems))
  children.push(...gtmArea('Solution', fw.s08.solution))
  children.push(...gtmArea('Outcomes', fw.s08.outcomes))

  const vpRows = fw.s08.valuePropTable.filter((r) => r.pillar?.trim() || r.meaning?.trim() || r.proofPoint?.trim())
  if (vpRows.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Value Proposition Table', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(st(
      ['Pillar', 'Meaning', 'Proof Point', 'Citation'],
      vpRows.map((r) => [r.pillar, r.meaning, r.proofPoint, r.citation]),
      [20, 35, 30, 15],
    ))
    children.push(gtmSpacer())
  }

  // ── §09 Proof Points + Case Studies ─────────────────────────────────────────
  const s09 = SECTIONS.find((s) => s.num === '09')!
  children.push(...sh('09', s09.short, s09.usedIn, true))

  const filledProofPoints = fw.s09.proofPoints.filter((p) => p.text?.trim())
  if (filledProofPoints.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Proof Points', bold: true, size: 20 })], spacing: { after: 40 } }))
    filledProofPoints.forEach((pp) => {
      const text = pp.source?.trim() ? `${pp.text.trim()}  [${pp.source}]` : pp.text.trim()
      children.push(new Paragraph({
        children: [new TextRun({ text, size: 20 })],
        bullet: { level: 0 },
        spacing: { after: 40 },
      }))
    })
    children.push(gtmSpacer())
  }

  fw.s09.caseStudies.forEach((cs, i) => {
    if (!cs.clientProfile?.trim() && !cs.situation?.trim() && !cs.outcomes?.trim()) return
    children.push(gtmSubHeading(`Case Study ${i + 1}${cs.clientProfile?.trim() ? ': ' + cs.clientProfile : ''}`))
    children.push(...gtmField('URL', cs.url))
    children.push(...gtmArea('Situation', cs.situation))
    children.push(...gtmArea(`${clientName} Engagement`, cs.engagement))
    children.push(...gtmArea('Outcomes', cs.outcomes))
    children.push(...gtmArea('30-Second Version', cs.thirtySecond))
    children.push(...gtmField('Headline Stat', cs.headlineStat))
  })

  // ── §10 Objection Handling ──────────────────────────────────────────────────
  const s10 = SECTIONS.find((s) => s.num === '10')!
  children.push(...sh('10', s10.short, s10.usedIn, true))
  fw.s10.objections.forEach((obj, i) => {
    if (!obj.objection?.trim() && !obj.response?.trim()) return
    children.push(gtmSubHeading(`Objection ${i + 1}`))
    children.push(...gtmField('Objection', obj.objection))
    children.push(...gtmArea('Response', obj.response))
    children.push(...gtmArea('Follow-Up', obj.followUp))
  })

  // ── §11 Brand Voice Examples ─────────────────────────────────────────────────
  const s11 = SECTIONS.find((s) => s.num === '11')!
  children.push(...sh('11', s11.short, s11.usedIn, true))
  children.push(...gtmField('Tone Target', fw.s11.toneTarget))
  children.push(...gtmField('Vocabulary Level', fw.s11.vocabularyLevel))
  children.push(...gtmField('Sentence Style', fw.s11.sentenceStyle))
  children.push(...gtmField('What to Avoid', fw.s11.whatToAvoid))

  const filledGood = fw.s11.goodExamples.filter((e) => e.text?.trim())
  if (filledGood.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Good Examples', bold: true, size: 20 })], spacing: { after: 40 } }))
    filledGood.forEach((e) => {
      children.push(new Paragraph({
        children: [new TextRun({ text: e.text.trim(), size: 20 })],
        bullet: { level: 0 },
        spacing: { after: 40 },
      }))
    })
    children.push(gtmSpacer())
  }

  const filledBad = fw.s11.badExamples.filter((e) => e.bad?.trim() || e.whyWrong?.trim())
  if (filledBad.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Bad Examples', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(st(
      ['Bad Example', 'Why Wrong'],
      filledBad.map((e) => [e.bad, e.whyWrong]),
      [50, 50],
    ))
    children.push(gtmSpacer())
  }

  // ── §12 Competitive Differentiation ─────────────────────────────────────────
  const s12 = SECTIONS.find((s) => s.num === '12')!
  children.push(...sh('12', s12.short, s12.usedIn, true))

  const compRows = fw.s12.competitors.filter((r) => r.type?.trim() || r.positioning?.trim() || r.counter?.trim())
  if (compRows.length > 0) {
    children.push(st(
      ['Type', 'Their Positioning', `${clientName} Counter`, 'When It Comes Up'],
      compRows.map((r) => [r.type, r.positioning, r.counter, r.whenComesUp]),
      [20, 25, 35, 20],
    ))
    children.push(gtmSpacer())
  }

  // ── §13 Customer Quotes + Testimonials ──────────────────────────────────────
  const s13 = SECTIONS.find((s) => s.num === '13')!
  children.push(...sh('13', s13.short, s13.usedIn, true))
  fw.s13.quotes.forEach((q, i) => {
    if (!q.quoteText?.trim() && !q.attribution?.trim()) return
    children.push(gtmSubHeading(`Quote ${i + 1}${q.attribution?.trim() ? ' — ' + q.attribution : ''}`))
    if (q.quoteText?.trim()) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `"${q.quoteText.trim()}"`, italics: true, size: 20 })],
        spacing: { after: 60 },
      }))
    }
    children.push(...gtmField('Context', q.context))
    children.push(...gtmField('Best Used In', q.bestUsedIn))
    children.push(...gtmField('Approved', q.approved))
  })

  // ── §14 Campaign Themes + Asset Mapping ─────────────────────────────────────
  const s14 = SECTIONS.find((s) => s.num === '14')!
  children.push(...sh('14', s14.short, s14.usedIn, true))

  const campaignRows = fw.s14.campaigns.filter((r) => r.theme?.trim() || r.targetAudience?.trim() || r.primaryAssets?.trim())
  if (campaignRows.length > 0) {
    children.push(st(
      ['Theme', 'Target Audience', 'Primary Assets', 'Key Message'],
      campaignRows.map((r) => [r.theme, r.targetAudience, r.primaryAssets, r.keyMessage]),
      [25, 25, 25, 25],
    ))
    children.push(gtmSpacer())
  }

  // ── §15 FAQs ────────────────────────────────────────────────────────────────
  const s15 = SECTIONS.find((s) => s.num === '15')!
  children.push(...sh('15', s15.short, s15.usedIn, true))
  fw.s15.faqs.forEach((faq, i) => {
    if (!faq.question?.trim() && !faq.answer?.trim()) return
    children.push(new Paragraph({
      children: [new TextRun({ text: `Q${i + 1}: ${faq.question?.trim() ?? ''}`, bold: true, size: 20 })],
      spacing: { before: 120, after: 40 },
    }))
    if (faq.answer?.trim()) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `A: ${faq.answer.trim()}`, size: 20 })],
        spacing: { after: 40 },
      }))
    }
    children.push(...gtmField('Best Addressed In', faq.bestAddressedIn))
  })

  // ── §16 Content Funnel Mapping ───────────────────────────────────────────────
  const s16 = SECTIONS.find((s) => s.num === '16')!
  children.push(...sh('16', s16.short, s16.usedIn, true))

  const funnelRows = fw.s16.funnelStages.filter((r) => r.assets?.trim() || r.primaryCTA?.trim() || r.buyerState?.trim())
  if (funnelRows.length > 0) {
    children.push(st(
      ['Stage', 'Assets', 'Primary CTA', 'Buyer State'],
      funnelRows.map((r) => [r.stage, r.assets, r.primaryCTA, r.buyerState]),
      [20, 30, 25, 25],
    ))
    children.push(gtmSpacer())
  }
  children.push(...gtmArea('CTA Sequencing', fw.s16.ctaSequencing))

  // ── §17 Regulatory + Compliance ─────────────────────────────────────────────
  const s17 = SECTIONS.find((s) => s.num === '17')!
  children.push(...sh('17', s17.short, s17.usedIn, true))

  const regRows = fw.s17.regulations.filter((r) => r.requirement?.trim() || r.capability?.trim() || r.servicePillar?.trim())
  if (regRows.length > 0) {
    children.push(st(
      ['Requirement', `${clientName} Capability`, 'Service Pillar', 'Sales Note'],
      regRows.map((r) => [r.requirement, r.capability, r.servicePillar, r.salesNote]),
      [25, 30, 25, 20],
    ))
    children.push(gtmSpacer())
  }
  children.push(...gtmArea('Regulatory Sales Note', fw.s17.regulatorySalesNote))

  // ── §18 CTAs + Next Steps ────────────────────────────────────────────────────
  const s18 = SECTIONS.find((s) => s.num === '18')!
  children.push(...sh('18', s18.short, s18.usedIn, true))

  const ctaRows = fw.s18.ctas.filter((r) => r.ctaName?.trim() || r.description?.trim())
  if (ctaRows.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'CTAs', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(st(
      ['CTA Name', 'Description', 'Target Audience / Trigger', 'Assets'],
      ctaRows.map((r) => [r.ctaName, r.description, r.targetAudienceTrigger, r.assets]),
      [20, 35, 25, 20],
    ))
    children.push(gtmSpacer())
  }

  const campaignThemeRows = fw.s18.campaignThemes.filter((r) => r.campaignName?.trim() || r.description?.trim())
  if (campaignThemeRows.length > 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Campaign Themes', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(st(
      ['Campaign Name', 'Description'],
      campaignThemeRows.map((r) => [r.campaignName, r.description]),
      [35, 65],
    ))
    children.push(gtmSpacer())
  }

  const ct = fw.s18.contact
  const hasContact = ct.verticalOwner?.trim() || ct.marketingContact?.trim() || ct.salesLead?.trim() || ct.documentVersion?.trim()
  if (hasContact) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Contact Block', bold: true, size: 20 })], spacing: { after: 60 } }))
    children.push(...gtmField('Vertical Owner', ct.verticalOwner))
    children.push(...gtmField('Marketing Contact', ct.marketingContact))
    children.push(...gtmField('Sales Lead', ct.salesLead))
    children.push(...gtmField('Document Version', ct.documentVersion))
    children.push(...gtmField('Last Updated', ct.lastUpdated))
    children.push(...gtmField('Next Review Date', ct.nextReviewDate))
  }

  // ── Build document with header + footer ─────────────────────────────────────
  const footerPageChildren: TextRun[] = [
    new TextRun({ text: footerText, size: 16, color: GTM_GRAY }),
    new TextRun({ text: '\t', size: 16 }),
    new TextRun({ text: footerAgencyName, size: 16, color: GTM_GRAY }),
  ]
  if (style.pageNumbers) {
    footerPageChildren.push(
      new TextRun({ text: '\t', size: 16 }),
      new TextRun({ text: 'Page ', size: 16, color: GTM_GRAY }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GTM_GRAY }),
      new TextRun({ text: ' of ', size: 16, color: GTM_GRAY }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GTM_GRAY }),
    )
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font: { name: bodyFont }, size: 20, color: '111111' },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { bold: true, size: 26, color: primaryHex, font: { name: headingFont } },
        },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: style.coverPage,
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${clientName} | ${verticalName}`, size: 18, color: GTM_GRAY }),
                  new TextRun({ text: '\t', size: 18 }),
                  new TextRun({ text: 'GTM Framework', size: 18, color: GTM_GRAY }),
                ],
                alignment: AlignmentType.LEFT,
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' } },
              }),
            ],
          }),
          first: new Header({ children: [new Paragraph({ children: [] })] }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: footerPageChildren,
                alignment: AlignmentType.LEFT,
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' } },
                tabStops: [
                  { type: 'center', position: 4320 },
                  { type: 'right', position: 8640 },
                ],
              }),
            ],
          }),
          first: new Footer({ children: [new Paragraph({ children: [] })] }),
        },
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = (s: string) => s.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const today = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `GTM-Framework-${safeName(clientName)}-${safeName(verticalName)}-${today}.docx`
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
