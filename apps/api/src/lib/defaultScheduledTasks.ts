import { prisma } from '@contentnode/database'

function nextRunAt(frequency: string): Date {
  const now = new Date()
  if (frequency === 'daily')   return new Date(now.getTime() + 86_400_000)
  if (frequency === 'monthly') return new Date(now.getTime() + 30 * 86_400_000)
  return new Date(now.getTime() + 7 * 86_400_000)
}

const TEMPLATE_TASKS = [
  {
    type: 'research_brief',
    label: 'Industry Research Brief',
    frequency: 'weekly',
    config: {
      prompt: '',
      recencyDays: 7,
      synthesisFormat: '',
      apiKeyRef: 'TAVILY_API_KEY',
    },
  },
  {
    type: 'review_miner',
    label: 'Review Intelligence',
    frequency: 'weekly',
    config: {
      companyName: '',
      platforms: ['trustpilot', 'g2'],
      competitors: '',
      synthesis: 'competitive_battlecard',
    },
  },
  {
    type: 'audience_signal',
    label: 'Community Intelligence',
    frequency: 'weekly',
    config: {
      keywords: '',
      subreddits: '',
      goal: 'pain_points',
      minUpvotes: 5,
    },
  },
  {
    type: 'web_scrape',
    label: 'Competitor Website Monitor',
    frequency: 'weekly',
    config: {
      seedUrls: '',
      synthesisTarget: 'gtm_12',
      stayOnDomain: true,
      linkPattern: '',
    },
  },
  {
    type: 'seo_intent',
    label: 'SEO Intent Research',
    frequency: 'monthly',
    config: {
      seedKeywords: '',
      dataSource: 'claude',
      funnelFocus: 'all',
    },
  },
]

/**
 * Creates the 5 default disabled template tasks for a client.
 * Skips any type the client already has a task for (idempotent).
 */
export async function seedDefaultTasksForClient(
  agencyId: string,
  clientId: string,
): Promise<void> {
  // Find which task types this client already has
  const existing = await prisma.scheduledTask.findMany({
    where: { agencyId, clientId },
    select: { type: true },
  })
  const existingTypes = new Set(existing.map((t) => t.type))

  const toCreate = TEMPLATE_TASKS.filter((t) => !existingTypes.has(t.type))
  if (toCreate.length === 0) return

  await prisma.scheduledTask.createMany({
    data: toCreate.map((t) => ({
      agencyId,
      clientId,
      scope: 'client',
      type: t.type,
      label: t.label,
      frequency: t.frequency,
      config: t.config,
      enabled: false,
      nextRunAt: nextRunAt(t.frequency),
    })),
  })
}

/**
 * Backfill: seeds template tasks for every existing client in the agency
 * that is missing one or more of the 5 task types.
 * Safe to run multiple times.
 */
export async function seedDefaultTasksForAllClients(agencyId: string): Promise<number> {
  const clients = await prisma.client.findMany({
    where: { agencyId, status: { not: 'archived' } },
    select: { id: true },
  })

  let seeded = 0
  for (const client of clients) {
    const before = await prisma.scheduledTask.count({ where: { agencyId, clientId: client.id } })
    await seedDefaultTasksForClient(agencyId, client.id)
    const after = await prisma.scheduledTask.count({ where: { agencyId, clientId: client.id } })
    if (after > before) seeded++
  }
  return seeded
}
