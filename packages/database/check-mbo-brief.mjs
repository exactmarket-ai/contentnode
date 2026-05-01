import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})

try {
  // Find the MBO brief
  const brief = await prisma.clientBrief.findFirst({
    where: { name: { contains: 'MBO', mode: 'insensitive' } },
    select: { id: true, name: true, clientId: true, agencyId: true, verticalIds: true, status: true },
  })

  if (!brief) {
    console.log('No brief found with "MBO" in the name.')
    process.exit(0)
  }

  console.log('MBO brief:', JSON.stringify(brief, null, 2))

  // Show all verticals for this agency
  const verticals = await prisma.vertical.findMany({
    where: { agencyId: brief.agencyId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  console.log('\nVerticals for this agency:')
  verticals.forEach((v) => console.log(`  ${v.id}  ${v.name}`))

  // Find the Performance Management vertical
  const pmVertical = verticals.find((v) =>
    v.name.toLowerCase().includes('performance')
  )

  if (!pmVertical) {
    console.log('\nNo "Performance Management" vertical found. Cannot auto-update.')
    process.exit(0)
  }

  console.log(`\nPerformance Management vertical: ${pmVertical.id} — "${pmVertical.name}"`)

  if (brief.verticalIds.includes(pmVertical.id)) {
    console.log('\nBrief already scoped to Performance Management. No update needed.')
    process.exit(0)
  }

  // Update brief to scope to Performance Management vertical only
  const updated = await prisma.clientBrief.update({
    where: { id: brief.id },
    data: { verticalIds: [pmVertical.id] },
    select: { id: true, name: true, verticalIds: true },
  })
  console.log('\nUpdated brief:', JSON.stringify(updated, null, 2))
  console.log('\nDone — MBO brief now scoped to Performance Management.')
} catch (err) {
  console.error('Error:', err.message)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
