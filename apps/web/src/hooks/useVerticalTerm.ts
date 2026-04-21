import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/api'

let cached: string | null = null

export function invalidateVerticalTerm() {
  cached = null
}

export function useVerticalTerm() {
  const [term, setTerm] = useState<string>(cached ?? 'Vertical')

  useEffect(() => {
    if (cached) return
    apiFetch('/api/v1/settings')
      .then((r) => r.json())
      .then(({ data }) => {
        const t = (data?.verticalTerm as string | undefined)?.trim() || 'Vertical'
        cached = t
        setTerm(t)
      })
      .catch(() => {})
  }, [])

  return term
}
