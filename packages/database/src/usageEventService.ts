import { prisma } from './client.js'
import { Prisma } from '@prisma/client'
import type { PermissionSet } from './permissionService.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToolType = 'llm' | 'graphics' | 'video' | 'content'
export type EventStatus = 'success' | 'error' | 'cancelled'

export interface UsageEventInput {
  // Identity
  userId?: string
  userRole?: string
  clientId?: string
  agencyId: string

  // Tool
  toolType: ToolType
  toolSubtype: string          // e.g. 'text_generation', 'image_generation', 'humanizer'

  // Provider / model
  provider: string
  model: string
  isOnline: boolean

  // Workflow context
  workflowId?: string
  workflowRunId?: string
  nodeId?: string
  nodeType?: string

  // Metrics
  inputTokens?: number
  outputTokens?: number
  inputCharacters?: number
  outputCharacters?: number
  inputMediaCount?: number
  outputMediaCount?: number
  outputDurationSecs?: number
  outputResolution?: string

  // Cost (caller responsible for estimating; offline = 0)
  estimatedCostUsd?: number

  // Execution
  durationMs: number
  status: EventStatus
  errorCode?: string
  errorMessage?: string

  // Permission snapshot
  permissionsAtTime?: unknown

  // Correction chain
  corrects?: string
}

export interface UsageFilters {
  startDate?: string
  endDate?: string
  toolType?: ToolType
  provider?: string
  model?: string
  isOnline?: boolean
  status?: EventStatus
  workflowId?: string
}

export interface UsageSummary {
  totalEvents: number
  byToolType: Record<string, number>
  byProvider: Record<string, number>
  byModel: Record<string, number>
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  errors: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost estimator — reads rates from config/provider-rates.json
// ─────────────────────────────────────────────────────────────────────────────

type RatesConfig = Record<string, Record<string, Record<string, number>>>

let _ratesCache: RatesConfig | null = null

function getRates(): RatesConfig {
  if (_ratesCache) return _ratesCache
  try {
    // Path relative to this file's location after compilation — walks up from dist/
    const { readFileSync } = require('fs')
    const { resolve } = require('path')
    // Try several candidate paths to work in both dev (ts-node/tsx) and compiled contexts
    const candidates = [
      resolve(__dirname, '../../../../config/provider-rates.json'),
      resolve(process.cwd(), 'config/provider-rates.json'),
      resolve(process.cwd(), '../../config/provider-rates.json'),
    ]
    for (const p of candidates) {
      try {
        _ratesCache = JSON.parse(readFileSync(p, 'utf-8')) as RatesConfig
        return _ratesCache
      } catch { /* try next */ }
    }
  } catch { /* ignore — cost will be null */ }
  _ratesCache = {}
  return _ratesCache
}

export const costEstimator = {
  /**
   * Estimate USD cost for an LLM call.
   * Returns null if rates are not configured for this provider/model.
   * Offline models always return 0.
   */
  estimateLlmCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    isOnline: boolean,
  ): number | null {
    if (!isOnline) return 0
    const rates = getRates()
    const modelRates = rates[provider]?.[model]
    if (!modelRates) return null
    const inputRate  = modelRates['input_per_million_tokens']  ?? 0
    const outputRate = modelRates['output_per_million_tokens'] ?? 0
    return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000
  },

  /**
   * Estimate USD cost for an image generation call.
   * resolution: e.g. '1024x1024'
   */
  estimateImageCost(
    provider: string,
    model: string,
    count: number,
    resolution: string,
    isOnline: boolean,
  ): number | null {
    if (!isOnline) return 0
    const rates = getRates()
    const modelRates = rates[provider]?.[model]
    if (!modelRates) return null
    // Look for per_image_<resolution> first, then per_image
    const perImageKey = `per_image_${resolution.replace('x', 'x')}`
    const rate = modelRates[perImageKey] ?? modelRates['per_image'] ?? null
    if (rate === null) return null
    return rate * count
  },

