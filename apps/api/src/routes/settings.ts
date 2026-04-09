import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'

export async function settingsRoutes(app: FastifyInstance) {
  // ── GET / — get agency settings (upserts defaults on first access) ─────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth

    const settings = await prisma.agencySettings.upsert({
      where: { agencyId },
      create: { agencyId },
      update: {},
    })

    return reply.send({ data: settings })
  })

  // ── PATCH / — update agency settings ────────────────────────────────────────
  app.patch('/', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = z.object({
      tempContactExpiryDays: z.number().int().positive().nullable().optional(),
    }).safeParse(req.body)

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
    }

    const settings = await prisma.agencySettings.upsert({
      where: { agencyId },
      create: {
        agencyId,
        ...(parsed.data.tempContactExpiryDays !== undefined
          ? { tempContactExpiryDays: parsed.data.tempContactExpiryDays }
          : {}),
      },
      update: {
        ...(parsed.data.tempContactExpiryDays !== undefined
          ? { tempContactExpiryDays: parsed.data.tempContactExpiryDays }
          : {}),
      },
    })

    return reply.send({ data: settings })
  })
}
