import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, WidthType, ShadingType, AlignmentType,
  BorderStyle, TableLayoutType,
} from 'docx'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ROLE_DIRECTORY = [
  // Platform ownership
  { num: 1,  slug: 'super_admin',               label: 'Super Admin',               tier: 'Platform Ownership' },
  { num: 2,  slug: 'owner',                     label: 'Owner (legacy)',             tier: 'Platform Ownership' },
  // Org administration
  { num: 3,  slug: 'org_admin',                 label: 'Org Admin',                 tier: 'Org Administration' },
  { num: 4,  slug: 'admin',                     label: 'Admin (legacy)',             tier: 'Org Administration' },
  // Strategic / senior agency
  { num: 5,  slug: 'strategist',                label: 'Strategist',                tier: 'Strategic / Senior Agency' },
  { num: 6,  slug: 'campaign_manager',          label: 'Campaign Manager',          tier: 'Strategic / Senior Agency' },
  { num: 7,  slug: 'project_manager',           label: 'Project Manager',           tier: 'Strategic / Senior Agency' },
  { num: 8,  slug: 'account_manager',           label: 'Account Manager',           tier: 'Strategic / Senior Agency' },
  // Client manager / lead tier
  { num: 9,  slug: 'client_manager',            label: 'Client Manager',            tier: 'Client Manager / Lead' },
  { num: 10, slug: 'manager',                   label: 'Manager (legacy)',           tier: 'Client Manager / Lead' },
  { num: 11, slug: 'lead',                      label: 'Lead (legacy)',              tier: 'Client Manager / Lead' },
  // Creative / editor tier
  { num: 12, slug: 'art_director',              label: 'Art Director',              tier: 'Creative / Editor' },
  { num: 13, slug: 'brand_manager',             label: 'Brand Manager',             tier: 'Creative / Editor' },
  { num: 14, slug: 'designer',                  label: 'Designer',                  tier: 'Creative / Editor' },
  { num: 15, slug: 'social_media_manager',      label: 'Social Media Manager',      tier: 'Creative / Editor' },
  { num: 16, slug: 'content_manager',           label: 'Content Manager',           tier: 'Creative / Editor' },
  { num: 17, slug: 'editor',                    label: 'Editor',                    tier: 'Creative / Editor' },
  { num: 18, slug: 'member',                    label: 'Member (legacy)',            tier: 'Creative / Editor' },
  // Specialist / writer
  { num: 19, slug: 'copywriter',                label: 'Copywriter',                tier: 'Specialist / Writer' },
  { num: 20, slug: 'seo_specialist',            label: 'SEO Specialist',            tier: 'Specialist / Writer' },
  { num: 21, slug: 'performance_marketer',      label: 'Performance Marketer',      tier: 'Specialist / Writer' },
  // Internal review / compliance
  { num: 22, slug: 'compliance_reviewer',       label: 'Compliance Reviewer',       tier: 'Internal Review' },
  { num: 23, slug: 'reviewer',                  label: 'Reviewer',                  tier: 'Internal Review' },
  // Read-only / API
  { num: 24, slug: 'viewer',                    label: 'Viewer',                    tier: 'Read-Only / API' },
  { num: 25, slug: 'api_user',                  label: 'API User',                  tier: 'Read-Only / API' },
  // Client-facing / portal
  { num: 26, slug: 'client_executive_approver', label: 'Client: Executive Approver', tier: 'Client-Facing / Portal' },
  { num: 27, slug: 'client_legal_reviewer',     label: 'Client: Legal Reviewer',    tier: 'Client-Facing / Portal' },
  { num: 28, slug: 'client_brand_reviewer',     label: 'Client: Brand Reviewer',    tier: 'Client-Facing / Portal' },
  { num: 29, slug: 'client_creative_reviewer',  label: 'Client: Creative Reviewer', tier: 'Client-Facing / Portal' },
  { num: 30, slug: 'client_marcom_reviewer',    label: 'Client: MarCom Reviewer',   tier: 'Client-Facing / Portal' },
  { num: 31, slug: 'client_product_reviewer',   label: 'Client: Product Reviewer',  tier: 'Client-Facing / Portal' },
  { num: 32, slug: 'client_stakeholder',        label: 'Client: Stakeholder',       tier: 'Client-Facing / Portal' },
]

