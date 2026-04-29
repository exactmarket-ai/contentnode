import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, TableBorders,
  Header, Footer, PageNumber, ImageRun, PageBreak,
} from 'docx'
import { stripMarkdown } from './utils'
import type { FrameworkData } from '@/pages/ClientFrameworkTab'
import { SECTIONS, getSectionStatus } from '@/pages/ClientFrameworkTab'
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

const GTM_NAVY = '092648'

const GTM_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'e0deda' }

function styledTable(headers: string[], rows: string[][], widths?: number[], primaryColor = GTM_NAVY): Table {
  const totalCols = headers.length
  const pcts = widths ?? headers.map(() => Math.floor(100 / totalCols))
  const b = GTM_BORDER

  const cellMargins = { top: 100, bottom: 100, left: 120, right: 120 }
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        width: { size: pcts[i], type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: primaryColor, fill: primaryColor },
        borders: { top: b, bottom: b, left: b, right: b },
        margins: cellMargins,
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, size: 19, color: 'FFFFFF' })],
          spacing: { before: 0, after: 0 },
        })],
      })
    ),
  })

  const dataRows = rows.map((cells, ri) =>
    new TableRow({
      children: cells.map((cell, i) =>
        new TableCell({
          width: { size: pcts[i] ?? pcts[pcts.length - 1], type: WidthType.PERCENTAGE },
          shading: ri % 2 === 1
            ? { type: ShadingType.SOLID, color: 'F4F6FB', fill: 'F4F6FB' }
            : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
          borders: { top: b, bottom: b, left: b, right: b },
          margins: cellMargins,
          children: [new Paragraph({
            children: [new TextRun({ text: cell ?? '', size: 19, color: '1e293b' })],
            spacing: { before: 0, after: 0, line: 276 },
          })],
        })
      ),
    })
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableBorders = new TableBorders({ top: b, bottom: b, left: b, right: b, insideH: b, insideV: b } as any) as any
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
    borders: tableBorders,
  })
}

/** Two-cell section header matching NexusTek template:
 *  Row 1: left=primary(blue) with number | right=secondary(navy) with title+subtitle
 *  Row 2 (when usedIn set): full-width navy USED IN bar (columnSpan 2) */
function gtmSectionBlock(
  num: string, title: string, subtitle: string, usedIn: string,
  primaryHex: string, secondaryHex: string, headingFont: string,
): (Paragraph | Table)[] {
  const none = { style: BorderStyle.NONE, size: 0, color: 'auto' }
  const internalDivider = { style: BorderStyle.SINGLE, size: 2, color: 'FFFFFF' }

  const headerRow = new TableRow({
    children: [
      new TableCell({
        width: { size: 18, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: primaryHex, fill: primaryHex },
        borders: { top: none, bottom: none, left: none, right: none },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: [new Paragraph({
          children: [new TextRun({ text: num, bold: true, size: 28, color: 'FFFFFF', font: { name: headingFont } })],
          alignment: AlignmentType.CENTER,
        })],
      }),
      new TableCell({
        width: { size: 82, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: secondaryHex, fill: secondaryHex },
        borders: { top: none, bottom: none, left: none, right: none },
        margins: { top: 100, bottom: 100, left: 180, right: 140 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 24, color: 'FFFFFF', font: { name: headingFont } })],
            spacing: { after: subtitle ? 60 : 0 },
          }),
          ...(subtitle ? [new Paragraph({
            children: [new TextRun({ text: subtitle, size: 18, color: 'C5CCDB', italics: true })],
            spacing: { after: 0 },
          })] : []),
        ],
      }),
    ],
  })

  const rows: TableRow[] = [headerRow]

  if (usedIn) {
    rows.push(new TableRow({
      children: [new TableCell({
        columnSpan: 2,
        shading: { type: ShadingType.SOLID, color: secondaryHex, fill: secondaryHex },
        borders: { top: internalDivider, bottom: none, left: none, right: none },
        margins: { top: 60, bottom: 60, left: 180, right: 140 },
        children: [new Paragraph({
          children: [new TextRun({ text: `USED IN: ${usedIn}`, size: 17, color: 'B0BAC9', bold: false })],
        })],
      })],
    }))
  }

  return [
    gtmPageBreak(),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
      borders: { top: none, bottom: none, left: none, right: none },
    }),
    new Paragraph({ spacing: { after: 100 } }),
  ]
}

