/**
 * regen-asset05.mjs
 * Re-queues Asset 05 (Customer Deck) generation for a specific kit session.
 * Run with: ! DATABASE_URL=<url> REDIS_URL=<url> AGENCY_ID=<id> node scripts/regen-asset05.mjs
 *
 * If AGENCY_ID is not provided, the script lists all delivery-state sessions across all agencies.
 */
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'
import { createClient } from 'ioredis'

const prisma = new PrismaClient()

async function main() {
  const agencyId = process.env.AGENCY_ID
  const sessionId = process.env.SESSION_ID

  // Find the target session(s)
  let sessions
  if (sessionId) {
    const s = await prisma.kitSession.findUnique({ where: { id: sessionId } })
    sessions = s ? [s] : []
  } else {
    sessions = await prisma.kitSession.findMany({
      where: {
        status: 'delivery',
        ...(agencyId ? { agencyId } : {}),
      },
      include: { client: { select: { name: true } }, vertical: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    })
  }

  if (!sessions.length) {
    console.log('No matching sessions found.')
    return
  }

  if (!sessionId && sessions.length > 1) {
    console.log('Multiple sessions found. Pass SESSION_ID=<id> to target one:')
    for (const s of sessions) {
      console.log(`  ${s.id}  ${s.client?.name ?? '?'} / ${s.vertical?.name ?? '?'}  (updated ${s.updatedAt.toISOString()})`)
    }
    return
  }

  const target = sessions[0]
  console.log(`Target session: ${target.id}  ${target.client?.name ?? ''} / ${target.vertical?.name ?? ''}`)

  // Patch asset[4] to 'pending' without touching other assets
  const files = (target.generatedFiles ?? {})
  const assets = files.assets ?? []
  if (!assets[4]) {
    console.error('Asset 4 not found in session generatedFiles.')
    return
  }

  const prevStatus = assets[4].status
  assets[4] = { ...assets[4], status: 'pending', content: undefined, error: undefined, completedAt: undefined }

  await prisma.kitSession.update({
    where: { id: target.id },
    data: {
      status: 'generating',
      currentAsset: 4,
      generatedFiles: { ...files, assets },
    },
  })
  console.log(`Asset 04 patched: ${prevStatus} → pending`)

  // Enqueue the generation job
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('REDIS_URL not set — cannot enqueue job. Session is already patched in DB.')
    return
  }

  const prefix = process.env.QUEUE_PREFIX ?? 'cn'
  const connection = { url: redisUrl, maxRetriesPerRequest: null }
  const queue = new Queue(`${prefix}:kit-generation`, { connection })

  await queue.add(
    'generate-asset',
    { sessionId: target.id, agencyId: target.agencyId, assetIndex: 4 },
    { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } },
  )
  console.log('Generation job enqueued for asset 04 (Customer Deck).')

  await queue.close()
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1) })