const TIER_COLORS = {
  'Platform Ownership':       'A200EE',
  'Org Administration':       '185FA5',
  'Strategic / Senior Agency':'1D4ED8',
  'Client Manager / Lead':    'B45309',
  'Creative / Editor':        '065F46',
  'Specialist / Writer':      '0369A1',
  'Internal Review':          '9A3412',
  'Read-Only / API':          '6B7280',
  'Client-Facing / Portal':   '7E22CE',
}

const TIER_BG = {
  'Platform Ownership':       'F9F0FF',
  'Org Administration':       'EFF6FD',
  'Strategic / Senior Agency':'EFF6FF',
  'Client Manager / Lead':    'FFFBEB',
  'Creative / Editor':        'ECFDF5',
  'Specialist / Writer':      'F0F9FF',
  'Internal Review':          'FFF7ED',
  'Read-Only / API':          'F4F4F2',
  'Client-Facing / Portal':   'FDF4FF',
}

function cell(text, opts = {}) {
  const { bold = false, color = '1a1a14', bg, width, center = false } = opts
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: bg ? { type: ShadingType.SOLID, fill: bg } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [new TextRun({ text, bold, color, size: 20, font: 'Calibri' })],
      }),
    ],
  })
}

function headerCell(text, width) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: { type: ShadingType.SOLID, fill: '1a1a14' },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Calibri' })],
      }),
    ],
  })
}

function tierHeaderRow(tier) {
  const color = TIER_COLORS[tier] ?? '333333'
  const bg    = TIER_BG[tier]    ?? 'F5F5F5'
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 3,
        shading: { type: ShadingType.SOLID, fill: bg },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 4, color },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
          left:   { style: BorderStyle.NONE },
          right:  { style: BorderStyle.NONE },
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: tier.toUpperCase(), bold: true, color, size: 18, font: 'Calibri', allCaps: true })],
          }),
        ],
      }),
    ],
  })
}

// Build table rows grouped by tier
const rows = [
  new TableRow({
    tableHeader: true,
    children: [
      headerCell('#', 700),
      headerCell('Role Name', 3200),
      headerCell('Slug', 4000),
    ],
  }),
]

let lastTier = null
for (const r of ROLE_DIRECTORY) {
  if (r.tier !== lastTier) {
    rows.push(tierHeaderRow(r.tier))
    lastTier = r.tier
  }
  const bg = TIER_BG[r.tier]
  rows.push(
    new TableRow({
      children: [
        cell(String(r.num), { bold: true, color: TIER_COLORS[r.tier] ?? '333333', bg, width: 700, center: true }),
        cell(r.label, { bg }),
        cell(r.slug, { color: '555555', bg }),
      ],
    })
  )
}

const table = new Table({
  layout: TableLayoutType.FIXED,
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows,
})

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'ContentNode.ai — Role Directory', bold: true, color: 'A200EE', size: 36, font: 'Calibri' })],
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: 'Canonical role numbers for pre-launch assignment discussions. Super Admin = #1, Client Stakeholder = #32.', color: '5c5b52', size: 20, font: 'Calibri' })],
      }),
      table,
      new Paragraph({
        spacing: { before: 300 },
        children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, color: 'aaaaaa', size: 16, font: 'Calibri' })],
      }),
    ],
  }],
})

const buf = await Packer.toBuffer(doc)
const outPath = join(__dirname, '..', 'ContentNode_Role_Directory.docx')
writeFileSync(outPath, buf)
console.log('Written:', outPath)