/** 2-column field table matching NexusTek template: label | value, alternating EAEDF4/FFFFFF */
function gtmFieldTable(
  items: Array<{ label: string; value: string | null | undefined }>,
): Table | null {
  const rows = items.filter((f) => f.value?.trim())
  if (!rows.length) return null
  const b = GTM_BORDER
  const pad = { top: 80, bottom: 80, left: 120, right: 120 }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((item, i) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: i % 2 === 0
              ? { type: ShadingType.SOLID, color: 'EAEDF4', fill: 'EAEDF4' }
              : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
            borders: { top: b, bottom: b, left: b, right: b },
            margins: pad,
            children: [new Paragraph({
              children: [new TextRun({ text: item.label, bold: true, size: 20, color: '222222' })],
            })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            shading: i % 2 === 0
              ? { type: ShadingType.SOLID, color: 'EAEDF4', fill: 'EAEDF4' }
              : { type: ShadingType.SOLID, color: 'FFFFFF', fill: 'FFFFFF' },
            borders: { top: b, bottom: b, left: b, right: b },
            margins: pad,
            children: [new Paragraph({
              children: [new TextRun({ text: item.value!.trim(), size: 20, color: '222222' })],
            })],
          }),
        ],
      })
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    borders: new TableBorders({ top: b, bottom: b, left: b, right: b, insideH: b, insideV: b } as any) as any,
  })
}

function gtmSingleCellTable(text: string, bodyFont: string): Table {
  const b = GTM_BORDER
  const pad = { top: 80, bottom: 80, left: 120, right: 120 }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.SOLID, color: 'EAEDF4', fill: 'EAEDF4' },
        borders: { top: b, bottom: b, left: b, right: b },
        margins: pad,
        children: [new Paragraph({
          children: [new TextRun({ text: text.trim(), size: 20, color: '222222', font: { name: bodyFont } })],
        })],
      })],
    })],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    borders: new TableBorders({ top: b, bottom: b, left: b, right: b } as any) as any,
  })
}

function gtmSpacer(): Paragraph {
  return new Paragraph({ spacing: { after: 120 } })
}

function gtmPageBreak(): Paragraph {
  return new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] })
}

