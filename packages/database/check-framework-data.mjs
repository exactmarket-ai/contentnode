/**
 * Diagnostic: check what GTM framework data exists in the DB.
 * Usage: DATABASE_URL=<url> node packages/database/check-framework-data.mjs [clientName]
 *
 * Examples:
 *   node packages/database/check-framework-data.mjs
 *   node packages/database/check-framework-data.mjs "Acme Corp"
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
const filterName = process.argv[2]?.toLowerCase()

try {
  const frameworks = await prisma.clientFramework.findMany({
    include: {
      client:   { select: { id: true, name: true } },
      vertical: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const filtered = filterName
    ? frameworks.filter((f) => f.client.name.toLowerCase().includes(filterName))
    : frameworks

  if (filtered.length === 0) {
    console.log(filterName
      ? `No framework records found for client matching "${filterName}"`
      : 'No framework records found in database at all')
    process.exit(0)
  }

  for (const fw of filtered) {
    const data = fw.data ?? {}
    const sectionStatus = fw.sectionStatus ?? {}

    // Count non-empty fields
    let totalFields = 0
    let filledFields = 0
    const filledSections = []

    const countFields = (obj, prefix = '') => {
      if (!obj || typeof obj !== 'object') return
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('_')) continue
        if (Array.isArray(v)) {
          v.forEach((item, i) => countFields(item, `${prefix}${k}[${i}].`))
        } else if (v && typeof v === 'object') {
          countFields(v, `${prefix}${k}.`)
        } else if (typeof v === 'string') {
          totalFields++
          if (v.trim().length > 0) {
            filledFields++
            const section = prefix.match(/^(s\d+)/) ?? k.match(/^(s\d+)/)
            const sectionKey = (section?.[1] ?? prefix.split('.')[0] ?? k).replace('[', '').replace(']', '')
            if (sectionKey && !filledSections.includes(sectionKey)) filledSections.push(sectionKey)
          }
        }
      }
    }

    countFields(data)

    const hasData = filledFields > 0
    console.log('\n' + '─'.repeat(60))
    console.log(`Client:    ${fw.client.name} (${fw.client.id})`)
    console.log(`Vertical:  ${fw.vertical.name} (${fw.vertical.id})`)
    console.log(`Record ID: ${fw.id}`)
    console.log(`Agency:    ${fw.agencyId}`)
    console.log(`Updated:   ${fw.updatedAt.toISOString()}`)
    console.log(`Data:      ${hasData ? `${filledFields}/${totalFields} fields filled` : '⚠ ALL EMPTY — no content saved'}`)
    if (filledSections.length > 0) {
      console.log(`Sections with content: ${filledSections.sort().join(', ')}`)
    }
    console.log(`Section status: ${JSON.stringify(sectionStatus)}`)

    if (hasData && filterName) {
      // Print a sample of the actual data for the matched client
      console.log('\nSample data (first 5 non-empty string values):')
      let shown = 0
      const showSample = (obj, prefix = '') => {
        if (shown >= 5 || !obj || typeof obj !== 'object') return
        for (const [k, v] of Object.entries(obj)) {
          if (shown >= 5) break
          if (k.startsWith('_')) continue
          if (Array.isArray(v)) { v.forEach((item) => showSample(item, `${prefix}${k}.`)); continue }
          if (v && typeof v === 'object') { showSample(v, `${prefix}${k}.`); continue }
          if (typeof v === 'string' && v.trim().length > 0) {
            console.log(`  ${prefix}${k}: ${v.trim().slice(0, 120)}${v.length > 120 ? '…' : ''}`)
            shown++
          }
        }
      }
      showSample(data)
    }
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`Total records: ${filtered.length}`)
} finally {
  await prisma.$disconnect()
}
