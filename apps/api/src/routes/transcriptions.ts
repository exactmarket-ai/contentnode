import { pipeline } from 'node:stream/promises'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { auditService } from '../services/audit.js'
import { getWorkflowRunsQueue } from '../lib/queues.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })

const ALLOWED_AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac'])

// ─── Schemas ──────────────────────────────────────────────────────────────────

const speakerAssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      speaker: z.string(),                         // raw diarization label e.g. "0", "1"
      speakerName: z.string().min(1),              // display name chosen by user
      stakeholderId: z.string().nullable(),        // null = not a client stakeholder
      isAgencyParticipant: z.boolean().default(false),
    }),
  ),
})

const feedbackQuoteSchema = z.object({
  segmentId: z.string().min(1),
  quoteText: z.string().min(1),
  category: z.enum([
    'pain_point',
    'desire',
    'objection',
    'insight',
    'action_item',
    'source_material',
    'other',
  ]),
  stakeholderId: z.string().min(1),  // derived from the segment's assigned speaker
})

// ─────────────────────────────────────────────────────────────────────────────

export async function transcriptionRoutes(app: FastifyInstance) {

  // ── POST / — upload audio and start transcription ────────────────────────
  // This endpoint handles direct audio uploads outside of a workflow run.
  // Workflow-triggered transcriptions go through the node executor instead.
  app.post('/', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const query = req.query as {
      clientId?: string
      provider?: string
      enableDiarization?: string
      maxSpeakers?: string
      stakeholderId?: string
    }

    const clientId = query.clientId
    if (!clientId) {
      return reply.code(400).send({ error: 'clientId is required' })
    }

    // Verify client belongs to this agency
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No audio file uploaded' })

    const { filename, file } = data
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if (!ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
      file.resume()
      return reply.code(400).send({
        error: `Unsupported audio format .${ext}. Allowed: ${[...ALLOWED_AUDIO_EXTENSIONS].join(', ')}`,
      })
    }

    const fileId = randomUUID()
    const storageKey = `${fileId}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const filePath = join(UPLOAD_DIR, storageKey)

    try {
      await pipeline(file, createWriteStream(filePath))
    } catch (err) {
      app.log.error(err, 'Failed to write audio file')
      return reply.code(500).send({ error: 'Failed to store audio file' })
    }

    // Create session record
    const session = await prisma.transcriptSession.create({
      data: {
        agencyId,
        clientId,
        stakeholderId: query.stakeholderId ?? undefined,
        title: `Transcription — ${filename}`,
        recordingUrl: storageKey,
        status: 'processing',
        metadata: {
          provider: query.provider ?? 'local',
          originalFilename: filename,
          enableDiarization: query.enableDiarization !== 'false',
          maxSpeakers: query.maxSpeakers ? parseInt(query.maxSpeakers, 10) : null,
          audioFileId: fileId,
          storageKey,
        },
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'transcript.session.created',
      resourceType: 'TranscriptSession',
      resourceId: session.id,
      metadata: { clientId, filename },
    })

    // TODO: enqueue QUEUE_TRANSCRIPTION job for async processing
    // For now, return 202 and let the caller poll for status.

    return reply.code(202).send({
      data: {
        sessionId: session.id,
        status: session.status,
        clientId,
      },
    })
  })

  // ── GET / — list sessions for the agency ────────────────────────────────
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const query = req.query as { clientId?: string; limit?: string; offset?: string }

    const sessions = await prisma.transcriptSession.findMany({
      where: {
        agencyId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(query.limit ?? '20', 10), 100),
      skip: parseInt(query.offset ?? '0', 10),
      select: {
        id: true,
        clientId: true,
        title: true,
        status: true,
        durationSecs: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return reply.send({ data: sessions, meta: { count: sessions.length } })
  })

  // ── GET /:id — poll status and return session detail ─────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { agencyId } = req.auth
    const { id } = req.params

    const session = await prisma.transcriptSession.findFirst({
      where: { id, agencyId },
      include: {
        segments: {
          orderBy: { startMs: 'asc' },
          select: {
            id: true,
            speaker: true,
            speakerName: true,
            stakeholderId: true,
            isAgencyParticipant: true,
            audioClipKey: true,
            startMs: true,
            endMs: true,
            text: true,
          },
        },
      },
    })

    if (!session) return reply.code(404).send({ error: 'Transcript session not found' })

    // Group segments by speaker for the assignment UI
    const speakerMap = new Map<string, {
      speaker: string
      audioClipKey: string | null
      speakerName: string | null
      stakeholderId: string | null
      isAgencyParticipant: boolean
      segments: typeof session.segments
    }>()

    for (const seg of session.segments) {
      const key = seg.speaker ?? 'unknown'
      if (!speakerMap.has(key)) {
        speakerMap.set(key, {
          speaker: key,
          audioClipKey: seg.audioClipKey,
          speakerName: seg.speakerName,
          stakeholderId: seg.stakeholderId,
          isAgencyParticipant: seg.isAgencyParticipant,
          segments: [],
        })
      }
      speakerMap.get(key)!.segments.push(seg)
    }

    // Fetch stakeholders for this client (for the assignment dropdown)
    const stakeholders = await prisma.stakeholder.findMany({
      where: { clientId: session.clientId, agencyId },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })

    return reply.send({
      data: {
        id: session.id,
        clientId: session.clientId,
        title: session.title,
        status: session.status,
        durationSecs: session.durationSecs,
        workflowRunId: session.workflowRunId,
        metadata: session.metadata,
        speakers: [...speakerMap.values()],
        segments: session.segments,  // flat list for transcript view
        stakeholders,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    })
  })

  // ── PATCH /:id/assign — submit speaker assignments ────────────────────────
  app.patch<{ Params: { id: string } }>('/:id/assign', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id } = req.params

    const parsed = speakerAssignmentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid assignments', details: parsed.error.issues })
    }
    const { assignments } = parsed.data

    const session = await prisma.transcriptSession.findFirst({
      where: { id, agencyId },
    })
    if (!session) return reply.code(404).send({ error: 'Transcript session not found' })

    if (session.status !== 'awaiting_assignment') {
      return reply.code(422).send({
        error: `Session is not awaiting assignment (current status: ${session.status})`,
      })
    }

    // Update each segment with the assignment for its speaker label
    for (const assignment of assignments) {
      await prisma.transcriptSegment.updateMany({
        where: { sessionId: id, speaker: assignment.speaker },
        data: {
          speakerName: assignment.speakerName,
          stakeholderId: assignment.stakeholderId ?? null,
          isAgencyParticipant: assignment.isAgencyParticipant,
        },
      })
    }

    // Mark session as ready
    await prisma.transcriptSession.update({
      where: { id },
      data: { status: 'ready' },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'transcript.speakers.assigned',
      resourceType: 'TranscriptSession',
      resourceId: id,
      metadata: { speakerCount: assignments.length },
    })

    // If this session was triggered by a workflow run, re-enqueue the run to continue
    if (session.workflowRunId) {
      const run = await prisma.workflowRun.findFirst({
        where: { id: session.workflowRunId, agencyId },
      })
      if (run && run.status === 'awaiting_assignment') {
        const queue = getWorkflowRunsQueue()
        await queue.add(
          'run-workflow',
          { workflowRunId: session.workflowRunId, agencyId },
          { jobId: `${session.workflowRunId}-resume-${Date.now()}` },
        )
      }
    }

    return reply.send({ data: { sessionId: id, status: 'ready' } })
  })

  // ── POST /:id/feedback — extract a quote as a Feedback record ─────────────
  app.post<{ Params: { id: string } }>('/:id/feedback', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id } = req.params

    const parsed = feedbackQuoteSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid feedback data', details: parsed.error.issues })
    }
    const { segmentId, quoteText, category, stakeholderId } = parsed.data

    const session = await prisma.transcriptSession.findFirst({
      where: { id, agencyId },
    })
    if (!session) return reply.code(404).send({ error: 'Transcript session not found' })

    if (session.status !== 'ready') {
      return reply.code(422).send({ error: 'Speaker assignment must be completed before extracting quotes' })
    }

    // Verify segment belongs to this session
    const segment = await prisma.transcriptSegment.findFirst({
      where: { id: segmentId, sessionId: id },
    })
    if (!segment) return reply.code(404).send({ error: 'Segment not found' })

    // Verify stakeholder belongs to this agency
    const stakeholder = await prisma.stakeholder.findFirst({
      where: { id: stakeholderId, agencyId },
    })
    if (!stakeholder) return reply.code(404).send({ error: 'Stakeholder not found' })

    const feedback = await prisma.feedback.create({
      data: {
        agencyId,
        stakeholderId,
        transcriptSessionId: id,
        transcriptSegmentId: segmentId,
        quoteText,
        category,
        // decision is null for transcript-sourced feedback
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'transcript.quote.extracted',
      resourceType: 'Feedback',
      resourceId: feedback.id,
      metadata: { sessionId: id, segmentId, category },
    })

    return reply.code(201).send({
      data: {
        id: feedback.id,
        sessionId: id,
        segmentId,
        quoteText,
        category,
        stakeholderId,
        createdAt: feedback.createdAt,
      },
    })
  })

  // ── POST /:id/stakeholders — create a stakeholder inline during assignment ─
  app.post<{ Params: { id: string } }>('/:id/stakeholders', async (req, reply) => {
    const { agencyId, userId } = req.auth
    const { id } = req.params

    const body = req.body as { name?: string; email?: string; role?: string }
    if (!body.name || !body.email) {
      return reply.code(400).send({ error: 'name and email are required' })
    }

    const session = await prisma.transcriptSession.findFirst({
      where: { id, agencyId },
    })
    if (!session) return reply.code(404).send({ error: 'Transcript session not found' })

    // Check for existing stakeholder
    const existing = await prisma.stakeholder.findFirst({
      where: { clientId: session.clientId, email: body.email },
    })
    if (existing) {
      return reply.send({ data: existing })
    }

    const stakeholder = await prisma.stakeholder.create({
      data: {
        agencyId,
        clientId: session.clientId,
        name: body.name,
        email: body.email,
        role: body.role ?? undefined,
      },
    })

    await auditService.log(agencyId, {
      actorType: 'user',
      actorId: userId,
      action: 'stakeholder.created',
      resourceType: 'Stakeholder',
      resourceId: stakeholder.id,
      metadata: { source: 'transcript_assignment', sessionId: id },
    })

    return reply.code(201).send({ data: stakeholder })
  })
}