export async function downloadGTMFrameworkDocx(fw: FrameworkData, clientName: string, verticalName: string, docStyle?: DocStyleConfig): Promise<void> {
  const style = docStyle ?? DEFAULT_DOC_STYLE
  const primaryHex = docColor(style.primaryColor)
  const secondaryHex = docColor(style.secondaryColor)
  const headingFont = style.headingFont
  const bodyFont = style.bodyFont
  const footerText = style.footerText ?? 'Confidential'
  const footerAgencyName = style.agencyName ?? 'ContentNode AI'

  // Bound helpers
  const sb = (num: string, title: string, subtitle: string, usedIn: string) =>
    gtmSectionBlock(num, title, subtitle, usedIn, primaryHex, secondaryHex, headingFont)
  const st = (headers: string[], rows: string[][], widths?: number[]) =>
    styledTable(headers, rows, widths, secondaryHex)
  const ft = (items: Array<{ label: string; value: string | null | undefined }>) => {
    const t = gtmFieldTable(items)
    if (t) children.push(t)
  }

  const children: (Paragraph | Table)[] = []

  // ── Document header (no cover page — matches NexusTek template) ─────────────
  children.push(
    new Paragraph({
      children: [new TextRun({ text: clientName, bold: true, size: 60, color: '092648', font: { name: headingFont } })],
      spacing: { before: 0, after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${verticalName} Messaging Framework`, bold: true, size: 48, color: secondaryHex, font: { name: headingFont } })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `Confidential: For Internal ${clientName} Use Only`, size: 19, color: '7A8499', italics: true, font: { name: bodyFont } })],
      spacing: { after: 300 },
    }),
  )

  // ── Document Completion Tracker ──────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: 'DOCUMENT COMPLETION TRACKER', bold: true, size: 18, color: '7A8499', font: { name: headingFont }, characterSpacing: 60 })],
    spacing: { after: 80 },
  }))
  const trackerRows = SECTIONS.map((sec) => {
    const status = getSectionStatus(fw, sec.num)
    return [
      `${sec.num} — ${sec.short.replace('[Client]', clientName)}`,
      fw.sectionOwners?.[sec.num] ?? '',
      status === 'complete' ? 'Complete' : status === 'in-progress' ? 'In Progress' : '—',
      fw.sectionNotes?.[sec.num] ?? '',
    ]
  })
  children.push(st(['SECTION', 'OWNER', 'STATUS', 'NOTES'], trackerRows, [48, 15, 12, 25]))
  children.push(new Paragraph({ spacing: { after: 240 } }))

  // ── §01 Vertical Overview ───────────────────────────────────────────────────
  const s01 = SECTIONS.find((s) => s.num === '01')!
  children.push(...sb('01', s01.short, s01.subtitle, s01.usedIn))
  ft([
    { label: 'Positioning Statement', value: fw.s01.positioningStatement },
    { label: 'Tagline Options', value: fw.s01.taglineOptions },
    { label: 'How to Use', value: fw.s01.howToUse },
    { label: `What ${clientName} Is NOT`, value: fw.s01.whatIsNot },
  ])
  children.push(gtmSpacer())

  // ── §02 Customer Definition + Profile ──────────────────────────────────────
  const s02 = SECTIONS.find((s) => s.num === '02')!
  children.push(...sb('02', s02.short, s02.subtitle, s02.usedIn))

  children.push(new Paragraph({
    children: [new TextRun({ text: 'USED IN: Brochure · Sales Cheat Sheet · BDR Emails · Customer Deck · Web Page', size: 18, color: '6b7280', italics: true })],
    spacing: { before: 0, after: 80 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Primary Target Profile', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
    spacing: { before: 0, after: 60 },
  }))
  ft([
    { label: 'Industry / Vertical', value: fw.s02.industry },
    { label: 'Company Size', value: fw.s02.companySize },
    { label: 'Geography', value: fw.s02.geography },
    { label: 'IT Posture', value: fw.s02.itPosture },
    { label: 'Compliance Status', value: fw.s02.complianceStatus },
    { label: 'Contract Profile', value: fw.s02.contractProfile },
  ])

  const buyerRows = fw.s02.buyerTable.filter((r) => r.segment?.trim() || r.primaryBuyer?.trim() || r.corePain?.trim() || r.entryPoint?.trim())
  if (buyerRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Primary Buyer Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `List each sub-segment with the key buyer, their core pain, and the best entry point for ${clientName}.`, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Segment', 'Primary Buyer', 'Core Pain', 'Entry Point'],
      buyerRows.map((r) => [r.segment, r.primaryBuyer, r.corePain, r.entryPoint]),
      [20, 25, 30, 25],
    ))
  }

  if (fw.s02.secondaryTargets?.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Secondary Targets', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Adjacent organizations or adjacent roles who share similar pressures. One paragraph.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    ft([{ label: 'Secondary Targets', value: fw.s02.secondaryTargets }])
  }
  children.push(gtmSpacer())

  // ── §03 Market Pressures + Stats ────────────────────────────────────────────
  const s03 = SECTIONS.find((s) => s.num === '03')!
  children.push(...sb('03', s03.short, s03.subtitle, s03.usedIn))

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Market Pressure Narrative', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
    spacing: { before: 0, after: 40 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: '2-3 sentences describing the macro pressures facing this vertical right now. This becomes the opening of the brochure and eBook introduction.', size: 19, color: '374151', italics: true })],
    spacing: { before: 0, after: 80 },
  }))
  if (fw.s03.marketPressureNarrative?.trim()) children.push(gtmSingleCellTable(fw.s03.marketPressureNarrative, bodyFont))

  const statRows = fw.s03.statsTable.filter((r) => r.stat?.trim() || r.context?.trim() || r.source?.trim())
  if (statRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Key Statistics', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: '4-6 stats that make the urgency undeniable. Include the source and year for every stat. These appear in the brochure stats bar, eBook opening, deck slide 2, and BDR email 1.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Stat', 'Context / Label', 'Source', 'Year'],
      statRows.map((r) => [r.stat, r.context, r.source, r.year]),
      [30, 35, 25, 10],
    ))
  }

  if (fw.s03.additionalContext?.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Additional Context / Supporting Data', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Any additional market sizing, analyst forecasts, or contextual data worth including. Include sources.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(gtmSingleCellTable(fw.s03.additionalContext!, bodyFont))
  }
  children.push(gtmSpacer())

  // ── §04 Core Challenges ─────────────────────────────────────────────────────
  const s04 = SECTIONS.find((s) => s.num === '04')!
  children.push(...sb('04', s04.short, s04.subtitle, s04.usedIn))
  children.push(new Paragraph({
    children: [new TextRun({ text: `Format guidance: Each challenge should: (1) name the pain, (2) explain why it exists in this vertical, (3) describe the business consequence, (4) map to a ${clientName} service pillar.`, size: 19, color: '374151', italics: true })],
    spacing: { before: 0, after: 80 },
  }))
  fw.s04.challenges.forEach((ch, i) => {
    if (!ch.name?.trim() && !ch.whyExists?.trim() && !ch.consequence?.trim() && !ch.solution?.trim()) return
    const label = ch.name?.trim() ? `Challenge ${i + 1} — ${ch.name}` : `Challenge ${i + 1}`
    children.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: i === 0 ? 0 : 160, after: 60 },
    }))
    const t = gtmFieldTable([
      { label: 'Why it exists', value: ch.whyExists },
      { label: 'Business consequence', value: ch.consequence },
      { label: `${clientName} solution`, value: ch.solution },
      { label: 'Service pillars', value: ch.pillarsText },
    ])
    if (t) children.push(t)
  })
  children.push(gtmSpacer())

  // ── §05 Solutions + Service Stack ───────────────────────────────────────────
  const s05 = SECTIONS.find((s) => s.num === '05')!
  children.push(...sb('05', `${clientName} Solutions + Service Stack`, s05.subtitle.replace('[Client]', clientName), s05.usedIn))

  const filledPillars = fw.s05.pillars.filter((p) => p.pillar?.trim() || p.valueProp?.trim() || p.keyServices?.trim())
  if (filledPillars.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Four Solution Pillars — Vertical Positioning', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'For each pillar, write the vertical-specific value proposition (not the generic company-wide description).', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Pillar', 'Vertical Value Prop', 'Key Services', 'Relevant To'],
      filledPillars.map((p) => [p.pillar ?? '', p.valueProp ?? '', p.keyServices ?? '', p.relevantTo ?? '']),
      [20, 35, 30, 15],
    ))
  }

  const serviceRows = fw.s05.serviceStack.filter((r) => r.service?.trim() || r.whatItDelivers?.trim())
  if (serviceRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Full Service Stack — Mapped to Vertical Needs', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `List every ${clientName} service relevant to this vertical. For each, describe what it delivers in this vertical's specific context.`, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Service', 'Regulatory Domain', 'What It Delivers in This Vertical', 'Priority'],
      serviceRows.map((r) => [r.service, r.regulatoryDomain ?? '', r.whatItDelivers, r.priority]),
      [22, 18, 45, 15],
    ))
  }

  const platformName = fw.s01.platformName?.trim()
  const platformBenefit = fw.s01.platformBenefit?.trim()
  if (platformBenefit) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `${platformName || '[Product]'} Platform — Vertical Context`, bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `How does ${platformName || '[Product]'} specifically benefit this vertical? What operational outcomes does it enable?`, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(gtmSingleCellTable(platformBenefit, bodyFont))
  }
  children.push(gtmSpacer())

  // ── §06 Why [clientName] ────────────────────────────────────────────────────
  const s06 = SECTIONS.find((s) => s.num === '06')!
  children.push(...sb('06', `Why ${clientName}`, s06.subtitle, s06.usedIn))
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Differentiators Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
    spacing: { before: 0, after: 40 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: '6-8 differentiators specific to this vertical. Generic company-wide proof points go in Section 09.', size: 19, color: '374151', italics: true })],
    spacing: { before: 0, after: 80 },
  }))
  const filledDiff = fw.s06.differentiators.filter((d) => d.label?.trim() || d.position?.trim())
  if (filledDiff.length > 0) {
    const t = gtmFieldTable(filledDiff.map((d, i) => ({
      label: d.label?.trim() || `Differentiator ${i + 1}`,
      value: d.position,
    })))
    if (t) children.push(t)
  }
  children.push(gtmSpacer())

  // ── §07 Segments + Buyer Profiles ───────────────────────────────────────────
  const s07 = SECTIONS.find((s) => s.num === '07')!
  children.push(...sb('07', s07.short, s07.subtitle, s07.usedIn))
  fw.s07.segments.forEach((seg, i) => {
    if (!seg.name?.trim() && !seg.primaryBuyerTitles?.trim() && !seg.whatIsDifferent?.trim()) return
    const label = seg.name?.trim() ? `Sub-Segment ${i + 1} — ${seg.name}` : `Sub-Segment ${i + 1}`
    children.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: i === 0 ? 0 : 160, after: 60 },
    }))
    const t = gtmFieldTable([
      { label: 'Primary buyer title(s)', value: seg.primaryBuyerTitles },
      { label: 'What is different', value: seg.whatIsDifferent },
      { label: 'Key pressures', value: seg.keyPressures },
      { label: 'Lead hook', value: seg.leadHook },
      { label: 'Unique compliance / context notes', value: seg.complianceNotes },
    ])
    if (t) children.push(t)
  })
  children.push(gtmSpacer())

  // ── §08 Messaging Framework ─────────────────────────────────────────────────
  const s08 = SECTIONS.find((s) => s.num === '08')!
  children.push(...sb('08', s08.short, s08.subtitle, s08.usedIn))

  const s08Blocks: Array<{ heading: string; value: string | null | undefined; instruction: string }> = [
    { heading: 'Problems (2-3 sentences)', value: fw.s08.problems, instruction: `The overarching problem statement for this vertical. This is the 'before' state.` },
    { heading: 'Solution (2-3 sentences)', value: fw.s08.solution, instruction: `How ${clientName} solves the problem. High-level — not a service list.` },
    { heading: 'Outcomes (2-3 sentences)', value: fw.s08.outcomes, instruction: `What the client achieves after working with ${clientName}. The 'after' state.` },
  ]
  s08Blocks.forEach(({ heading, value, instruction }, i) => {
    if (!value?.trim()) return
    children.push(new Paragraph({
      children: [new TextRun({ text: heading, bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: i === 0 ? 0 : 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: instruction, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(gtmSingleCellTable(value, bodyFont))
  })

  const vpRows = fw.s08.valuePropTable.filter((r) => r.pillar?.trim() || r.meaning?.trim() || r.proofPoint?.trim())
  if (vpRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Value Proposition by Pillar', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 60 },
    }))
    children.push(st(
      ['Pillar', 'For This Vertical, This Means…', 'Proof Point', 'Citation'],
      vpRows.map((r) => [r.pillar, r.meaning, r.proofPoint, r.citation]),
      [20, 35, 30, 15],
    ))
  }
  children.push(gtmSpacer())

  // ── §09 Proof Points + Case Studies ─────────────────────────────────────────
  const s09 = SECTIONS.find((s) => s.num === '09')!
  children.push(...sb('09', s09.short, s09.subtitle, s09.usedIn))

  const filledProofPoints = fw.s09.proofPoints.filter((p) => p.text?.trim())
  if (filledProofPoints.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `${clientName} Company-Wide Proof Points`, bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'These are standard across all verticals — update if numbers have changed.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    const t = gtmFieldTable(filledProofPoints.map((pp) => ({
      label: pp.source?.trim() ? `[${pp.source}]` : 'Proof Point',
      value: pp.text,
    })))
    if (t) children.push(t)
    children.push(new Paragraph({ spacing: { after: 80 } }))
  }

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Vertical-Specific Case Studies', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
    spacing: { before: 160, after: 40 },
  }))
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Provide 2 case studies. Use real engagements — anonymize if needed. These are the most-used proof points in the brochure, deck, BDR emails, and cheat sheet.', size: 19, color: '374151', italics: true })],
    spacing: { before: 0, after: 80 },
  }))

  fw.s09.caseStudies.forEach((cs, i) => {
    if (!cs.clientProfile?.trim() && !cs.situation?.trim() && !cs.outcomes?.trim()) return
    const t = gtmFieldTable([
      { label: 'Client profile', value: cs.clientProfile },
      { label: 'Case study URL', value: cs.url },
      { label: 'Situation / challenge', value: cs.situation },
      { label: `${clientName} engagement`, value: cs.engagement },
      { label: 'Outcomes', value: cs.outcomes },
      { label: '30-second version', value: cs.thirtySecond },
      { label: 'Headline stat or badge', value: cs.headlineStat },
    ])
    if (t) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Case Study ${i + 1}`, bold: true, size: 20, color: '222222' })], spacing: { before: 120, after: 60 } }))
      children.push(t)
      children.push(new Paragraph({ spacing: { after: 80 } }))
    }
  })
  children.push(gtmSpacer())

  // ── §10 Objection Handling ──────────────────────────────────────────────────
  const s10 = SECTIONS.find((s) => s.num === '10')!
  children.push(...sb('10', s10.short, s10.subtitle, s10.usedIn))
  const filledObj = fw.s10.objections.filter((o) => o.objection?.trim() || o.response?.trim())
  if (filledObj.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Objection Handling Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: '6-8 most common objections in this vertical. Include the follow-up question or next action.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Objection', 'Sales Response', 'Follow-Up Question / Action'],
      filledObj.map((o) => [o.objection ?? '', o.response ?? '', o.followUp ?? '']),
      [30, 40, 30],
    ))
  }
  children.push(gtmSpacer())

  // ── §11 Brand Voice Examples ─────────────────────────────────────────────────
  const s11 = SECTIONS.find((s) => s.num === '11')!
  children.push(...sb('11', s11.short, s11.subtitle, s11.usedIn))

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Voice Characteristics for This Vertical', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
    spacing: { before: 0, after: 60 },
  }))
  ft([
    { label: 'Tone target', value: fw.s11.toneTarget },
    { label: 'Vocabulary level', value: fw.s11.vocabularyLevel },
    { label: 'Sentence style', value: fw.s11.sentenceStyle },
    { label: 'What to avoid', value: fw.s11.whatToAvoid },
  ])

  const filledGood = fw.s11.goodExamples.filter((e) => e.text?.trim())
  if (filledGood.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Sounds Like — Good Examples', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 60 },
    }))
    const t = gtmFieldTable(filledGood.map((e, i) => ({ label: `Sounds like ${i + 1}`, value: e.text })))
    if (t) children.push(t)
    children.push(new Paragraph({ spacing: { after: 80 } }))
  }

  const filledBad = fw.s11.badExamples.filter((e) => e.bad?.trim() || e.whyWrong?.trim())
  if (filledBad.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Does NOT Sound Like — Bad Examples', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 60 },
    }))
    children.push(st(
      ['Does NOT Sound Like', 'Why Wrong / Correction'],
      filledBad.map((e) => [e.bad ?? '', e.whyWrong ?? '']),
      [50, 50],
    ))
  }
  children.push(gtmSpacer())

  // ── §12 Competitive Differentiation ─────────────────────────────────────────
  const s12 = SECTIONS.find((s) => s.num === '12')!
  children.push(...sb('12', s12.short, s12.subtitle.replace('[Client]', clientName), s12.usedIn))

  const compRows = fw.s12.competitors.filter((r) => r.type?.trim() || r.positioning?.trim() || r.counter?.trim())
  if (compRows.length > 0) {
    children.push(st(
      ['Alternative / Competitor Type', 'Their Positioning', `${clientName} Counter`, 'When This Comes Up'],
      compRows.map((r) => [r.type, r.positioning, r.counter, r.whenComesUp]),
      [22, 26, 32, 20],
    ))
  }
  children.push(gtmSpacer())

  // ── §13 Customer Quotes + Testimonials ──────────────────────────────────────
  const s13 = SECTIONS.find((s) => s.num === '13')!
  children.push(...sb('13', s13.short, s13.subtitle, s13.usedIn))
  fw.s13.quotes.forEach((q, i) => {
    if (!q.quoteText?.trim() && !q.attribution?.trim()) return
    const t = gtmFieldTable([
      { label: 'Quote text', value: q.quoteText?.trim() ? `"${q.quoteText.trim()}"` : undefined },
      { label: 'Attribution', value: q.attribution },
      { label: 'Context', value: q.context },
      { label: 'Best used in', value: q.bestUsedIn },
      { label: 'Approved for use?', value: q.approved },
    ])
    if (t) {
      children.push(new Paragraph({ children: [new TextRun({ text: `Quote ${i + 1}`, bold: true, size: 20, color: '222222' })], spacing: { before: 120, after: 60 } }))
      children.push(t)
      children.push(new Paragraph({ spacing: { after: 80 } }))
    }
  })
  children.push(gtmSpacer())

  // ── §14 Campaign Themes + Asset Mapping ─────────────────────────────────────
  const s14 = SECTIONS.find((s) => s.num === '14')!
  children.push(...sb('14', s14.short, s14.subtitle, s14.usedIn))
  const campaignRows = fw.s14.campaigns.filter((r) => r.theme?.trim() || r.targetAudience?.trim() || r.primaryAssets?.trim())
  if (campaignRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Campaign themes give the asset suite coherence — each theme owns a set of assets and a buyer motion. Define 3-4 themes, then map each to the assets it drives.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Campaign Theme Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 60 },
    }))
    children.push(st(
      ['Campaign Theme', 'Target Audience', 'Primary Assets', 'Key Message'],
      campaignRows.map((r) => [r.theme, r.targetAudience, r.primaryAssets, r.keyMessage]),
      [25, 25, 25, 25],
    ))
  }
  children.push(gtmSpacer())

  // ── §15 FAQs ────────────────────────────────────────────────────────────────
  const s15 = SECTIONS.find((s) => s.num === '15')!
  children.push(...sb('15', s15.short, s15.subtitle, s15.usedIn))
  const filledFaqs = fw.s15.faqs.filter((f) => f.question?.trim() || f.answer?.trim())
  if (filledFaqs.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'The closer these are to verbatim questions from real discovery calls, the better. These feed directly into eBook chapter structure, BDR email angles, and objection handling.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'FAQs Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `10-15 questions. Include the honest ${clientName} answer and the asset where this FAQ is best addressed.`, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Question (verbatim if possible)', `${clientName} Answer`, 'Best Addressed In'],
      filledFaqs.map((f) => [f.question ?? '', f.answer ?? '', f.bestAddressedIn ?? '']),
      [35, 45, 20],
    ))
  }
  children.push(gtmSpacer())

  // ── §16 Content Funnel Mapping ───────────────────────────────────────────────
  const s16 = SECTIONS.find((s) => s.num === '16')!
  children.push(...sb('16', s16.short, s16.subtitle, s16.usedIn))
  const funnelRows = fw.s16.funnelStages.filter((r) => r.assets?.trim() || r.primaryCTA?.trim() || r.buyerState?.trim())
  if (funnelRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Mapping assets to funnel stages ensures CTAs point to the right next step. A brochure CTA should not point to a contract — it should point to an assessment.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Funnel Stage Map', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 60 },
    }))
    children.push(st(
      ['Funnel Stage', 'Assets at This Stage', 'Primary CTA From This Stage', 'Buyer State'],
      funnelRows.map((r) => [r.stage, r.assets, r.primaryCTA, r.buyerState]),
      [18, 30, 30, 22],
    ))
  }
  if (fw.s16.ctaSequencing?.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'CTA Sequencing Notes', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Describe how the CTAs should chain together — what does each asset lead to next?', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(gtmSingleCellTable(fw.s16.ctaSequencing, bodyFont))
  }
  children.push(gtmSpacer())

  // ── §17 Regulatory + Compliance ─────────────────────────────────────────────
  const s17 = SECTIONS.find((s) => s.num === '17')!
  children.push(...sb('17', s17.short, s17.subtitle, s17.usedIn))
  const regRows = fw.s17.regulations.filter((r) => r.requirement?.trim() || r.capability?.trim() || r.servicePillar?.trim())
  if (regRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `Include only frameworks where ${clientName} has a direct service capability. Do not claim compliance or certification authority ${clientName} does not hold.`, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Regulatory Framework Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: `For each relevant framework, map the requirement to the ${clientName} capability and service pillar.`, size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Regulatory Requirement', `${clientName} Capability`, 'Service Pillar', 'Sales Note'],
      regRows.map((r) => [r.requirement, r.capability, r.servicePillar, r.salesNote]),
      [25, 30, 20, 25],
    ))
  }
  if (fw.s17.regulatorySalesNote?.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Regulatory Sales Note', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'How should sales use regulatory pressure in the conversation? Lead with it or use it as reinforcement?', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(gtmSingleCellTable(fw.s17.regulatorySalesNote!, bodyFont))
  }
  children.push(gtmSpacer())

  // ── §18 CTAs + Next Steps ────────────────────────────────────────────────────
  const s18 = SECTIONS.find((s) => s.num === '18')!
  children.push(...sb('18', s18.short, s18.subtitle, s18.usedIn))

  const ctaRows = fw.s18.ctas.filter((r) => r.ctaName?.trim() || r.description?.trim())
  if (ctaRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Primary CTAs Table', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 0, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: '3-4 CTAs in order of preference. Each should have a clear description, target audience, and the trigger condition that makes it the right offer.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['CTA Name', 'Description', 'Target Audience / Trigger', 'Asset(s) Where This Appears'],
      ctaRows.map((r) => [r.ctaName, r.description, r.targetAudienceTrigger, r.assets]),
      [20, 32, 28, 20],
    ))
    children.push(new Paragraph({ spacing: { after: 80 } }))
  }

  const campaignThemeRows = fw.s18.campaignThemes.filter((r) => r.campaignName?.trim() || r.description?.trim())
  if (campaignThemeRows.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Campaign Theme Suggestions', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: '2-4 campaign names with a one-sentence description of what each campaign is for.', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    children.push(st(
      ['Campaign Name', 'Description'],
      campaignThemeRows.map((r) => [r.campaignName, r.description]),
      [35, 65],
    ))
  }

  const ct = fw.s18.contact
  const hasContact = ct.verticalOwner?.trim() || ct.marketingContact?.trim() || ct.salesLead?.trim() || ct.documentVersion?.trim() || ct.lastUpdated?.trim() || ct.nextReviewDate?.trim()
  if (hasContact) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Contact Information for This Vertical', bold: true, size: 20, color: secondaryHex, font: { name: headingFont } })],
      spacing: { before: 160, after: 40 },
    }))
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Who internally owns this vertical? Who should be contacted for questions about this messaging document?', size: 19, color: '374151', italics: true })],
      spacing: { before: 0, after: 80 },
    }))
    ft([
      { label: 'Vertical owner', value: ct.verticalOwner },
      { label: 'Marketing contact', value: ct.marketingContact },
      { label: 'Sales lead', value: ct.salesLead },
      { label: 'Document version', value: ct.documentVersion },
      { label: 'Last updated', value: ct.lastUpdated },
      { label: 'Next review date', value: ct.nextReviewDate },
    ])
  }

  // ── Build document ───────────────────────────────────────────────────────────
  const footerPageChildren: TextRun[] = [
    new TextRun({ text: footerText, size: 16, color: '94a3b8' }),
    new TextRun({ text: '\t', size: 16 }),
    new TextRun({ text: footerAgencyName, size: 16, color: '94a3b8' }),
  ]
  if (style.pageNumbers) {
    footerPageChildren.push(
      new TextRun({ text: '\t', size: 16 }),
      new TextRun({ text: 'Page ', size: 16, color: '94a3b8' }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '94a3b8' }),
      new TextRun({ text: ' of ', size: 16, color: '94a3b8' }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '94a3b8' }),
    )
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font: { name: bodyFont }, size: 20, color: '222222' },
          paragraph: { spacing: { line: 276, after: 80 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${clientName}  |  ${verticalName} Messaging Framework`, size: 16, color: 'AAAAAA' }),
                  new TextRun({ text: '\t', size: 16 }),
                  new TextRun({ text: 'Confidential', size: 16, color: 'AAAAAA', italics: true }),
                ],
                alignment: AlignmentType.LEFT,
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' } },
                tabStops: [{ type: 'right', position: 9360 }],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: footerPageChildren,
                alignment: AlignmentType.LEFT,
                border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'e5e7eb' } },
                tabStops: [
                  { type: 'center', position: 4680 },
                  { type: 'right', position: 9360 },
                ],
              }),
            ],
          }),
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
