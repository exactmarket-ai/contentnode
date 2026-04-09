import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType,
} from 'docx'

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

// ── Plain text fallback ───────────────────────────────────────────────────────

export async function downloadDocx(text: string, filename: string) {
  const paragraphs = text.split(/\n{2,}/).flatMap((block) => {
    const lines = block.split('\n')
    return [
      new Paragraph({
        children: lines.flatMap((line, i) =>
          i < lines.length - 1
            ? [new TextRun(line), new TextRun({ text: '', break: 1 })]
            : [new TextRun(line)],
        ),
      }),
      new Paragraph({}),
    ]
  })
  const doc = new Document({ sections: [{ children: paragraphs }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
