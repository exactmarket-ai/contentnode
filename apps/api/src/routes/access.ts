/**
 * External Access Management — /api/v1/access
 *
 * Agency-side routes for managing DeliverableAccess grants.
 */
import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { prisma, auditService } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'
import { sendReviewEmail } from '../lib/email.js'

const TOKEN_TTL_DAYS = 30

function generateAccessToken() {
  return crypto.randomBytes(32).toString('hex')
}

export async function accessRoutes(app: FastifyInstance) {

  // ── GET / — list all access grants (Admin/Owner: all org, Lead: their clients) ──
  app.get('/', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth

    const grants = await prisma.deliverableAccess.findMany({
      where: { agencyId },
      include: {
        stakeholder: { select: { id: true, name: true, email: true, role: true, clientId: true } },
        run: {
          select: {
            id: true, status: true, createdAt: true,
            workflow: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({
      data: grants.map((g) => ({
        id:            g.id,
        stakeholder:   g.stakeholder,
        run: {
          id:           g.run.id,
          status:       g.run.status,
          workflowName: g.run.workflow.name,
          client:       g.run.workflow.client,
          createdAt:    g.run.createdAt,
        },
        status:    g.revokedAt ? 'revoked' : g.expiresAt && g.expiresAt < new Date() ? 'expired' : 'active',
        expiresAt: g.expiresAt,
        revokedAt: g.revokedAt,
        grantedBy: g.grantedBy,
        createdAt: g.createdAt,
      })),
    })
  })

  // ── GET /runs/:runId — list all access grants for a specific run ───────────
  app.get('/runs/:runId', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const { runId } = req.params as { runId: string }

    const grants = await prisma.deliverableAccess.findMany({
      where: { agencyId, runId },
      include: {
        stakeholder: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send({
      data: grants.map((g) => ({
        id:            g.id,
        stakeholder:   g.stakeholder,
        status:        g.revokedAt ? 'revoked' : g.expiresAt && g.expiresAt < new Date() ? 'expired' : 'active',
        expiresAt:     g.expiresAt,
        revokedAt:     g.revokedAt,
        createdAt:     g.createdAt,
      })),
    })
  })

  // ── POST /runs/:runId/grant — grant access to a stakeholder for a run ──────
  app.post('/runs/:runId/grant', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { runId } = req.params as { runId: string }
    const { stakeholderId, sendEmail = true } = req.body as { stakeholderId: string; sendEmail?: boolean }

    if (!stakeholderId) return reply.code(400).send({ error: 'stakeholderId is required' })

    const [stakeholder, run] = await Promise.all([
      prisma.stakeholder.findFirst({
        where: { id: stakeholderId, agencyId },
        include: { client: true },
      }),
      prisma.workflowRun.findFirst({
        where: { id: runId, agencyId },
        include: { workflow: { select: { name: true, client: { select: { name: true } } } } },
      }),
    ])
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })
    if (!run) return reply.code(404).send({ error: 'Run not found' })

    const token     = generateAccessToken()
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

    const grant = await prisma.deliverableAccess.upsert({
      where: { runId_stakeholderId: { runId, stakeholderId } },
      update: { token, expiresAt, revokedAt: null, grantedBy: userId },
      create: { agencyId, runId, stakeholderId, token, expiresAt, grantedBy: userId },
    })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: 'access.grant_created',
      resourceType: 'deliverable_access', resourceId: grant.id,
      metadata: { stakeholderId, runId, email: stakeholder.email },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    // Send email notification
    if (sendEmail) {
      const portalUrl = `${process.env.PORTAL_BASE_URL || 'http://localhost:5173'}/portal?token=${token}`
      sendReviewEmail({
        to: { name: stakeholder.name, email: stakeholder.email },
        clientName: stakeholder.client.name,
        workflowName: run.workflow.name,
        portalUrl,
      }).catch((err) => req.log.error({ err }, '[access] review email failed'))
    }

    return reply.code(201).send({
      data: {
        id:          grant.id,
        stakeholder: { id: stakeholder.id, name: stakeholder.name, email: stakeholder.email },
        token:       grant.token,
        portalUrl:   `${process.env.PORTAL_BASE_URL || 'http://localhost:5173'}/portal?token=${token}`,
        expiresAt:   grant.expiresAt,
        status:      'active',
      },
    })
  })

  // ── POST /grants/:grantId/revoke — revoke a specific grant ─────────────────
  app.post('/grants/:grantId/revoke', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { grantId } = req.params as { grantId: string }

    const grant = await prisma.deliverableAccess.findFirst({
      where: { id: grantId, agencyId },
      include: { stakeholder: { select: { email: true } } },
    })
    if (!grant) return reply.code(404).send({ error: 'Access grant not found' })
    if (grant.revokedAt) return reply.code(400).send({ error: 'Access is already revoked' })

    await prisma.deliverableAccess.update({
      where: { id: grantId },
      data: { revokedAt: new Date() },
    })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: 'access.grant_revoked',
      resourceType: 'deliverable_access', resourceId: grantId,
      metadata: { stakeholderEmail: grant.stakeholder.email, runId: grant.runId },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send({ ok: true })
  })

  // ── POST /grants/:grantId/resend — resend access email with fresh token ───
  app.post('/grants/:grantId/resend', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { grantId } = req.params as { grantId: string }

    const grant = await prisma.deliverableAccess.findFirst({
      where: { id: grantId, agencyId },
      include: {
        stakeholder: { include: { client: true } },
        run: { include: { workflow: { select: { name: true } } } },
      },
    })
    if (!grant) return reply.code(404).send({ error: 'Access grant not found' })
    if (grant.revokedAt) return reply.code(400).send({ error: 'Cannot resend a revoked grant. Grant access again first.' })

    const token     = generateAccessToken()
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)

    await prisma.deliverableAccess.update({
      where: { id: grantId },
      data: { token, expiresAt },
    })

    const portalUrl = `${process.env.PORTAL_BASE_URL || 'http://localhost:5173'}/portal?token=${token}`
    await sendReviewEmail({
      to: { name: grant.stakeholder.name, email: grant.stakeholder.email },
      clientName: grant.stakeholder.client.name,
      workflowName: grant.run.workflow.name,
      portalUrl,
    })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: 'access.grant_resent',
      resourceType: 'deliverable_access', resourceId: grantId,
      metadata: { email: grant.stakeholder.email },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send({ ok: true, portalUrl })
  })
}
