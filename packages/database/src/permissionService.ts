import { prisma } from './client.js'
import { Prisma } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────────
// Role directory — canonical numbered reference (super_admin = #1)
// Use the number when discussing role assignments before roles go live.
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_DIRECTORY: { num: number; slug: string; label: string }[] = [
  // ── Platform ownership ──────────────────────────────────────────────────────
  { num: 1,  slug: 'super_admin',            label: 'Super Admin' },
  { num: 2,  slug: 'owner',                  label: 'Owner (legacy)' },
  // ── Org administration ──────────────────────────────────────────────────────
  { num: 3,  slug: 'org_admin',              label: 'Org Admin' },
  { num: 4,  slug: 'admin',                  label: 'Admin (legacy)' },
  // ── Strategic / senior agency ───────────────────────────────────────────────
  { num: 5,  slug: 'strategist',             label: 'Strategist' },
  { num: 6,  slug: 'campaign_manager',       label: 'Campaign Manager' },
  { num: 7,  slug: 'project_manager',        label: 'Project Manager' },
  { num: 8,  slug: 'account_manager',        label: 'Account Manager' },
  // ── Client manager / lead tier ──────────────────────────────────────────────
  { num: 9,  slug: 'client_manager',         label: 'Client Manager' },
  { num: 10, slug: 'manager',                label: 'Manager (legacy)' },
  { num: 11, slug: 'lead',                   label: 'Lead (legacy)' },
  // ── Creative / editor tier ──────────────────────────────────────────────────
  { num: 12, slug: 'art_director',           label: 'Art Director' },
  { num: 13, slug: 'brand_manager',          label: 'Brand Manager' },
  { num: 14, slug: 'designer',               label: 'Designer' },
  { num: 15, slug: 'social_media_manager',   label: 'Social Media Manager' },
  { num: 16, slug: 'content_manager',        label: 'Content Manager' },
  { num: 17, slug: 'editor',                 label: 'Editor' },
  { num: 18, slug: 'member',                 label: 'Member (legacy)' },
  // ── Specialist / writer tier ────────────────────────────────────────────────
  { num: 19, slug: 'copywriter',             label: 'Copywriter' },
  { num: 20, slug: 'seo_specialist',         label: 'SEO Specialist' },
  { num: 21, slug: 'performance_marketer',   label: 'Performance Marketer' },
  // ── Internal review / compliance ────────────────────────────────────────────
  { num: 22, slug: 'compliance_reviewer',    label: 'Compliance Reviewer' },
  { num: 23, slug: 'reviewer',               label: 'Reviewer' },
  // ── Read-only / API access ──────────────────────────────────────────────────
  { num: 24, slug: 'viewer',                 label: 'Viewer' },
  { num: 25, slug: 'api_user',               label: 'API User' },
  // ── Client-facing / portal ──────────────────────────────────────────────────
  { num: 26, slug: 'client_executive_approver', label: 'Client: Executive Approver' },
  { num: 27, slug: 'client_legal_reviewer',     label: 'Client: Legal Reviewer' },
  { num: 28, slug: 'client_brand_reviewer',     label: 'Client: Brand Reviewer' },
  { num: 29, slug: 'client_creative_reviewer',  label: 'Client: Creative Reviewer' },
  { num: 30, slug: 'client_marcom_reviewer',    label: 'Client: MarCom Reviewer' },
  { num: 31, slug: 'client_product_reviewer',   label: 'Client: Product Reviewer' },
  { num: 32, slug: 'client_stakeholder',        label: 'Client: Stakeholder' },
]

export const ROLE_BY_NUM = Object.fromEntries(ROLE_DIRECTORY.map((r) => [r.num, r.slug]))
export const ROLE_NUM    = Object.fromEntries(ROLE_DIRECTORY.map((r) => [r.slug, r.num]))

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

const ONLINE_PROVIDERS_IMAGE = new Set(['dalle3', 'ideogram', 'leonardo', 'fal'])
const OFFLINE_PROVIDERS_IMAGE = new Set(['comfyui', 'automatic1111'])
const ONLINE_PROVIDERS_VIDEO = new Set(['runway', 'kling', 'luma', 'pika', 'veo2'])
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
  // ── Internal agency functional roles ─────────────────────────────────────
  strategist: {                                     // strategic lead; cloud LLM + graphics + video
    llm:      { online: true,  offline: true,  models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: true,  online: true,  offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: [] },
  },
  campaign_manager: {                               // campaign lead; same as strategist
    llm:      { online: true,  offline: true,  models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: true,  online: true,  offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: [] },
  },
  art_director: {                                   // cloud LLM + graphics, no video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  brand_manager: {                                  // cloud LLM + graphics, no video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  designer: {                                       // cloud LLM + graphics, no video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  social_media_manager: {                           // cloud LLM + graphics, no video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  content_manager: {                                // cloud LLM + graphics, no video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  copywriter: {                                     // cloud LLM + humanizer; no graphics/video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: ['pdf', 'docx'] },
  },
  seo_specialist: {                                 // cloud LLM only; no graphics/video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: false, export_formats: ['pdf', 'docx'] },
  },
  performance_marketer: {                           // cloud LLM only; no graphics/video
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: true, style_guides: false, export_formats: ['pdf', 'docx'] },
  },
  project_manager: {                                // full LLM + cloud media; ops oversight
    llm:      { online: true,  offline: true,  models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: true,  online: true,  offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: [] },
  },
  account_manager: {                                // cloud LLM + graphics + video; client liaison
    llm:      { online: true,  offline: true,  models: [] },
    graphics: { enabled: true,  online: true,  offline: false, providers: [] },
    video:    { enabled: true,  online: true,  offline: false, providers: [] },
    content:  { humanizer: true, style_guides: true, export_formats: [] },
  },
  compliance_reviewer: {                            // read + review only; no generation or graphics
    llm:      { online: true,  offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: ['pdf'] },
  },
  // ── Client-facing / portal roles ─────────────────────────────────────────
  client_legal_reviewer: {                          // external; read + feedback only
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  client_brand_reviewer: {
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  client_creative_reviewer: {
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  client_marcom_reviewer: {
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  client_product_reviewer: {
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
  },
  client_executive_approver: {                      // external executive; read + pdf export
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: ['pdf'] },
  },
  client_stakeholder: {                             // external viewer; read-only
    llm:      { online: false, offline: false, models: [] },
    graphics: { enabled: false, online: false, offline: false, providers: [] },
    video:    { enabled: false, online: false, offline: false, providers: [] },
    content:  { humanizer: false, style_guides: false, export_formats: [] },
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

    // Super-admin and owner always get full access — agency/client overrides cannot restrict them
    if (role === 'super_admin' || role === 'owner') return FULL_ACCESS

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
