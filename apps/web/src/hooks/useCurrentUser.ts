import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

export interface CurrentUser {
  id: string
  clerkId?: string
  email: string
  name: string | null
  title: string | null
  department: string | null
  avatarUrl: string | null
  role: string
  createdAt: string
}

const ADMIN_ROLES            = new Set(['owner', 'admin', 'org_admin'])
const OWNER_ROLES            = new Set(['owner'])
const TEMPLATE_MANAGER_ROLES = new Set([
  'owner', 'admin', 'org_admin',
  'editor', 'account_manager',
  'strategist', 'campaign_manager', 'project_manager',
  'content_manager', 'brand_manager',
])
// Client-facing roles that should NOT see productPILOT
const PILOT_EXCLUDED_ROLES = new Set([
  'client_legal_reviewer', 'client_brand_reviewer', 'client_creative_reviewer',
  'client_marcom_reviewer', 'client_product_reviewer', 'client_executive_approver',
  'client_stakeholder',
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
  const isManager          = isEditor
  const isLead             = isManager
  const isMember           = !!user
  const canManageTemplates  = TEMPLATE_MANAGER_ROLES.has(role)
  const canUsePilot         = !!user && !PILOT_EXCLUDED_ROLES.has(role)
  const isStrategist        = role === 'strategist'

  return { user, loading, isOwner, isAdmin, isEditor, isManager, isLead, isMember, canManageTemplates, canUsePilot, isStrategist, setUser }
}
