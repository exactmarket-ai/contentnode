import type { FastifyInstance } from 'fastify'
import { prisma, usageQueryService } from '@contentnode/database'
import type { UsageFilters } from '@contentnode/database'
import { getClerkUserNames } from '../lib/clerk.js'

function currentPeriod() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

function last30DayBuckets() {
  const buckets: { date: string; start: Date; end: Date }[] = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
    buckets.push({ date: start.toISOString().slice(0, 10), start, end })
  }
  return buckets
}

export async function usageRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const { agencyId } = req.auth
    const { start: periodStart, end: periodEnd } = currentPeriod()

    // Fetch all usage records for the period in one shot
    const allRecords = await prisma.usageRecord.findMany({
      where: { agencyId, periodStart: { gte: periodStart } },
    })

    // ── AI / LLM tokens ──────────────────────────────────────────────────────
    const tokenRecords = allRecords.filter((r) => r.metric === 'ai_tokens')
    const totalTokens = tokenRecords.reduce((s, r) => s + r.quantity, 0)
    const tokensByModel: Record<string, number> = {}
    for (const r of tokenRecords) {
      const model = ((r.metadata as Record<string, unknown>)['model'] as string) ?? 'unknown'
      tokensByModel[model] = (tokensByModel[model] ?? 0) + r.quantity
    }
    const tokensByProvider: Record<string, number> = {}
    for (const r of tokenRecords) {
      const provider = ((r.metadata as Record<string, unknown>)['provider'] as string) ?? 'unknown'
      tokensByProvider[provider] = (tokensByProvider[provider] ?? 0) + r.quantity
    }

    // ── Humanizer words ──────────────────────────────────────────────────────
    const humRecords = allRecords.filter((r) => r.metric === 'humanizer_words')
    const totalHumWords = humRecords.reduce((s, r) => s + r.quantity, 0)
    const humByService: Record<string, number> = {}
    for (const r of humRecords) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      humByService[service] = (humByService[service] ?? 0) + r.quantity
    }

    // ── AI Detection calls ───────────────────────────────────────────────────
    const detectionRecords = allRecords.filter((r) => r.metric === 'detection_call')
    const totalDetectionCalls = detectionRecords.length
    const detectionByService: Record<string, number> = {}
    for (const r of detectionRecords) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      detectionByService[service] = (detectionByService[service] ?? 0) + 1
    }

    // ── Translation ──────────────────────────────────────────────────────────
    const translationRecords = allRecords.filter((r) => r.metric === 'translation_chars')
    const totalTranslationChars = translationRecords.reduce((s, r) => s + r.quantity, 0)
    const translationByProvider: Record<string, number> = {}
    for (const r of translationRecords) {
      const provider = ((r.metadata as Record<string, unknown>)['provider'] as string) ?? 'unknown'
      translationByProvider[provider] = (translationByProvider[provider] ?? 0) + r.quantity
    }

    // ── Image generation ─────────────────────────────────────────────────────
    const imageRecords = allRecords.filter((r) => r.metric === 'image_generations')
    const totalImagesGenerated = imageRecords.reduce((s, r) => s + r.quantity, 0)
    const imagesByService: Record<string, number> = {}
    for (const r of imageRecords) {
      const meta = r.metadata as Record<string, unknown>
      const service = (meta['service'] as string) ?? (meta['provider'] as string) ?? 'unknown'
      imagesByService[service] = (imagesByService[service] ?? 0) + r.quantity
    }

    // ── Video generation ─────────────────────────────────────────────────────
    const videoRecords = allRecords.filter((r) => r.metric === 'video_generations')
    const totalVideosGenerated = videoRecords.reduce((s, r) => s + r.quantity, 0)
    const videosByService: Record<string, number> = {}
    const totalVideoSecs = videoRecords.reduce((s, r) => {
      const meta = r.metadata as Record<string, unknown>
      const service = (meta['service'] as string) ?? (meta['provider'] as string) ?? 'unknown'
      videosByService[service] = (videosByService[service] ?? 0) + r.quantity
      return s + ((meta['durationSecs'] as number) ?? 0)
    }, 0)

    // ── Voice generation (TTS) ───────────────────────────────────────────────
    const voiceRecords = allRecords.filter((r) => r.metric === 'voice_generation_chars')
    const totalVoiceChars = voiceRecords.reduce((s, r) => s + r.quantity, 0)
    const totalVoiceSecs  = voiceRecords.reduce((s, r) => s + (((r.metadata as Record<string, unknown>)['durationSecs'] as number) ?? 0), 0)
    const voiceByProvider: Record<string, { chars: number; secs: number; costUsd: number }> = {}
    for (const r of voiceRecords) {
      const meta     = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      voiceByProvider[provider] = voiceByProvider[provider] ?? { chars: 0, secs: 0, costUsd: 0 }
      voiceByProvider[provider].chars   += r.quantity
      voiceByProvider[provider].secs    += (meta['durationSecs'] as number) ?? 0
      voiceByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    // ── Character animation (D-ID / HeyGen) ───────────────────────────────────
    const charAnimRecords = allRecords.filter((r) => r.metric === 'character_animation_secs')
    const totalCharAnimSecs = charAnimRecords.reduce((s, r) => s + r.quantity, 0)
    const charAnimByProvider: Record<string, { secs: number; costUsd: number }> = {}
    for (const r of charAnimRecords) {
      const meta     = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      charAnimByProvider[provider] = charAnimByProvider[provider] ?? { secs: 0, costUsd: 0 }
      charAnimByProvider[provider].secs    += r.quantity
      charAnimByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    // ── Music generation (ElevenLabs Music / SFX) ────────────────────────────
    const musicRecords = allRecords.filter((r) => r.metric === 'music_generation_secs')
    const totalMusicSecs = musicRecords.reduce((s, r) => s + r.quantity, 0)
    const musicByProvider: Record<string, { secs: number; costUsd: number }> = {}
    for (const r of musicRecords) {
      const meta     = r.metadata as Record<string, unknown>
      const provider = (meta['provider'] as string) ?? 'unknown'
      musicByProvider[provider] = musicByProvider[provider] ?? { secs: 0, costUsd: 0 }
      musicByProvider[provider].secs    += r.quantity
      musicByProvider[provider].costUsd += (meta['estimatedCostUsd'] as number) ?? 0
    }

    // ── Video composition (Shotstack) ────────────────────────────────────────
    const videoCompRecords = allRecords.filter((r) => r.metric === 'video_composition_secs')
    const totalVideoCompSecs = videoCompRecords.reduce((s, r) => s + r.quantity, 0)
    const totalVideoCompCost = videoCompRecords.reduce((s, r) => s + (((r.metadata as Record<string, unknown>)['estimatedCostUsd'] as number) ?? 0), 0)

    // ── Email ────────────────────────────────────────────────────────────────
    const emailRecords = allRecords.filter((r) => r.metric === 'email_sent')
    const totalEmailsSent = emailRecords.reduce((s, r) => s + r.quantity, 0)
    const emailByProvider: Record<string, number> = {}
    for (const r of emailRecords) {
      const provider = ((r.metadata as Record<string, unknown>)['provider'] as string) ?? 'unknown'
      emailByProvider[provider] = (emailByProvider[provider] ?? 0) + r.quantity
    }

    // ── Transcription ────────────────────────────────────────────────────────
    const transcriptSessions = await prisma.transcriptSession.findMany({
      where: { agencyId, createdAt: { gte: periodStart, lte: periodEnd }, status: 'ready' },
      select: { durationSecs: true },
    })
    const transcriptionMinutes = Math.ceil(
      transcriptSessions.reduce((sum, s) => sum + (s.durationSecs ?? 0), 0) / 60
    )

    // ── Video Intelligence (UsageEvent table, not UsageRecord) ───────────────
    const videoIntelEvents = await prisma.usageEvent.findMany({
      where: { agencyId, toolSubtype: 'video_intelligence', timestamp: { gte: periodStart, lte: periodEnd }, status: 'success' },
      select: { workflowRunId: true, estimatedCostUsd: true },
    })
    const totalVideoIntelCalls = videoIntelEvents.length
    const totalVideoIntelCostUsd = videoIntelEvents.reduce((s, e) => s + (e.estimatedCostUsd ?? 0), 0)

    // Resolve video intel runs → workflow → client for byClient attribution
    const viRunIds = [...new Set(videoIntelEvents.map((e) => e.workflowRunId).filter(Boolean) as string[])]
    const viRuns = viRunIds.length
      ? await prisma.workflowRun.findMany({
          where: { id: { in: viRunIds }, agencyId },
          select: { id: true, workflow: { select: { id: true, clientId: true, client: { select: { id: true, name: true } } } } },
        })
      : []
    const viRunMap = Object.fromEntries(viRuns.map((r) => [r.id, r]))

    // ── Runs ─────────────────────────────────────────────────────────────────
    const runCount = await prisma.workflowRun.count({
      where: { agencyId, createdAt: { gte: periodStart, lte: periodEnd } },
    })

    // ── Token breakdown by client/workflow ───────────────────────────────────
    const runIds = [...new Set(
      tokenRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[]
    )]
    const runMap: Record<string, unknown> = {}

    // Also gather run IDs from translation + video + media generation records for client/workflow attribution
    const allRunIds = [...new Set([
      ...runIds,
      ...translationRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
      ...videoRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
      ...imageRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
      ...voiceRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
      ...charAnimRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
      ...musicRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
      ...videoCompRecords
        .map((r) => (r.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined)
        .filter(Boolean) as string[],
    ])]
    const allRuns = allRunIds.length
      ? await prisma.workflowRun.findMany({
          where: { id: { in: allRunIds }, agencyId },
          select: {
            id: true,
            workflow: { select: { id: true, name: true, clientId: true, client: { select: { id: true, name: true } } } },
          },
        })
      : []
    const allRunMap = Object.fromEntries(allRuns.map((r) => [r.id, r]))
    // Replace runMap with the broader allRunMap
    Object.assign(runMap, allRunMap)

    const tokensByClient: Record<string, { clientId: string; clientName: string; tokens: number; translationChars: number; videoIntelligenceCalls: number; videosGenerated: number; imagesGenerated: number; voiceSecs: number; charAnimSecs: number; musicSecs: number; videoCompSecs: number; mediaCostUsd: number }> = {}
    const tokensByWorkflow: Record<string, { workflowId: string; workflowName: string; clientName: string; tokens: number; translationChars: number }> = {}
    for (const record of tokenRecords) {
      const runId = (record.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      const run = runId ? runMap[runId] : undefined
      const wf = (run as any)?.workflow
      if (wf) {
        const cid = wf.clientId
        const cname = wf.client?.name ?? 'Unknown'
        tokensByClient[cid] = tokensByClient[cid] ?? { clientId: cid, clientName: cname, tokens: 0, translationChars: 0, videoIntelligenceCalls: 0, videosGenerated: 0, imagesGenerated: 0, voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0 }
        tokensByClient[cid].tokens += record.quantity
        tokensByWorkflow[wf.id] = tokensByWorkflow[wf.id] ?? { workflowId: wf.id, workflowName: wf.name, clientName: cname, tokens: 0, translationChars: 0 }
        tokensByWorkflow[wf.id].tokens += record.quantity
      }
    }
    for (const record of translationRecords) {
      const runId = (record.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      const run = runId ? runMap[runId] : undefined
      const wf = (run as any)?.workflow
      if (wf) {
        const cid = wf.clientId
        const cname = wf.client?.name ?? 'Unknown'
        tokensByClient[cid] = tokensByClient[cid] ?? { clientId: cid, clientName: cname, tokens: 0, translationChars: 0, videoIntelligenceCalls: 0, videosGenerated: 0, imagesGenerated: 0, voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0 }
        tokensByClient[cid].translationChars += record.quantity
        tokensByWorkflow[wf.id] = tokensByWorkflow[wf.id] ?? { workflowId: wf.id, workflowName: wf.name, clientName: cname, tokens: 0, translationChars: 0 }
        tokensByWorkflow[wf.id].translationChars += record.quantity
      }
    }
    // Include video intelligence usage in byClient (from UsageEvent table)
    for (const event of videoIntelEvents) {
      const run = event.workflowRunId ? viRunMap[event.workflowRunId] : undefined
      const wf = (run as any)?.workflow
      if (wf?.clientId) {
        const cid = wf.clientId
        const cname = wf.client?.name ?? 'Unknown'
        tokensByClient[cid] = tokensByClient[cid] ?? { clientId: cid, clientName: cname, tokens: 0, translationChars: 0, videoIntelligenceCalls: 0, videosGenerated: 0, imagesGenerated: 0, voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0 }
        tokensByClient[cid].videoIntelligenceCalls += 1
      }
    }
    // Include video generations in byClient
    for (const record of videoRecords) {
      const runId = (record.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      const run = runId ? runMap[runId] : undefined
      const wf = (run as any)?.workflow
      if (wf?.clientId) {
        const cid = wf.clientId
        const cname = wf.client?.name ?? 'Unknown'
        tokensByClient[cid] = tokensByClient[cid] ?? { clientId: cid, clientName: cname, tokens: 0, translationChars: 0, videoIntelligenceCalls: 0, videosGenerated: 0, imagesGenerated: 0, voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0 }
        tokensByClient[cid].videosGenerated += record.quantity
      }
    }
    // Include image generations in byClient
    for (const record of imageRecords) {
      const runId = (record.metadata as Record<string, unknown>)['workflowRunId'] as string | undefined
      const run = runId ? runMap[runId] : undefined
      const wf = (run as any)?.workflow
      if (wf?.clientId) {
        const cid = wf.clientId
        const cname = wf.client?.name ?? 'Unknown'
        tokensByClient[cid] = tokensByClient[cid] ?? { clientId: cid, clientName: cname, tokens: 0, translationChars: 0, videoIntelligenceCalls: 0, videosGenerated: 0, imagesGenerated: 0, voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0 }
        tokensByClient[cid].imagesGenerated += record.quantity
      }
    }
    // Include media usage (voice/char-anim/music/video-comp) in byClient
    const mediaRecordsForClient = [...voiceRecords, ...charAnimRecords, ...musicRecords, ...videoCompRecords]
    for (const record of mediaRecordsForClient) {
      const meta  = record.metadata as Record<string, unknown>
      const runId = meta['workflowRunId'] as string | undefined
      const run   = runId ? runMap[runId] : undefined
      const wf    = (run as any)?.workflow
      if (wf?.clientId) {
        const cid   = wf.clientId
        const cname = wf.client?.name ?? 'Unknown'
        tokensByClient[cid] = tokensByClient[cid] ?? { clientId: cid, clientName: cname, tokens: 0, translationChars: 0, videoIntelligenceCalls: 0, videosGenerated: 0, imagesGenerated: 0, voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0 }
        const secs = (meta['durationSecs'] as number) ?? 0
        const cost = (meta['estimatedCostUsd'] as number) ?? 0
        if (record.metric === 'voice_generation_chars')    { tokensByClient[cid].voiceSecs    += secs; tokensByClient[cid].mediaCostUsd += cost }
        if (record.metric === 'character_animation_secs')  { tokensByClient[cid].charAnimSecs += secs; tokensByClient[cid].mediaCostUsd += cost }
        if (record.metric === 'music_generation_secs')     { tokensByClient[cid].musicSecs    += secs; tokensByClient[cid].mediaCostUsd += cost }
        if (record.metric === 'video_composition_secs')    { tokensByClient[cid].videoCompSecs += secs; tokensByClient[cid].mediaCostUsd += cost }
      }
    }

    // ── Usage by user ────────────────────────────────────────────────────────
    // Collect all userIds mentioned in any UsageRecord metadata
    const userIdSet = new Set<string>()
    for (const r of allRecords) {
      const uid = (r.metadata as Record<string, unknown>)['userId'] as string | undefined
      if (uid) userIdSet.add(uid)
    }
    const userIdList = [...userIdSet]
    const userRows = userIdList.length
      ? await prisma.user.findMany({
          where: { agencyId, clerkUserId: { in: userIdList } },
          select: { clerkUserId: true, name: true, email: true },
        })
      : []

    // For users whose name is missing in our DB, fetch from Clerk
    const foundIds = new Set(userRows.map((u) => u.clerkUserId))
    const missingNameIds = [
      ...userRows.filter((u) => !u.name).map((u) => u.clerkUserId),
      // also look up any IDs that aren't in our DB at all
      ...userIdList.filter((id) => !foundIds.has(id)),
    ]
    let clerkData: Record<string, { name: string | null; email: string }> = {}
    if (missingNameIds.length > 0) {
      clerkData = await getClerkUserNames(missingNameIds)
      // Only backfill proper "First Last" names — not email-only values,
      // so a real name added later in Clerk will still get picked up.
      for (const [clerkId, { name }] of Object.entries(clerkData)) {
        if (name) {
          prisma.user.updateMany({
            where: { agencyId, clerkUserId: clerkId, name: null },
            data: { name },
          }).catch(() => {})
        }
      }
    }

    // Build display label: DB name → Clerk name → Clerk email → DB email → user ID
    const userNameMap: Record<string, string> = {}
    for (const u of userRows) {
      const clerk = clerkData[u.clerkUserId]
      userNameMap[u.clerkUserId] =
        u.name || clerk?.name || clerk?.email || u.email || u.clerkUserId
    }
    // IDs not in DB at all — use whatever Clerk returned
    for (const id of userIdList) {
      if (!userNameMap[id]) {
        const clerk = clerkData[id]
        userNameMap[id] = clerk?.name || clerk?.email || id
      }
    }

    type UserBucket = {
      userId: string; userName: string
      tokens: number; humanizerWords: number
      imagesGenerated: number; videosGenerated: number
      translationChars: number
      voiceSecs: number; charAnimSecs: number; musicSecs: number; videoCompSecs: number
      mediaCostUsd: number
    }
    const byUserMap: Record<string, UserBucket> = {}
    const ensureUser = (uid: string) => {
      if (!byUserMap[uid]) byUserMap[uid] = {
        userId: uid, userName: userNameMap[uid] ?? uid,
        tokens: 0, humanizerWords: 0, imagesGenerated: 0, videosGenerated: 0, translationChars: 0,
        voiceSecs: 0, charAnimSecs: 0, musicSecs: 0, videoCompSecs: 0, mediaCostUsd: 0,
      }
      return byUserMap[uid]
    }
    for (const r of allRecords) {
      const uid = (r.metadata as Record<string, unknown>)['userId'] as string | undefined
      if (!uid) continue
      const bucket = ensureUser(uid)
      if (r.metric === 'ai_tokens')              bucket.tokens          += r.quantity
      if (r.metric === 'humanizer_words')        bucket.humanizerWords  += r.quantity
      if (r.metric === 'image_generations')      bucket.imagesGenerated += r.quantity
      if (r.metric === 'video_generations')      bucket.videosGenerated += r.quantity
      if (r.metric === 'translation_chars')      bucket.translationChars += r.quantity
      const meta = r.metadata as Record<string, unknown>
      const secs = (meta['durationSecs'] as number) ?? 0
      const cost = (meta['estimatedCostUsd'] as number) ?? 0
      if (r.metric === 'voice_generation_chars')   { bucket.voiceSecs    += secs; bucket.mediaCostUsd += cost }
      if (r.metric === 'character_animation_secs') { bucket.charAnimSecs += secs; bucket.mediaCostUsd += cost }
      if (r.metric === 'music_generation_secs')    { bucket.musicSecs    += secs; bucket.mediaCostUsd += cost }
      if (r.metric === 'video_composition_secs')   { bucket.videoCompSecs += secs; bucket.mediaCostUsd += cost }
    }

    // ── Daily token usage (last 30 days) ─────────────────────────────────────
    const buckets = last30DayBuckets()
    const dailyUsage = buckets.map((bucket) => {
      const tokens = allRecords
        .filter((r) => r.metric === 'ai_tokens' && r.periodStart >= bucket.start && r.periodStart <= bucket.end)
        .reduce((s, r) => s + r.quantity, 0)
      return { date: bucket.date, tokens }
    })

    return reply.send({
      data: {
        period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
        totals: {
          tokens: totalTokens,
          runs: runCount,
          transcriptionMinutes,
          detectionCalls: totalDetectionCalls,
          humanizerWords: totalHumWords,
          translationChars: totalTranslationChars,
          emailsSent: totalEmailsSent,
          imagesGenerated: totalImagesGenerated,
          videosGenerated: totalVideosGenerated,
          videoSecondGenerated: totalVideoSecs,
          videoIntelligenceCalls: totalVideoIntelCalls,
          videoIntelligenceCostUsd: totalVideoIntelCostUsd,
          voiceChars: totalVoiceChars,
          voiceGenerationSecs: totalVoiceSecs,
          charAnimSecs: totalCharAnimSecs,
          musicSecs: totalMusicSecs,
          videoCompSecs: totalVideoCompSecs,
          videoCompCostUsd: totalVideoCompCost,
          scrapePages: allRecords.filter((r) => r.metric === 'scrape_pages').reduce((s, r) => s + r.quantity, 0),
        },
        llm: {
          totalTokens,
          byModel: Object.entries(tokensByModel).map(([model, tokens]) => ({ model, tokens })).sort((a, b) => b.tokens - a.tokens),
          byProvider: Object.entries(tokensByProvider).map(([provider, tokens]) => ({ provider, tokens })).sort((a, b) => b.tokens - a.tokens),
        },
        humanizer: {
          totalWords: totalHumWords,
          byService: Object.entries(humByService).map(([service, words]) => ({ service, words })).sort((a, b) => b.words - a.words),
        },
        detection: {
          totalCalls: totalDetectionCalls,
          byService: Object.entries(detectionByService).map(([service, calls]) => ({ service, calls })).sort((a, b) => b.calls - a.calls),
        },
        translation: {
          totalChars: totalTranslationChars,
          byProvider: Object.entries(translationByProvider).map(([provider, chars]) => ({ provider, chars })).sort((a, b) => b.chars - a.chars),
        },
        email: {
          totalSent: totalEmailsSent,
          byProvider: Object.entries(emailByProvider).map(([provider, count]) => ({ provider, count })).sort((a, b) => b.count - a.count),
        },
        imageGeneration: {
          totalImages: totalImagesGenerated,
          byService: Object.entries(imagesByService).map(([service, count]) => ({ service, count })).sort((a, b) => b.count - a.count),
        },
        videoGeneration: {
          totalVideos: totalVideosGenerated,
          totalSecondGenerated: totalVideoSecs,
          byService: Object.entries(videosByService).map(([service, count]) => ({ service, count })).sort((a, b) => b.count - a.count),
        },
        voiceGeneration: {
          totalChars: totalVoiceChars,
          totalSecs: totalVoiceSecs,
          byProvider: Object.entries(voiceByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.chars - a.chars),
        },
        characterAnimation: {
          totalSecs: totalCharAnimSecs,
          byProvider: Object.entries(charAnimByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.secs - a.secs),
        },
        musicGeneration: {
          totalSecs: totalMusicSecs,
          byProvider: Object.entries(musicByProvider).map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.secs - a.secs),
        },
        videoComposition: {
          totalSecs: totalVideoCompSecs,
          totalCostUsd: totalVideoCompCost,
        },
        scraping: (() => {
          const scrapeRecords = allRecords.filter((r) => r.metric === 'scrape_pages')
          const totalPages = scrapeRecords.reduce((s, r) => s + r.quantity, 0)
          const bySource: Record<string, number> = {}
          for (const r of scrapeRecords) {
            const source = ((r.metadata as Record<string, unknown>)['source'] as string) ?? 'raw'
            bySource[source] = (bySource[source] ?? 0) + r.quantity
          }
          return {
            totalPages,
            bySource: Object.entries(bySource).map(([source, pages]) => ({ source, pages })).sort((a, b) => b.pages - a.pages),
          }
        })(),
        byClient: Object.values(tokensByClient).sort((a, b) => b.tokens - a.tokens),
        byWorkflow: Object.values(tokensByWorkflow).sort((a, b) => b.tokens - a.tokens),
        byUser: Object.values(byUserMap).sort((a, b) => b.tokens - a.tokens),
        dailyUsage,
      },
    })
  })

  // ── GET /events — raw granular UsageEvent log ─────────────────────────────
  app.get('/events', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const filters: UsageFilters = {
      startDate:  q.startDate,
      endDate:    q.endDate,
      toolType:   q.toolType as UsageFilters['toolType'],
      provider:   q.provider,
      model:      q.model,
      isOnline:   q.isOnline !== undefined ? q.isOnline === 'true' : undefined,
      status:     q.status as UsageFilters['status'],
      workflowId: q.workflowId,
    }
    const limit  = Math.min(Number(q.limit  ?? 100), 1000)
    const offset = Number(q.offset ?? 0)
    const events = await usageQueryService.getUsageEvents(agencyId, filters, { limit, offset })
    return reply.send({ data: events })
  })

  // ── GET /events/org — org-level aggregated stats ──────────────────────────
  app.get('/events/org', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const filters: UsageFilters = {
      startDate: q.startDate, endDate: q.endDate,
      toolType: q.toolType as UsageFilters['toolType'],
    }
    const summary = await usageQueryService.getOrgUsage(agencyId, filters)
    return reply.send({ data: summary })
  })

  // ── GET /events/org/by-client — org breakdown by client ──────────────────
  app.get('/events/org/by-client', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const data = await usageQueryService.getOrgUsageByClient(agencyId, { startDate: q.startDate, endDate: q.endDate })
    return reply.send({ data })
  })

  // ── GET /events/org/by-role — org breakdown by role ──────────────────────
  app.get('/events/org/by-role', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const data = await usageQueryService.getOrgUsageByRole(agencyId, { startDate: q.startDate, endDate: q.endDate })
    return reply.send({ data })
  })

  // ── GET /events/org/cost-by-provider ─────────────────────────────────────
  app.get('/events/org/cost-by-provider', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const data = await usageQueryService.getOrgCostByProvider(agencyId, { startDate: q.startDate, endDate: q.endDate })
    return reply.send({ data })
  })

  // ── GET /events/clients/:clientId ─────────────────────────────────────────
  app.get<{ Params: { clientId: string } }>('/events/clients/:clientId', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const filters: UsageFilters = {
      startDate: q.startDate, endDate: q.endDate,
      toolType: q.toolType as UsageFilters['toolType'],
    }
    const data = await usageQueryService.getClientUsage(agencyId, req.params.clientId, filters)
    return reply.send({ data })
  })

  // ── GET /events/clients/:clientId/by-user ────────────────────────────────
  app.get<{ Params: { clientId: string } }>('/events/clients/:clientId/by-user', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const data = await usageQueryService.getClientUsageByUser(agencyId, req.params.clientId, { startDate: q.startDate, endDate: q.endDate })
    return reply.send({ data })
  })

  // ── GET /events/users/:userId ─────────────────────────────────────────────
  app.get<{ Params: { userId: string } }>('/events/users/:userId', async (req, reply) => {
    const { agencyId } = req.auth
    const q = req.query as Record<string, string>
    const filters: UsageFilters = {
      startDate: q.startDate, endDate: q.endDate,
      toolType: q.toolType as UsageFilters['toolType'],
    }
    const data = await usageQueryService.getUserUsage(agencyId, req.params.userId, filters)
    return reply.send({ data })
  })

  // ── GET /humanizer — per-service word counts for the current month ─────────
  app.get('/humanizer', async (req, reply) => {
    const { agencyId } = req.auth
    const { start: periodStart } = currentPeriod()

    const records = await prisma.usageRecord.findMany({
      where: { agencyId, metric: 'humanizer_words', periodStart: { gte: periodStart } },
    })

    const byService: Record<string, number> = {}
    for (const r of records) {
      const service = ((r.metadata as Record<string, unknown>)['service'] as string) ?? 'unknown'
      byService[service] = (byService[service] ?? 0) + r.quantity
    }

    return reply.send({ data: byService })
  })
}
