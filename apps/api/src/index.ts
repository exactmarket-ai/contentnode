import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import { prisma } from '@contentnode/database'
import { authPlugin } from './plugins/auth.js'
import { workflowRoutes } from './routes/workflows.js'
import { clientRoutes } from './routes/clients.js'
import { nodeRoutes } from './routes/nodes.js'
import { runRoutes } from './routes/runs.js'
import { feedbackRoutes } from './routes/feedback.js'
import { transcriptionRoutes } from './routes/transcriptions.js'
import { insightRoutes } from './routes/insights.js'
import { documentRoutes } from './routes/documents.js'
import { portalRoutes } from './routes/portal.js'
import { writerRoutes } from './routes/writer.js'
import { usageRoutes } from './routes/usage.js'
import { qualityRoutes } from './routes/quality.js'
import { reportRoutes } from './routes/reports.js'
import { humanizerExampleRoutes } from './routes/humanizerExamples.js'
import { scheduleRoutes } from './routes/schedules.js'
import { calendarRoutes } from './routes/calendar.js'
import { teamRoutes } from './routes/team.js'
import { accessRoutes } from './routes/access.js'
import { settingsRoutes } from './routes/settings.js'
import { libraryRoutes } from './routes/library.js'
import { clientLibraryRoutes } from './routes/clientLibrary.js'
import { promptRoutes } from './routes/prompts.js'
import { instructionTranslatorRoutes } from './routes/instructionTranslator.js'
import { generatedFileRoutes } from './routes/generatedFiles.js'
import { referenceFileRoutes } from './routes/referenceFiles.js'
import { permissionRoutes } from './routes/permissions.js'
import { divisionRoutes } from './routes/divisions.js'
import { verticalRoutes } from './routes/verticals.js'
import { templateLibraryRoutes } from './routes/templateLibrary.js'
import { kitSessionRoutes } from './routes/kitSessions.js'
import { voiceProviderRoutes } from './routes/voiceProviders.js'
import { nodePilotRoutes }     from './routes/nodepilot.js'
import { demandPilotRoutes }    from './routes/demandpilot.js'
import { gtmPilotRoutes }       from './routes/gtmpilot.js'
import { productPilotRoutes }   from './routes/productpilot.js'
import { researchPilotRoutes }  from './routes/researchpilot.js'
import { taskPilotRoutes }      from './routes/taskpilot.js'
import { prospectAssessmentRoutes }   from './routes/prospectAssessments.js'
import { campaignRoutes }       from './routes/campaigns.js'
import { programRoutes }        from './routes/programs.js'
import { scheduledTaskRoutes }  from './routes/scheduledTasks.js'
import { topicQueueRoutes }     from './routes/topicQueue.js'
import { docTemplateRoutes }    from './routes/docTemplates.js'
import { leadershipRoutes }     from './routes/leadership.js'
import { notificationsRoutes }  from './routes/notifications.js'
import { contentGeneratorRoutes } from './routes/contentGenerator.js'
import { wrikeIntegrationRoutes }  from './routes/integrations/wrike.js'
import { mondayIntegrationRoutes } from './routes/integrations/monday.js'
import { boxIntegrationRoutes }          from './routes/integrations/box.js'
import { googleDriveIntegrationRoutes }  from './routes/integrations/googleDrive.js'
import { pipelineRoutes }               from './routes/pipeline.js'
import { deliverablesRoutes }           from './routes/deliverables.js'
import { myWorkRoutes }                 from './routes/myWork.js'
import { boxFileWebhookRoutes }         from './routes/webhooks/boxFile.js'
import { googleDriveWebhookRoutes }     from './routes/webhooks/googleDrive.js'
import { imagePromptRoutes }            from './routes/imagePrompts.js'
import { contentPackRoutes }            from './routes/contentPacks.js'
import { getRedis } from './lib/redis.js'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  bodyLimit: 500 * 1024 * 1024, // 500 MB
})

// ── Production safety guards ──────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && process.env.DEFAULT_ROLE) {
  throw new Error('[auth] DEFAULT_ROLE must never be set in production — it bypasses role enforcement for all users.')
}
if (process.env.NODE_ENV === 'production' && process.env.DEFAULT_AGENCY_ID) {
  throw new Error('[auth] DEFAULT_AGENCY_ID must never be set in production — it bypasses tenant isolation.')
}

// ── Security / middleware ──────────────────────────────────────────────────
await app.register(helmet)
await app.register(rateLimit, {
  global: false, // opt-in per-route, not global
})

// MEDIUM #9: In production, CORS_ORIGIN must be explicitly set
if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  throw new Error('[cors] CORS_ORIGIN environment variable must be set in production')
}
const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
  .split(',').map((o) => o.trim()).filter(Boolean)
await app.register(cors, {
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
  maxAge: 86400, // cache preflight 24h — eliminates OPTIONS round-trip on every API call
})
await app.register(multipart, {
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB (matches bodyLimit)
})

// ── Auth ──────────────────────────────────────────────────────────────────
await app.register(authPlugin)

// ── Health check (no auth required) ──────────────────────────────────────
app.get('/health', async (_req, reply) => {
  const checks: Record<string, 'ok' | 'error'> = {}

  // Database
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
  }

  // Redis
  try {
    const redis = getRedis()
    await redis.ping()
    checks.redis = 'ok'
  } catch {
    checks.redis = 'error'
  }

  const healthy = Object.values(checks).every((v) => v === 'ok')
  return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks })
})

