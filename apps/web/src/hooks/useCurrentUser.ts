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

const ADMIN_ROLES  = new Set(['owner', 'super_admin', 'admin', 'org_admin'])
const OWNER_ROLES  = new Set(['owner', 'super_admin'])

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

  const role      = user?.role ?? ''
  const isOwner   = OWNER_ROLES.has(role)
  const isAdmin   = ADMIN_ROLES.has(role)
  const isManager = role === 'manager' || isAdmin
  const isLead    = role === 'lead' || isManager
  const isMember  = !!user

  return { user, loading, isOwner, isAdmin, isManager, isLead, isMember, setUser }
}
