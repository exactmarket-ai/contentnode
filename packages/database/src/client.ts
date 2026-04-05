import { PrismaClient } from '@prisma/client'
import { agencyMiddleware } from './middleware.js'

// Singleton pattern — reuse across hot-reloads in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  })

prisma.$use(agencyMiddleware)

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
