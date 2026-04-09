import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, auditService } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'
import { sendTeamInviteEmail } from '../lib/email.js'
import { clerkClient, getClerkUserEmails, revokeUserSessions } from '../lib/clerk.js'

const INVITE_TTL_DAYS = 7

function generateInviteToken() {
  return crypto.randomBytes(32).toString('hex')
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const inviteBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'lead', 'member']).default('member'),
})

const updateRoleBody = z.object({
  role: z.enum(['owner', 'admin', 'lead', 'member']),
})

const updateProfileBody = z.object({
  name:       z.string().min(1).max(100).optional(),
  title:      z.string().max(100).nullable().optional(),
  department: z.string().max(100).nullable().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchInviteEmail(
  agencyId: string,
  inviterClerkId: string,
  member: { name: string | null; email: string; role: string; inviteToken: string | null },
  log: FastifyInstance['log'],
) {
  const agency  = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } })
  const inviter = await prisma.user.findFirst({ where: { agencyId, clerkUserId: inviterClerkId }, select: { name: true, email: true } })
  const base    = process.env.FRONTEND_URL || 'http://localhost:5173'
  const inviteUrl = `${base}/accept-invite?token=${member.inviteToken}`

  sendTeamInviteEmail({
    to: { name: member.name ?? member.email, email: member.email },
    invitedByName: inviter?.name ?? inviter?.email ?? 'Your team',
    agencyName: agency?.name ?? 'your organization',
    role: member.role,
    loginUrl: inviteUrl,
  }).catch((err) => log.error({ err }, '[team] invite email failed'))
}

