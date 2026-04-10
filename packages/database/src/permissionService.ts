import { prisma } from './client.js'
import { Prisma } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LlmPermissions {
  online: boolean           // may use cloud-hosted LLM providers
  offline: boolean          // may use local/self-hosted LLM providers
  models: string[]          // allowlist of model IDs; empty = all allowed within online/offline scope
}

export interface GraphicsPermissions {
  enabled: boolean          // may use image-generation nodes at all
  online: boolean
  offline: boolean
  providers: string[]       // allowlist: ['dalle3','stability','fal',…]; empty = all allowed
}

export interface VideoPermissions {
  enabled: boolean
  online: boolean
  offline: boolean
  providers: string[]       // allowlist: ['runway','kling','luma',…]; empty = all allowed
}

export interface ContentPermissions {
  humanizer: boolean
  style_guides: boolean
  export_formats: string[]  // allowlist: ['pdf','docx','html','json',…]; empty = all allowed
}

export interface PermissionSet {
  llm: LlmPermissions
  graphics: GraphicsPermissions
  video: VideoPermissions
  content: ContentPermissions
}

// ─────────────────────────────────────────────────────────────────────────────
// Role defaults
// Resolution order (highest → lowest priority):
//   1. User.permissionsOverride
//   2. Client.permissionsOverride  (only when clientId is provided)
//   3. Agency.permissionsOverride
//   4. Role default (this table)
//
// For booleans: first defined value (non-null/non-undefined) wins.
// For arrays: first non-empty array wins. Empty array = "no restriction at this level".
// ─────────────────────────────────────────────────────────────────────────────

const ONLINE_PROVIDERS_IMAGE = new Set(['dalle3', 'stability', 'fal'])
const OFFLINE_PROVIDERS_IMAGE = new Set(['comfyui', 'automatic1111'])
const ONLINE_PROVIDERS_VIDEO = new Set(['runway', 'kling', 'luma', 'pika', 'stability', 'veo2'])
const OFFLINE_PROVIDERS_VIDEO = new Set(['comfyui-animatediff', 'cogvideox', 'wan21'])

export const ONLINE_LLM_PROVIDERS = new Set(['anthropic', 'openai'])
export const OFFLINE_LLM_PROVIDERS = new Set(['ollama'])
export { ONLINE_PROVIDERS_IMAGE, OFFLINE_PROVIDERS_IMAGE, ONLINE_PROVIDERS_VIDEO, OFFLINE_PROVIDERS_VIDEO }

const FULL_ACCESS: PermissionSet = {
  llm:      { online: true,  offline: true,  models: [] },
  graphics: { enabled: true,  online: true,  offline: true,  providers: [] },
  video:    { enabled: true,  online: true,  offline: true,  providers: [] },
  content:  { humanizer: true, style_guides: true, export_formats: [] },
}

