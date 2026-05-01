import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})

try {
  const agencies = await prisma.agency.findMany({ select: { id: true, name: true } })
  console.log('\nAgencies:', JSON.stringify(agencies, null, 2))

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, agencyId: true, clerkUserId: true },
  })
  console.log('\nUsers:', JSON.stringify(users, null, 2))
} finally {
  await prisma.$disconnect()
}
