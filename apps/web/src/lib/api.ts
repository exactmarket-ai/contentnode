/**
 * Thin API client. Reads Clerk session token if available and injects it as
 * Authorization: Bearer <token> on every request.
 *
 * Base URL: VITE_API_URL env var or '' (falls back to Vite proxy at /api).
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

async function getToken(): Promise<string | null> {
  try {
    // window.__clerk is set by ClerkProvider after sign-in
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clerk = (window as any).__clerk
    if (!clerk) return null
    const token = await clerk.session?.getToken()
    return token ?? null
  } catch {
    return null
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
    console.log('[api] token attached, length:', token.length)
  } else {
    console.warn('[api] no Clerk token — request will be unauthenticated')
  }

  const url = `${BASE_URL}${path}`
  console.log('[api] →', init.method ?? 'GET', url)

  const res = await fetch(url, { ...init, headers })
  console.log('[api] ←', res.status, url)
  return res
}