const ROLE_DEFAULTS: Record<string, PermissionSet> = {
  // ── New role names ─────────────────────────────────────────────────────────
  super_admin:    FULL_ACCESS,
  org_admin:      FULL_ACCESS,
  client_manager: {
    llm:      { online: true,  offline: true,  models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: true,  online: true,  offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: [] },
  },
  editor: {
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  reviewer: {
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  viewer: {
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  api_user: {
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  // ── Legacy role names mapped to equivalents ────────────────────────────────
  owner:  FULL_ACCESS,                              // equivalent to super_admin
  admin:  FULL_ACCESS,                              // equivalent to org_admin
  lead: {                                           // equivalent to client_manager
    llm:      { online: true,  offline: true,  models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: true,  online: true,  offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: [] },
  },
  member: {                                         // equivalent to editor
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge helpers
// ─────────────────────────────────────────────────────────────────────────────

function firstDefined<T>(...values: (T | undefined | null)[]): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** For array fields: first non-empty array wins; all-empty means "no restriction". */
function firstNonEmptyArray(...values: (string[] | undefined | null)[]): string[] {
  for (const v of values) {
    if (Array.isArray(v) && v.length > 0) return v
  }
  return []
}

function mergePermissions(
  role: PermissionSet,
  agency: Partial<PermissionSet> | null,
  client: Partial<PermissionSet> | null,
  user: Partial<PermissionSet> | null,
): PermissionSet {
  // Resolution priority: user (highest) → client → agency → role (lowest)
  // For booleans: first defined value wins.
  // For arrays: first non-empty array wins (empty = "no restriction at this level, inherit").
  return {
    llm: {
      online:  firstDefined(user?.llm?.online,  client?.llm?.online,  agency?.llm?.online,  role.llm.online)  ?? role.llm.online,
      offline: firstDefined(user?.llm?.offline, client?.llm?.offline, agency?.llm?.offline, role.llm.offline) ?? role.llm.offline,
      models:  firstNonEmptyArray(user?.llm?.models, client?.llm?.models, agency?.llm?.models, role.llm.models),
    },
    graphics: {
      enabled:   firstDefined(user?.graphics?.enabled,   client?.graphics?.enabled,   agency?.graphics?.enabled,   role.graphics.enabled)   ?? role.graphics.enabled,
      online:    firstDefined(user?.graphics?.online,    client?.graphics?.online,    agency?.graphics?.online,    role.graphics.online)    ?? role.graphics.online,
      offline:   firstDefined(user?.graphics?.offline,   client?.graphics?.offline,   agency?.graphics?.offline,   role.graphics.offline)   ?? role.graphics.offline,
      providers: firstNonEmptyArray(user?.graphics?.providers, client?.graphics?.providers, agency?.graphics?.providers, role.graphics.providers),
    },
    video: {
      enabled:   firstDefined(user?.video?.enabled,   client?.video?.enabled,   agency?.video?.enabled,   role.video.enabled)   ?? role.video.enabled,
      online:    firstDefined(user?.video?.online,    client?.video?.online,    agency?.video?.online,    role.video.online)    ?? role.video.online,
      offline:   firstDefined(user?.video?.offline,   client?.video?.offline,   agency?.video?.offline,   role.video.offline)   ?? role.video.offline,
      providers: firstNonEmptyArray(user?.video?.providers, client?.video?.providers, agency?.video?.providers, role.video.providers),
    },
    content: {
      humanizer:      firstDefined(user?.content?.humanizer,      client?.content?.humanizer,      agency?.content?.humanizer,      role.content.humanizer)      ?? role.content.humanizer,
      style_guides:   firstDefined(user?.content?.style_guides,   client?.content?.style_guides,   agency?.content?.style_guides,   role.content.style_guides)   ?? role.content.style_guides,
      export_formats: firstNonEmptyArray(user?.content?.export_formats, client?.content?.export_formats, agency?.content?.export_formats, role.content.export_formats),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PermissionService
// ─────────────────────────────────────────────────────────────────────────────

export const permissionService = {
  /**
   * Resolve the effective permission set for a user.
   *
   * Resolution order (highest → lowest priority):
   *   1. User.permissionsOverride
   *   2. Client.permissionsOverride  (only when clientId is provided)
   *   3. Agency.permissionsOverride
   *   4. Role default from ROLE_DEFAULTS
   *
   * @param agencyId  Agency (org) ID
   * @param clerkUserId  Clerk user sub (req.auth.userId)
   * @param clientId  Optional: scopes client-level override into the resolution
   */
  async resolvePermissions(
    agencyId: string,
    clerkUserId: string,
    clientId?: string | null,
  ): Promise<PermissionSet> {
    // Load user record (find by clerkUserId within this agency)
    const user = await prisma.user.findFirst({
      where: { agencyId, clerkUserId },
      select: { role: true, permissionsOverride: true },
    })

    const role = user?.role ?? 'member'
    const roleDefaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS['member']

    // Load agency-level override
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { permissionsOverride: true },
    })

    // Load client-level override if clientId provided
    let clientOverride: Partial<PermissionSet> | null = null
    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: { permissionsOverride: true, requireOffline: true },
      })
      if (client) {
        clientOverride = (client.permissionsOverride as Partial<PermissionSet> | null) ?? null
        // requireOffline forces offline-only across all capabilities — always enforced
        if (client.requireOffline) {
          clientOverride = {
            ...clientOverride,
            llm:      { ...(clientOverride?.llm ?? {}),      online: false, offline: true },
            graphics: { ...(clientOverride?.graphics ?? {}), online: false, offline: true },
            video:    { ...(clientOverride?.video ?? {}),     online: false, offline: true },
          } as Partial<PermissionSet>
        }
      }
    }

    return mergePermissions(
      roleDefaults,
      (agency?.permissionsOverride as Partial<PermissionSet> | null) ?? null,
      clientOverride,
      (user?.permissionsOverride as Partial<PermissionSet> | null) ?? null,
    )
  },

  /**
   * Check a single boolean capability using dot-notation.
   * Examples: 'llm.online', 'graphics.enabled', 'content.humanizer'
   */
  async canUse(
    agencyId: string,
    clerkUserId: string,
    capability: string,
    clientId?: string | null,
  ): Promise<boolean> {
    const perms = await this.resolvePermissions(agencyId, clerkUserId, clientId)
    const [section, field] = capability.split('.')
    const sec = perms[section as keyof PermissionSet] as unknown as Record<string, unknown> | undefined
    if (!sec) return false
    const val = sec[field]
    if (typeof val === 'boolean') return val
    return false
  },

  /**
   * Return the resolved model allowlist for a user.
   * Empty array = all models allowed within their online/offline scope.
   */
  async allowedModels(
    agencyId: string,
    clerkUserId: string,
    clientId?: string | null,
  ): Promise<string[]> {
    const perms = await this.resolvePermissions(agencyId, clerkUserId, clientId)
    return perms.llm.models
  },

  /**
   * Return the resolved provider allowlist for graphics or video.
   * Empty array = all providers allowed within their online/offline scope.
   */
  async allowedProviders(
    agencyId: string,
    clerkUserId: string,
    type: 'graphics' | 'video',
    clientId?: string | null,
  ): Promise<string[]> {
    const perms = await this.resolvePermissions(agencyId, clerkUserId, clientId)
    return perms[type].providers
  },

  /**
   * Validate whether a specific image provider is allowed for this user.
   * Takes online/offline scope AND provider allowlist into account.
   */
  isImageProviderAllowed(perms: PermissionSet, provider: string): boolean {
    if (!perms.graphics.enabled) return false
    const isOfflineProvider = OFFLINE_PROVIDERS_IMAGE.has(provider)
    if (isOfflineProvider && !perms.graphics.offline) return false
    if (!isOfflineProvider && !perms.graphics.online) return false
    if (perms.graphics.providers.length > 0 && !perms.graphics.providers.includes(provider)) return false
    return true
  },

  /**
   * Validate whether a specific video provider is allowed for this user.
   */
  isVideoProviderAllowed(perms: PermissionSet, provider: string): boolean {
    if (!perms.video.enabled) return false
    const isOfflineProvider = OFFLINE_PROVIDERS_VIDEO.has(provider)
    if (isOfflineProvider && !perms.video.offline) return false
    if (!isOfflineProvider && !perms.video.online) return false
    if (perms.video.providers.length > 0 && !perms.video.providers.includes(provider)) return false
    return true
  },

  /**
   * Validate whether a specific LLM provider+model is allowed.
   */
  isLlmAllowed(perms: PermissionSet, provider: string, model: string): boolean {
    const isOfflineProvider = OFFLINE_LLM_PROVIDERS.has(provider)
    if (isOfflineProvider && !perms.llm.offline) return false
    if (!isOfflineProvider && !perms.llm.online) return false
    if (perms.llm.models.length > 0 && !perms.llm.models.includes(model)) return false
    return true
  },

  /** Get the role-default permissions for a given role name without a DB lookup. */
  getRoleDefaults(role: string): PermissionSet {
    return ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS['member']
  },

  /** Update the permissions override for a user, client, or agency. */
  async setUserPermissionsOverride(
    agencyId: string,
    clerkUserId: string,
    override: Partial<PermissionSet> | null,
  ): Promise<void> {
    await prisma.user.updateMany({
      where: { agencyId, clerkUserId },
      data: { permissionsOverride: override !== null ? JSON.parse(JSON.stringify(override)) as Prisma.InputJsonValue : Prisma.DbNull },
    })
  },

  async setClientPermissionsOverride(
    agencyId: string,
    clientId: string,
    override: Partial<PermissionSet> | null,
  ): Promise<void> {
    await prisma.client.updateMany({
      where: { id: clientId, agencyId },
      data: { permissionsOverride: override !== null ? JSON.parse(JSON.stringify(override)) as Prisma.InputJsonValue : Prisma.DbNull },
    })
  },

  async setAgencyPermissionsOverride(
    agencyId: string,
    override: Partial<PermissionSet> | null,
  ): Promise<void> {
    await prisma.agency.update({
      where: { id: agencyId },
      data: { permissionsOverride: override !== null ? JSON.parse(JSON.stringify(override)) as Prisma.InputJsonValue : Prisma.DbNull },
    })
  },
}