// ── API routes ────────────────────────────────────────────────────────────
await app.register(workflowRoutes, { prefix: '/api/v1/workflows' })
await app.register(clientRoutes, { prefix: '/api/v1/clients' })
await app.register(nodeRoutes, { prefix: '/api/v1/nodes' })
await app.register(runRoutes, { prefix: '/api/v1/runs' })
await app.register(feedbackRoutes, { prefix: '/api/v1/feedback' })
await app.register(transcriptionRoutes, { prefix: '/api/v1/transcriptions' })
await app.register(insightRoutes, { prefix: '/api/v1/insights' })
await app.register(documentRoutes, { prefix: '/api/v1/documents' })
await app.register(portalRoutes,   { prefix: '/portal' })
// Writer portal — magic-link public endpoints
await app.register(writerRoutes,   { prefix: '/writer' })
// Writer portal — agency management endpoints (Clerk auth via normal flow)
await app.register(writerRoutes,   { prefix: '/api/v1/runs/:runId/writer' })
await app.register(usageRoutes,    { prefix: '/api/v1/usage' })
await app.register(qualityRoutes,  { prefix: '/api/v1/quality' })
await app.register(reportRoutes,   { prefix: '/api/v1/reports' })
await app.register(humanizerExampleRoutes, { prefix: '/api/v1/humanizer-examples' })
await app.register(scheduleRoutes,         { prefix: '/api/v1/workflows/:workflowId/schedules' })
await app.register(calendarRoutes,         { prefix: '/api/v1/calendar' })
await app.register(teamRoutes,             { prefix: '/api/v1/team' })
await app.register(accessRoutes,           { prefix: '/api/v1/access' })
await app.register(settingsRoutes,         { prefix: '/api/v1/settings' })
await app.register(libraryRoutes,          { prefix: '/api/v1/library' })
await app.register(clientLibraryRoutes,    { prefix: '/api/v1/clients/:clientId/library' })
await app.register(promptRoutes,           { prefix: '/api/v1/prompts' })
await app.register(instructionTranslatorRoutes, { prefix: '/api/v1/instruction-translator' })
// Reference file upload (images/videos for use as generation inputs)
await app.register(referenceFileRoutes, { prefix: '/api/v1/reference-files' })
// Generated asset serving — public, no auth, immutable cache
await app.register(generatedFileRoutes, { prefix: '/files' })
await app.register(permissionRoutes,    { prefix: '/api/v1/permissions' })
await app.register(divisionRoutes,      { prefix: '/api/v1/clients' })
await app.register(verticalRoutes,         { prefix: '/api/v1/verticals' })
await app.register(templateLibraryRoutes,  { prefix: '/api/v1/template-library' })
await app.register(voiceProviderRoutes,    { prefix: '/api/v1/voice-providers' })
await app.register(nodePilotRoutes,        { prefix: '/api/v1/nodepilot' })
await app.register(demandPilotRoutes,      { prefix: '/api/v1/demand-pilot' })
await app.register(gtmPilotRoutes,         { prefix: '/api/v1/gtm-pilot' })
await app.register(productPilotRoutes,    { prefix: '/api/v1/productpilot' })
await app.register(researchPilotRoutes,    { prefix: '/api/v1/research-pilot' })
await app.register(taskPilotRoutes,        { prefix: '/api/v1/task-pilot' })
await app.register(prospectAssessmentRoutes,   { prefix: '/api/v1/prospect-assessments' })
await app.register(campaignRoutes,         { prefix: '/api/v1/campaigns' })
await app.register(programRoutes,          { prefix: '/api/v1/programs' })
await app.register(scheduledTaskRoutes,    { prefix: '/api/v1/scheduled-tasks' })
await app.register(topicQueueRoutes,       { prefix: '/api/v1/topic-queue' })
await app.register(docTemplateRoutes,      { prefix: '/api/v1/doc-templates' })
await app.register(leadershipRoutes,         { prefix: '/api/v1/leadership' })
await app.register(notificationsRoutes,      { prefix: '/api/v1/notifications' })
await app.register(contentGeneratorRoutes,   { prefix: '/api/v1/content-generator' })
await app.register(wrikeIntegrationRoutes,   { prefix: '/api/v1/integrations/wrike' })
await app.register(mondayIntegrationRoutes,  { prefix: '/api/v1/integrations/monday' })
await app.register(boxIntegrationRoutes,          { prefix: '/api/v1/integrations/box' })
await app.register(googleDriveIntegrationRoutes,  { prefix: '/api/v1/integrations/google-drive' })
await app.register(pipelineRoutes,                { prefix: '/api/v1/pipeline' })
await app.register(deliverablesRoutes,            { prefix: '/api/v1/deliverables' })
await app.register(myWorkRoutes,                  { prefix: '/api/v1/my-work' })
await app.register(kitSessionRoutes,              { prefix: '/api/v1/kit-sessions' })
// Storage webhooks — public (no auth), verified by respective secrets
await app.register(boxFileWebhookRoutes,          { prefix: '/api/v1/webhooks/box-file' })
await app.register(googleDriveWebhookRoutes,      { prefix: '/api/v1/webhooks/google-drive' })
await app.register(imagePromptRoutes,        { prefix: '/api/v1/image-prompts' })
await app.register(contentPackRoutes,        { prefix: '/api/v1/content-packs' })

// ── Start ─────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