  /**
   * Estimate USD cost for a video generation call.
   * durationSecs: total output duration in seconds.
   */
  estimateVideoCost(
    provider: string,
    model: string,
    durationSecs: number,
    isOnline: boolean,
  ): number | null {
    if (!isOnline) return 0
    const rates = getRates()
    const modelRates = rates[provider]?.[model]
    if (!modelRates) return null
    const perSecRate = modelRates['per_second_video'] ?? null
    if (perSecRate === null) return null
    return perSecRate * durationSecs
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// UsageEventService — write events
// ─────────────────────────────────────────────────────────────────────────────

export const usageEventService = {
  /**
   * Record a single usage event. Never throws — failures are logged to stderr
   * so a tracking error never breaks the actual workflow execution.
   */
  async record(event: UsageEventInput): Promise<void> {
    try {
      await prisma.usageEvent.create({
        data: {
          agencyId:          event.agencyId,
          userId:            event.userId ?? null,
          userRole:          event.userRole ?? null,
          clientId:          event.clientId ?? null,
          toolType:          event.toolType,
          toolSubtype:       event.toolSubtype,
          provider:          event.provider,
          model:             event.model,
          isOnline:          event.isOnline,
          workflowId:        event.workflowId ?? null,
          workflowRunId:     event.workflowRunId ?? null,
          nodeId:            event.nodeId ?? null,
          nodeType:          event.nodeType ?? null,
          inputTokens:       event.inputTokens ?? null,
          outputTokens:      event.outputTokens ?? null,
          inputCharacters:   event.inputCharacters ?? null,
          outputCharacters:  event.outputCharacters ?? null,
          inputMediaCount:   event.inputMediaCount ?? null,
          outputMediaCount:  event.outputMediaCount ?? null,
          outputDurationSecs: event.outputDurationSecs ?? null,
          outputResolution:  event.outputResolution ?? null,
          estimatedCostUsd:  event.estimatedCostUsd ?? null,
          durationMs:        event.durationMs,
          status:            event.status,
          errorCode:         event.errorCode ?? null,
          errorMessage:      event.errorMessage ?? null,
          permissionsAtTime: event.permissionsAtTime != null
            ? JSON.parse(JSON.stringify(event.permissionsAtTime)) as Prisma.InputJsonValue
            : Prisma.DbNull,
          corrects:          event.corrects ?? null,
        },
      })
    } catch (err) {
      console.error('[usageEventService] failed to record event', err)
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// UsageQueryService — read / aggregate events
// ─────────────────────────────────────────────────────────────────────────────

function buildWhere(
  scopeField: 'agencyId' | 'userId' | 'clientId',
  scopeValue: string,
  agencyId: string,
  filters?: UsageFilters,
): Prisma.UsageEventWhereInput {
  const where: Prisma.UsageEventWhereInput = {
    agencyId,
    [scopeField]: scopeValue,
  }
  if (filters?.startDate || filters?.endDate) {
    where.timestamp = {
      ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
      ...(filters.endDate   ? { lte: new Date(filters.endDate) }   : {}),
    }
  }
  if (filters?.toolType)  where.toolType  = filters.toolType
  if (filters?.provider)  where.provider  = filters.provider
  if (filters?.model)     where.model     = filters.model
  if (filters?.isOnline !== undefined) where.isOnline = filters.isOnline
  if (filters?.status)    where.status    = filters.status
  if (filters?.workflowId) where.workflowId = filters.workflowId
  return where
}

function summariseEvents(events: {
  toolType: string; provider: string; model: string;
  inputTokens: number | null; outputTokens: number | null;
  estimatedCostUsd: number | null; status: string;
}[]): UsageSummary {
  const summary: UsageSummary = {
    totalEvents: events.length,
    byToolType: {},
    byProvider: {},
    byModel: {},
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    errors: 0,
  }
  for (const e of events) {
    summary.byToolType[e.toolType] = (summary.byToolType[e.toolType] ?? 0) + 1
    summary.byProvider[e.provider] = (summary.byProvider[e.provider] ?? 0) + 1
    summary.byModel[e.model] = (summary.byModel[e.model] ?? 0) + 1
    summary.totalCostUsd      += e.estimatedCostUsd ?? 0
    summary.totalInputTokens  += e.inputTokens ?? 0
    summary.totalOutputTokens += e.outputTokens ?? 0
    if (e.status === 'error') summary.errors++
  }
  return summary
}

export const usageQueryService = {
  // ── User-level ──────────────────────────────────────────────────────────────

  async getUserUsage(agencyId: string, userId: string, filters?: UsageFilters): Promise<UsageSummary> {
    const events = await prisma.usageEvent.findMany({
      where: buildWhere('userId', userId, agencyId, filters),
      select: { toolType: true, provider: true, model: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true, status: true },
    })
    return summariseEvents(events)
  },

  async getUserTokenUsage(agencyId: string, userId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: { ...buildWhere('userId', userId, agencyId, filters), toolType: 'llm' },
      select: { model: true, provider: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true, timestamp: true },
    })
    const byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }> = {}
    for (const e of events) {
      byModel[e.model] = byModel[e.model] ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 }
      byModel[e.model].inputTokens  += e.inputTokens ?? 0
      byModel[e.model].outputTokens += e.outputTokens ?? 0
      byModel[e.model].costUsd      += e.estimatedCostUsd ?? 0
    }
    return { byModel, events }
  },

  async getUserCost(agencyId: string, userId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: buildWhere('userId', userId, agencyId, filters),
      select: { toolType: true, provider: true, estimatedCostUsd: true },
    })
    const byToolType: Record<string, number> = {}
    const byProvider: Record<string, number> = {}
    let total = 0
    for (const e of events) {
      const cost = e.estimatedCostUsd ?? 0
      total += cost
      byToolType[e.toolType] = (byToolType[e.toolType] ?? 0) + cost
      byProvider[e.provider] = (byProvider[e.provider] ?? 0) + cost
    }
    return { total, byToolType, byProvider }
  },

  // ── Client-level ────────────────────────────────────────────────────────────

  async getClientUsage(agencyId: string, clientId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: buildWhere('clientId', clientId, agencyId, filters),
      select: { toolType: true, provider: true, model: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true, status: true, isOnline: true, userId: true, outputMediaCount: true, outputDurationSecs: true, outputResolution: true },
    })
    const summary = summariseEvents(events)
    // Online vs offline split
    const onlineCount  = events.filter((e) => e.isOnline).length
    const offlineCount = events.filter((e) => !e.isOnline).length
    // Video totals
    const videoEvents = events.filter((e) => e.toolType === 'video')
    const totalVideoSecs  = videoEvents.reduce((s, e) => s + (e.outputDurationSecs ?? 0), 0)
    const totalVideoFiles = videoEvents.reduce((s, e) => s + (e.outputMediaCount ?? 0), 0)
    // Graphics totals
    const graphicsEvents = events.filter((e) => e.toolType === 'graphics')
    const totalGraphicsFiles = graphicsEvents.reduce((s, e) => s + (e.outputMediaCount ?? 0), 0)
    const resolutionDist: Record<string, number> = {}
    for (const e of graphicsEvents) {
      if (e.outputResolution) resolutionDist[e.outputResolution] = (resolutionDist[e.outputResolution] ?? 0) + 1
    }
    return { ...summary, onlineCount, offlineCount, totalVideoSecs, totalVideoFiles, totalGraphicsFiles, resolutionDist }
  },

  async getClientUsageByUser(agencyId: string, clientId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: buildWhere('clientId', clientId, agencyId, filters),
      select: { userId: true, userRole: true, toolType: true, estimatedCostUsd: true, inputTokens: true, outputTokens: true, status: true },
    })
    const byUser: Record<string, { userId: string; role: string; events: number; costUsd: number; tokens: number; errors: number }> = {}
    for (const e of events) {
      const uid = e.userId ?? 'unknown'
      byUser[uid] = byUser[uid] ?? { userId: uid, role: e.userRole ?? 'unknown', events: 0, costUsd: 0, tokens: 0, errors: 0 }
      byUser[uid].events++
      byUser[uid].costUsd += e.estimatedCostUsd ?? 0
      byUser[uid].tokens  += (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
      if (e.status === 'error') byUser[uid].errors++
    }
    return Object.values(byUser)
  },

  // ── Org-level ───────────────────────────────────────────────────────────────

  async getOrgUsage(agencyId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: { agencyId, ...(filters ? buildWhere('agencyId', agencyId, agencyId, filters) : {}) },
      select: { toolType: true, provider: true, model: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true, status: true, isOnline: true, clientId: true, userId: true, userRole: true },
    })
    const summary = summariseEvents(events)
    const onlineCount  = events.filter((e) => e.isOnline).length
    const offlineCount = events.filter((e) => !e.isOnline).length
    // Top 10 models by count
    const modelCounts = Object.entries(summary.byModel).sort((a, b) => b[1] - a[1]).slice(0, 10)
    // Top 10 by cost
    const costByModel: Record<string, number> = {}
    for (const e of events) {
      costByModel[e.model] = (costByModel[e.model] ?? 0) + (e.estimatedCostUsd ?? 0)
    }
    const topModelsByCost = Object.entries(costByModel).sort((a, b) => b[1] - a[1]).slice(0, 10)
    return { ...summary, onlineCount, offlineCount, topModelsByCount: modelCounts, topModelsByCost }
  },

  async getOrgUsageByClient(agencyId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: { agencyId, ...(filters ? { timestamp: buildWhere('agencyId', agencyId, agencyId, filters).timestamp } : {}) },
      select: { clientId: true, toolType: true, estimatedCostUsd: true, inputTokens: true, outputTokens: true, status: true },
    })
    const byClient: Record<string, { clientId: string; events: number; costUsd: number; tokens: number; errors: number }> = {}
    for (const e of events) {
      const cid = e.clientId ?? 'unknown'
      byClient[cid] = byClient[cid] ?? { clientId: cid, events: 0, costUsd: 0, tokens: 0, errors: 0 }
      byClient[cid].events++
      byClient[cid].costUsd += e.estimatedCostUsd ?? 0
      byClient[cid].tokens  += (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
      if (e.status === 'error') byClient[cid].errors++
    }
    return Object.values(byClient).sort((a, b) => b.costUsd - a.costUsd)
  },

  async getOrgUsageByRole(agencyId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: { agencyId, ...(filters ? { timestamp: buildWhere('agencyId', agencyId, agencyId, filters).timestamp } : {}) },
      select: { userRole: true, toolType: true, estimatedCostUsd: true, status: true },
    })
    const byRole: Record<string, { role: string; events: number; costUsd: number; errors: number }> = {}
    for (const e of events) {
      const r = e.userRole ?? 'unknown'
      byRole[r] = byRole[r] ?? { role: r, events: 0, costUsd: 0, errors: 0 }
      byRole[r].events++
      byRole[r].costUsd += e.estimatedCostUsd ?? 0
      if (e.status === 'error') byRole[r].errors++
    }
    return Object.values(byRole)
  },

  async getOrgCostByProvider(agencyId: string, filters?: UsageFilters) {
    const events = await prisma.usageEvent.findMany({
      where: { agencyId, ...(filters ? { timestamp: buildWhere('agencyId', agencyId, agencyId, filters).timestamp } : {}) },
      select: { provider: true, estimatedCostUsd: true, isOnline: true },
    })
    const byProvider: Record<string, { provider: string; costUsd: number; onlineCost: number; offlineCost: number }> = {}
    for (const e of events) {
      byProvider[e.provider] = byProvider[e.provider] ?? { provider: e.provider, costUsd: 0, onlineCost: 0, offlineCost: 0 }
      const cost = e.estimatedCostUsd ?? 0
      byProvider[e.provider].costUsd += cost
      if (e.isOnline) byProvider[e.provider].onlineCost += cost
      else            byProvider[e.provider].offlineCost += cost
    }
    return Object.values(byProvider).sort((a, b) => b.costUsd - a.costUsd)
  },

  // ── Raw events ──────────────────────────────────────────────────────────────

  async getUsageEvents(agencyId: string, filters?: UsageFilters, opts?: { limit?: number; offset?: number }) {
    const where = buildWhere('agencyId', agencyId, agencyId, filters)
    return prisma.usageEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take:  opts?.limit  ?? 100,
      skip:  opts?.offset ?? 0,
    })
  },
}
