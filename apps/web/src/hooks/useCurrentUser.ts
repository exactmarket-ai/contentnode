import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  role: 'owner' | 'admin' | 'lead' | 'member'
  createdAt: string
}

let cached: CurrentUser | null = null

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

  const isOwner = user?.role === 'owner'
  const isAdmin = user?.role === 'admin' || isOwner
  const isLead  = user?.role === 'lead' || isAdmin
  const isMember = !!user

  return { user, loading, isOwner, isAdmin, isLead, isMember }
}