function memberView(m: {
  id: string; clerkUserId: string; email: string; name: string | null
  title?: string | null; department?: string | null
  role: string; createdAt: Date; inviteToken: string | null; inviteExpiresAt: Date | null
  lastActiveAt?: Date | null
}) {
  return {
    id: m.id,
    email: m.email,
    name: m.name,
    title: m.title ?? null,
    department: m.department ?? null,
    role: m.role,
    createdAt: m.createdAt,
    lastActiveAt: m.lastActiveAt ?? null,
    pending: !!m.inviteToken,
    inviteExpired: m.inviteExpiresAt ? m.inviteExpiresAt < new Date() : false,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function teamRoutes(app: FastifyInstance) {

  // ── GET / — list team members ──────────────────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth

    const members = await prisma.user.findMany({
      where: { agencyId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, clerkUserId: true, email: true, name: true, title: true, department: true,
        role: true, createdAt: true, inviteToken: true, inviteExpiresAt: true, lastActiveAt: true,
      },
    })

    return reply.send({ data: members.map(memberView) })
  })

  // ── POST /invite ───────────────────────────────────────────────────────────
  app.post('/invite', {
    preHandler: requireRole('owner', 'admin'),
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const body = inviteBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() })

    const { email, name, role } = body.data

    const existing = await prisma.user.findFirst({ where: { agencyId, email } })
    if (existing) {
      return reply.code(409).send({ error: 'A team member with this email already exists.' })
    }

    const inviteToken     = generateInviteToken()
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

    const member = await prisma.user.create({
      data: {
        agencyId,
        clerkUserId: `pending-${crypto.randomBytes(16).toString('hex')}`,
        email, name, role, inviteToken, inviteExpiresAt,
      },
      select: {
        id: true, clerkUserId: true, email: true, name: true,
        role: true, createdAt: true, inviteToken: true, inviteExpiresAt: true,
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'team.invite_sent',
      resourceType: 'user',
      resourceId: member.id,
      metadata: { email, role },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })

    await dispatchInviteEmail(agencyId, userId, member, req.log)

    return reply.code(201).send({ data: memberView(member) })
  })

  // ── POST /:memberId/resend-invite ──────────────────────────────────────────
  app.post('/:memberId/resend-invite', {
    preHandler: requireRole('owner', 'admin'),
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { memberId } = req.params as { memberId: string }

    const member = await prisma.user.findFirst({ where: { id: memberId, agencyId } })
    if (!member) return reply.code(404).send({ error: 'Member not found.' })
    if (!member.inviteToken) {
      return reply.code(400).send({ error: 'Member has already accepted their invitation.' })
    }

    // Refresh token and expiry
    const inviteToken     = generateInviteToken()
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
    const updated = await prisma.user.update({
      where: { id: memberId },
      data: { inviteToken, inviteExpiresAt },
      select: {
        id: true, clerkUserId: true, email: true, name: true,
        role: true, createdAt: true, inviteToken: true, inviteExpiresAt: true,
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: 'team.invite_resent',
      resourceType: 'user', resourceId: memberId,
      metadata: { email: member.email },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    await dispatchInviteEmail(agencyId, userId, updated, req.log)
    return reply.send({ ok: true })
  })

  // ── GET /accept-invite/:token — validate token (public) ───────────────────
  app.get('/accept-invite/:token', {
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const { token } = req.params as { token: string }

    const invite = await prisma.user.findUnique({
      where: { inviteToken: token },
      select: { id: true, email: true, name: true, role: true, inviteExpiresAt: true, agencyId: true },
    })

    if (!invite) return reply.code(404).send({ error: 'Invite not found or already used.' })
    if (invite.inviteExpiresAt && invite.inviteExpiresAt < new Date()) {
      return reply.code(410).send({ error: 'This invite link has expired. Ask an admin to resend it.' })
    }

    const agency = await prisma.agency.findUnique({ where: { id: invite.agencyId }, select: { name: true } })

    return reply.send({
      data: {
        email: invite.email,
        name: invite.name,
        role: invite.role,
        agencyName: agency?.name ?? 'your organization',
        expiresAt: invite.inviteExpiresAt,
      },
    })
  })

  // ── POST /accept-invite/:token — accept invite (requires Clerk auth) ───────
  app.post('/accept-invite/:token', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const { token } = req.params as { token: string }

    if (!req.auth) {
      return reply.code(401).send({ error: 'You must be signed in to accept this invite.' })
    }

    const { userId } = req.auth

    const invite = await prisma.user.findUnique({
      where: { inviteToken: token },
      select: { id: true, email: true, agencyId: true, inviteExpiresAt: true },
    })

    if (!invite) return reply.code(404).send({ error: 'Invite not found or already used.' })
    if (invite.inviteExpiresAt && invite.inviteExpiresAt < new Date()) {
      return reply.code(410).send({ error: 'This invite link has expired. Ask an admin to resend it.' })
    }

    // ── Fix #1: Verify the signed-in user's email matches the invite ─────────
    const clerkEmails = await getClerkUserEmails(userId)
    if (clerkEmails.length > 0 && !clerkEmails.includes(invite.email.toLowerCase())) {
      return reply.code(403).send({
        error: `This invite is for ${invite.email}. You are signed in with a different account.`,
      })
    }

    // Check not already a member under a different record
    const existingMembership = await prisma.user.findFirst({
      where: { agencyId: invite.agencyId, clerkUserId: userId, NOT: { id: invite.id } },
    })
    if (existingMembership) {
      return reply.code(409).send({ error: 'You are already a member of this organization.' })
    }

    // Activate: replace pending clerkUserId, clear invite token (single-use)
    const activated = await prisma.user.update({
      where: { id: invite.id },
      data: { clerkUserId: userId, inviteToken: null, inviteExpiresAt: null },
      select: { id: true, email: true, name: true, role: true, agencyId: true },
    })

    await auditService.log(invite.agencyId, {
      actorType: 'user', actorId: userId,
      action: 'team.invite_accepted',
      resourceType: 'user', resourceId: invite.id,
      metadata: { email: invite.email },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    req.log.info({ agencyId: invite.agencyId, userId, email: invite.email }, '[team] invite accepted')
    return reply.send({ data: activated })
  })

  // ── PATCH /:memberId — update role or profile (name / title / department) ──
  app.patch('/:memberId', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { memberId } = req.params as { memberId: string }
    const rawBody = req.body as Record<string, unknown>

    const member = await prisma.user.findFirst({ where: { id: memberId, agencyId } })
    if (!member) return reply.code(404).send({ error: 'Member not found.' })

    const updateData: Record<string, unknown> = {}

    // ── Role change ─────────────────────────────────────────────────────────
    if ('role' in rawBody) {
      const roleBody = updateRoleBody.safeParse(rawBody)
      if (!roleBody.success) return reply.code(400).send({ error: roleBody.error.flatten() })

      const { role } = roleBody.data
      if (member.clerkUserId === userId) {
        return reply.code(400).send({ error: 'You cannot change your own role.' })
      }
      if (role === 'owner' && req.auth.role !== 'owner') {
        return reply.code(403).send({ error: 'Only owners can assign the owner role.' })
      }

      await auditService.log(agencyId, {
        actorType: 'user', actorId: userId,
        action: 'team.role_changed',
        resourceType: 'user', resourceId: memberId,
        metadata: { email: member.email, previousRole: member.role, newRole: role },
        ip: req.ip, userAgent: req.headers['user-agent'],
      })

      updateData.role = role
    }

    // ── Profile fields ───────────────────────────────────────────────────────
    if ('name' in rawBody || 'title' in rawBody || 'department' in rawBody) {
      const profileBody = updateProfileBody.safeParse(rawBody)
      if (!profileBody.success) return reply.code(400).send({ error: profileBody.error.flatten() })

      if (profileBody.data.name       !== undefined) updateData.name       = profileBody.data.name
      if (profileBody.data.title      !== undefined) updateData.title      = profileBody.data.title
      if (profileBody.data.department !== undefined) updateData.department = profileBody.data.department

      await auditService.log(agencyId, {
        actorType: 'user', actorId: userId,
        action: 'team.profile_updated',
        resourceType: 'user', resourceId: memberId,
        metadata: { email: member.email, fields: Object.keys(profileBody.data) },
        ip: req.ip, userAgent: req.headers['user-agent'],
      })
    }

    if (Object.keys(updateData).length === 0) {
      return reply.code(400).send({ error: 'No valid fields to update.' })
    }

    const updated = await prisma.user.update({
      where: { id: memberId },
      data: updateData,
      select: { id: true, email: true, name: true, title: true, department: true, role: true, createdAt: true },
    })

    return reply.send({ data: updated })
  })

  // ── GET /:memberId/history — activity history for a team member ────────────
  app.get('/:memberId/history', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId } = req.auth
    const { memberId } = req.params as { memberId: string }
    const query = req.query as { limit?: string; offset?: string }

    const member = await prisma.user.findFirst({
      where: { id: memberId, agencyId },
      select: { id: true, email: true, name: true, title: true, department: true, role: true, clerkUserId: true, createdAt: true },
    })
    if (!member) return reply.code(404).send({ error: 'Member not found.' })

    const limit  = Math.min(Math.max(1, parseInt(query.limit  ?? '50', 10)), 200)
    const offset = Math.max(0, parseInt(query.offset ?? '0', 10))

    // Audit log entries where this user was the actor
    const [auditEntries, totalAuditCount] = await Promise.all([
      prisma.auditLog.findMany({
        where: { agencyId, actorType: 'user', actorId: member.clerkUserId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({
        where: { agencyId, actorType: 'user', actorId: member.clerkUserId },
      }),
    ])

    // Runs they triggered
    const recentRuns = await prisma.workflowRun.findMany({
      where: { agencyId, triggeredBy: member.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, status: true, createdAt: true,
        workflow: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
      },
    })

    // Clients this member has touched (via runs they triggered)
    const clientsWorkedWith = await prisma.workflowRun.findMany({
      where: { agencyId, triggeredBy: member.id },
      select: { workflow: { select: { client: { select: { id: true, name: true } } } } },
      distinct: ['workflowId'],
    })

    const uniqueClients = Array.from(
      new Map(
        clientsWorkedWith
          .filter((r) => r.workflow?.client)
          .map((r) => [r.workflow!.client!.id, r.workflow!.client!])
      ).values()
    )

    // Summary stats
    const [
      totalRuns,
      accessGrantsGiven,
      templatesCreated,
      feedbackEntered,
      contentReviewed,
      lastRunRecord,
    ] = await Promise.all([
      prisma.workflowRun.count({ where: { agencyId, triggeredBy: member.id } }),
      prisma.auditLog.count({
        where: { agencyId, actorType: 'user', actorId: member.clerkUserId, action: 'access.grant_created' },
      }),
      prisma.auditLog.count({
        where: { agencyId, actorType: 'user', actorId: member.clerkUserId, action: 'workflow.promoted_template' },
      }),
      prisma.auditLog.count({
        where: { agencyId, actorType: 'user', actorId: member.clerkUserId, action: 'feedback.created' },
      }),
      prisma.auditLog.count({
        where: { agencyId, actorType: 'user', actorId: member.clerkUserId, action: { startsWith: 'workflow.run' } },
      }),
      prisma.workflowRun.findFirst({
        where: { agencyId, triggeredBy: member.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ])

    // Last active: use lastActiveAt from user record (updated by auth middleware)
    const userRecord = await prisma.user.findFirst({
      where: { id: member.id },
      select: { lastActiveAt: true },
    })

    return reply.send({
      data: {
        member: { ...member, lastActiveAt: userRecord?.lastActiveAt ?? null },
        stats: {
          totalRuns,
          clientsWorkedWith: uniqueClients.length,
          accessGrantsGiven,
          totalAuditActions: totalAuditCount,
          templatesCreated,
          feedbackEntered,
          contentReviewed,
          lastWorkflowRunAt: lastRunRecord?.createdAt ?? null,
          lastActiveAt: userRecord?.lastActiveAt ?? null,
        },
        recentRuns,
        clientsWorkedWith: uniqueClients,
        activity: auditEntries,
        meta: { total: totalAuditCount, limit, offset },
      },
    })
  })

  // ── POST /:memberId/sync-clerk — activate pending member by Clerk lookup ────
  app.post('/:memberId/sync-clerk', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { memberId } = req.params as { memberId: string }

    const member = await prisma.user.findFirst({ where: { id: memberId, agencyId } })
    if (!member) return reply.code(404).send({ error: 'Member not found.' })
    if (!member.inviteToken) return reply.code(400).send({ error: 'Member is already active.' })

    if (!clerkClient) {
      return reply.code(503).send({ error: 'Clerk not configured — cannot look up user.' })
    }

    // Look up the user in Clerk by email
    const clerkUsers = await clerkClient.users.getUserList({ emailAddress: [member.email] })
    if (clerkUsers.data.length === 0) {
      return reply.code(404).send({ error: 'No Clerk account found for this email. The user must sign up first, then click the invite link.' })
    }

    const clerkUser = clerkUsers.data[0]

    // Check no other DB record already uses this Clerk account in this org
    const conflict = await prisma.user.findFirst({
      where: { agencyId, clerkUserId: clerkUser.id, NOT: { id: memberId } },
    })
    if (conflict) {
      return reply.code(409).send({ error: 'This Clerk account is already linked to another team member.' })
    }

    const activated = await prisma.user.update({
      where: { id: memberId },
      data: { clerkUserId: clerkUser.id, inviteToken: null, inviteExpiresAt: null },
      select: {
        id: true, clerkUserId: true, email: true, name: true,
        title: true, department: true, role: true, createdAt: true,
        inviteToken: true, inviteExpiresAt: true,
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: 'team.member_activated',
      resourceType: 'user', resourceId: memberId,
      metadata: { email: member.email, method: 'admin_clerk_sync' },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    return reply.send({ data: memberView(activated) })
  })

  // ── DELETE /:memberId — remove team member ─────────────────────────────────
  app.delete('/:memberId', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { memberId } = req.params as { memberId: string }

    const member = await prisma.user.findFirst({ where: { id: memberId, agencyId } })
    if (!member) return reply.code(404).send({ error: 'Member not found.' })

    if (member.clerkUserId === userId) {
      return reply.code(400).send({ error: 'You cannot remove yourself.' })
    }
    if (member.role === 'owner') {
      const ownerCount = await prisma.user.count({ where: { agencyId, role: 'owner' } })
      if (ownerCount <= 1) {
        return reply.code(400).send({ error: 'Cannot remove the last owner.' })
      }
    }

    await prisma.user.delete({ where: { id: memberId } })

    await auditService.log(agencyId, {
      actorType: 'user', actorId: userId,
      action: 'team.member_removed',
      resourceType: 'user', resourceId: memberId,
      metadata: { email: member.email, role: member.role },
      ip: req.ip, userAgent: req.headers['user-agent'],
    })

    // ── Fix #6: Revoke all active Clerk sessions immediately ─────────────────
    await revokeUserSessions(member.clerkUserId)

    return reply.code(204).send()
  })

  // ── GET /me — current user's profile and role ──────────────────────────────
  app.get('/me', async (req, reply) => {
    const { agencyId, userId } = req.auth

    const me = await prisma.user.findFirst({
      where: { agencyId, clerkUserId: userId },
      select: { id: true, email: true, name: true, title: true, department: true, role: true, createdAt: true },
    })

    if (!me) {
      // User is authenticated with Clerk but has no DB record for this org yet
      return reply.code(404).send({ error: 'User not found in this organization.' })
    }

    return reply.send({ data: me })
  })
}
