import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '@contentnode/database'
import { requireRole } from '../plugins/auth.js'

// Providers that require an env var — keys used to check if they are configured
const PROVIDER_KEY_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
  google:    'GOOGLE_API_KEY',
  mistral:   'MISTRAL_API_KEY',
  groq:      'GROQ_API_KEY',
  ollama:    '', // local — no key needed
}

const VALID_PROVIDERS = new Set(Object.keys(PROVIDER_KEY_VARS))

export async function modelRegistryRoutes(app: FastifyInstance) {
  // ── GET / — list all registry entries ───────────────────────────────────────
  app.get('/', { preHandler: requireRole('owner', 'admin') }, async (_req, reply) => {
    const entries = await prisma.modelRegistry.findMany({ orderBy: { roleKey: 'asc' } })
    return reply.send({ data: entries })
  })

  // ── GET /provider-status — which providers have API keys configured ─────────
  // Reads env vars server-side and returns a map of provider → configured boolean.
  // Never returns the key values — only whether they are set.
  app.get('/provider-status', { preHandler: requireRole('owner', 'admin') }, async (_req, reply) => {
    const status: Record<string, boolean> = {}
    for (const [provider, envVar] of Object.entries(PROVIDER_KEY_VARS)) {
      status[provider] = envVar === '' ? true : Boolean(process.env[envVar])
    }
    return reply.send({ data: status })
  })

  // ── PATCH /:roleKey — update provider and model for a role ──────────────────
  const patchBody = z.object({
    provider: z.string().min(1),
    model:    z.string().min(1),
  })

  app.patch<{ Params: { roleKey: string }; Body: z.infer<typeof patchBody> }>(
    '/:roleKey',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const parsed = patchBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid body', details: parsed.error.issues })
      }

      const { provider, model } = parsed.data

      if (!VALID_PROVIDERS.has(provider)) {
        return reply.code(400).send({ error: `Unknown provider "${provider}"` })
      }

      const entry = await prisma.modelRegistry.findUnique({ where: { roleKey: req.params.roleKey } })
      if (!entry) {
        return reply.code(404).send({ error: `Registry role "${req.params.roleKey}" not found` })
      }

      const clerkUserId = req.auth?.userId ?? null

      const updated = await prisma.modelRegistry.update({
        where: { roleKey: req.params.roleKey },
        data: { provider, model, updatedById: clerkUserId },
      })

      return reply.send({ data: updated })
    }
  )
}
