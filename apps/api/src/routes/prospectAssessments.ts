/**
 * prospectAssessments.ts
 *
 * CRUD for /api/v1/prospect-assessments
 * Agency-scoped — no client attachment. Owner/admin only.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { prisma }               from '@contentnode/database'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createBody = z.object({
  name:     z.string().min(1).max(300),
  url:      z.string().max(500).optional().nullable(),
  industry: z.string().max(200).optional().nullable(),
})

const updateBody = z.object({
  name:        z.string().min(1).max(300).optional(),
  url:         z.string().max(500).optional().nullable(),
  industry:    z.string().max(200).optional().nullable(),
  status:      z.enum(['not_started', 'researching', 'scoring', 'complete', 'archived']).optional(),
  scores:      z.record(z.number().min(0).max(5)).optional().nullable(),
  findings:    z.record(z.string()).optional().nullable(),
  notes:       z.string().optional().nullable(),
  totalScore:  z.number().min(0).max(5).optional().nullable(),
})

// ─── Weighted score calculator ────────────────────────────────────────────────

const WEIGHTS: Record<string, number> = {
  website_messaging:     0.20,
  social_outbound:       0.10,
  positioning_segment:   0.20,
  analyst_context:       0.15,
  competitive_landscape: 0.15,
  growth_signals:        0.20,
}

function calcTotalScore(scores: Record<string, number>): number {
  let total = 0
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (scores[key] != null) total += scores[key] * weight
  }
  return Math.round(total * 10) / 10
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function prospectAssessmentRoutes(app: FastifyInstance) {

  // ── List ────────────────────────────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { status } = req.query as Record<string, string>

    const assessments = await prisma.prospectAssessment.findMany({
      where: { agencyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({ data: assessments })
  })

  // ── Create ──────────────────────────────────────────────────────────────────
  app.post('/', async (req, reply) => {
    const { agencyId } = req.auth

    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const assessment = await prisma.prospectAssessment.create({
      data: {
        agencyId,
        name:     parsed.data.name,
        url:      parsed.data.url ?? null,
        industry: parsed.data.industry ?? null,
        status:   'not_started',
      },
    })

    return reply.code(201).send({ data: assessment })
  })

  // ── Get one ─────────────────────────────────────────────────────────────────
  app.get('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const assessment = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!assessment) return reply.code(404).send({ error: 'Not found' })

    return reply.send({ data: assessment })
  })

  // ── Update ──────────────────────────────────────────────────────────────────
  app.patch('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })

    const existing = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    const { scores, ...rest } = parsed.data

    // Auto-calculate totalScore when scores are provided
    let totalScore = parsed.data.totalScore
    if (scores != null) {
      totalScore = calcTotalScore(scores)
    }

    const updated = await prisma.prospectAssessment.update({
      where: { id },
      data: {
        ...rest,
        ...(scores !== undefined ? { scores } : {}),
        ...(totalScore !== undefined ? { totalScore } : {}),
      },
    })

    return reply.send({ data: updated })
  })

  // ── Delete ──────────────────────────────────────────────────────────────────
  app.delete('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params as { id: string }

    const existing = await prisma.prospectAssessment.findFirst({ where: { id, agencyId } })
    if (!existing) return reply.code(404).send({ error: 'Not found' })

    await prisma.prospectAssessment.delete({ where: { id } })

    return reply.code(204).send()
  })
}
