/**
 * regen-asset.mjs — Re-queues a single kit asset for regeneration.
 *
 * Usage:
 *   DATABASE_URL=<url> REDIS_URL=<url> ASSET_INDEX=0 node scripts/regen-asset05.mjs
 *   DATABASE_URL=<url> REDIS_URL=<url> ASSET_INDEX=4 SESSION_ID=<id> node scripts/regen-asset05.mjs
 *   DATABASE_URL=<url> REDIS_URL=<url> ASSET_INDEX=0 AGENCY_ID=<id> node scripts/regen-asset05.mjs
 *
 * ASSET_INDEX: 0=Brochure, 1=eBook, 2=Cheat Sheet, 3=BDR Emails,
 *              4=Customer Deck, 5=Video Script, 6=Web Page, 7=Internal Brief
 *
 * If multiple sessions are found, the script lists them and exits without
 * making any changes — re-run with SESSION_ID=<id> to target one.
 */
import { PrismaClient } from '@prisma/client'
import { Queue } from 'bullmq'

const prisma = new PrismaClient()

const ASSET_NAMES = ['Brochure','eBook','Sales Cheat Sheet','BDR Emails','Customer Deck','Video Script','Web Page Copy','Internal Brief']

async function main() {
  const agencyId   = process.env.AGENCY_ID
  const sessionId  = process.env.SESSION_ID
  const assetIndex = parseInt(process.env.ASSET_INDEX ?? '0', 10)

  if (isNaN(assetIndex) || assetIndex < 0 || assetIndex > 7) {
    console.error('ASSET_INDEX must be 0–7. Defaulting to 0 (Brochure).')
    process.exit(1)
  }

  console.log(`Target asset: ${assetIndex} — ${ASSET_NAMES[assetIndex]}`)

  // Find the target session(s)
  let sessions
  if (sessionId) {
    const s = await prisma.kitSession.findUnique({
      where: { id: sessionId },
      include: { client: { select: { name: true } }, vertical: { select: { name: true } } },
    })
    sessions = s ? [s] : []
  } else {
    sessions = await prisma.kitSession.findMany({
      where: { status: { in: ['delivery', 'generating', 'error'] }, ...(agencyId ? { agencyId } : {}) },
      include: { client: { select: { name: true } }, vertical: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    })
  }

  if (!sessions.length) {
    console.log('No matching sessions found.')
    return
  }

  if (!sessionId && sessions.length > 1) {
    console.log('Multiple sessions found — pass SESSION_ID=<id> to target one:')
    for (const s of sessions) {
      const assetStatus = ((s.generatedFiles)?.assets?.[assetIndex])?.status ?? 'unknown'
      console.log(`  ${s.id}  ${s.client?.name ?? '?'} / ${s.vertical?.name ?? '?'}  asset[${assetIndex}]=${assetStatus}  (updated ${s.updatedAt.toISOString()})`)
    }
    return
  }

  const target = sessions[0]
  console.log(`Session: ${target.id}  ${target.client?.name ?? ''} / ${target.vertical?.name ?? ''}`)

  const files  = (target.generatedFiles ?? {})
  const assets = Array.isArray(files.assets) ? [...files.assets] : []

  if (!assets[assetIndex]) {
    console.error(`Asset ${assetIndex} not found in session generatedFiles. Session may not have been initialised yet.`)
    return
  }

  const prevStatus = assets[assetIndex].status
  assets[assetIndex] = { ...assets[assetIndex], status: 'pending', content: undefined, error: undefined, completedAt: undefined }

  await prisma.kitSession.update({
    where: { id: target.id },
    data: { status: 'generating', currentAsset: assetIndex, generatedFiles: { ...files, assets } },
  })
  console.log(`Asset ${assetIndex} (${ASSET_NAMES[assetIndex]}) patched: ${prevStatus} → pending`)

  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.error('REDIS_URL not set — session patched in DB but job NOT enqueued. Set REDIS_URL and re-run.')
    return
  }

  const prefix = process.env.QUEUE_PREFIX ?? 'cn'
  const queue  = new Queue(`${prefix}:kit-generation`, { connection: { url: redisUrl, maxRetriesPerRequest: null } })

  await queue.add(
    'generate-asset',
    { sessionId: target.id, agencyId: target.agencyId, assetIndex },
    { removeOnComplete: { count: 50 }, removeOnFail: { count: 20 } },
  )
  console.log(`Job enqueued → asset ${assetIndex} (${ASSET_NAMES[assetIndex]}) will regenerate next.`)
  await queue.close()
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1) })
