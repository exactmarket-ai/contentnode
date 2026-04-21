import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  title: string | null
  department: string | null
  avatarUrl: string | null
  role: string
  createdAt: string
}

const ADMIN_ROLES            = new Set(['owner', 'super_admin', 'admin', 'org_admin'])
const OWNER_ROLES            = new Set(['owner', 'super_admin'])
const TEMPLATE_MANAGER_ROLES = new Set([
  'owner', 'super_admin', 'admin', 'org_admin',
  'manager', 'client_manager', 'editor',
  'strategist', 'campaign_manager', 'project_manager', 'account_manager',
  'content_manager', 'brand_manager',
])
const PILOT_ROLES = new Set([
  'owner', 'super_admin', 'admin', 'org_admin',
  'manager', 'client_manager', 'editor', 'lead',
  'strategist', 'campaign_manager', 'project_manager', 'account_manager',
  'content_manager', 'brand_manager', 'seo_specialist', 'performance_marketer',
])

let cached: CurrentUser | null = null

/** Call this after updating the profile so the next consumer re-fetches */
export function invalidateCurrentUser() {
  cached = null
}

export function useCurrentUser() {
  const [user, setUser]       = useState<CurrentUser | null>(cached)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    if (cached) return
    apiFetch('/api/v1/team/me')
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          cached = json.data
          setUser(json.data)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const role               = user?.role ?? ''
  const isOwner            = OWNER_ROLES.has(role)
  const isAdmin            = ADMIN_ROLES.has(role)
  const isEditor           = role === 'editor' || isAdmin
  const isManager          = role === 'manager' || isEditor
  const isLead             = role === 'lead' || isManager
  const isMember           = !!user
  const canManageTemplates = TEMPLATE_MANAGER_ROLES.has(role)
  const canUsePilot        = PILOT_ROLES.has(role)

  return { user, loading, isOwner, isAdmin, isEditor, isManager, isLead, isMember, canManageTemplates, canUsePilot, setUser }
}
