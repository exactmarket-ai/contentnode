/**
 * One-time fix: clear section completion status entries where the section has no field data.
 * Usage: DATABASE_URL=<url> node packages/database/fix-section-status.mjs [clientName]
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
const filterName = process.argv[2]?.toLowerCase()

try {
  const frameworks = await prisma.clientFramework.findMany({
    include: {
      client:   { select: { name: true } },
      vertical: { select: { name: true } },
    },
  })

  for (const fw of frameworks) {
    if (filterName && !fw.client.name.toLowerCase().includes(filterName)) continue

    const sectionStatus = (fw.sectionStatus ?? {}) as Record<string, string>
    const data = (fw.data ?? {}) as Record<string, unknown>

    const toFix: string[] = []

    for (const [secNum, status] of Object.entries(sectionStatus)) {
      if (status !== 'complete') continue
      const sKey = `s${secNum}`
      const sec = data[sKey]
      if (!sec || typeof sec !== 'object') { toFix.push(secNum); continue }

      let hasContent = false
      const check = (val: unknown): void => {
        if (hasContent) return
        if (typeof val === 'string' && val.trim().length > 0) { hasContent = true; return }
        if (Array.isArray(val)) val.forEach(check)
        else if (val && typeof val === 'object') Object.values(val as Record<string, unknown>).forEach(check)
      }
      Object.values(sec as Record<string, unknown>).forEach(check)
      if (!hasContent) toFix.push(secNum)
    }

    if (toFix.length === 0) continue

    const fixed = { ...sectionStatus }
    for (const num of toFix) delete fixed[num]

    await prisma.clientFramework.update({
      where: { id: fw.id },
      data: { sectionStatus: fixed },
    })

    console.log(`Fixed: ${fw.client.name} / ${fw.vertical.name} — cleared 'complete' on sections: ${toFix.join(', ')}`)
  }

  console.log('Done.')
} finally {
  await prisma.$disconnect()
}
