/**
 * Thin API client. Reads Clerk session token if available and injects it as
 * Authorization: Bearer <token> on every request.
 *
 * Base URL: VITE_API_URL env var or '' (falls back to Vite proxy at /api).
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

async function getToken(): Promise<string | null> {
  try {
    // window.Clerk is the global singleton set by ClerkProvider after load
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clerk = (window as any).Clerk
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
    // Only set Content-Type for requests that actually have a body
    ...(init.body == null || init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch (err) {
    console.error('[api] network error — is the API server running?', err)
    throw new Error('Cannot reach the API server. Make sure it is running on port 3001.')
  }

  console.log('[api] ←', res.status, url)

  if (res.status === 401) {
    const body = await res.clone().json().catch(() => ({}))
    console.error('[api] 401 — session invalid, signing out', body)
    // Session revoked server-side — force Clerk client to match
    const clerk = (window as any).Clerk
    if (clerk) clerk.signOut()
    throw new Error(`Auth error 401: ${body?.error ?? 'Session expired'}`)
  }

  if (res.status === 403) {
    const body = await res.clone().json().catch(() => ({}))
    console.error('[api] auth error', res.status, body)
    throw new Error(`Auth error 403: ${body?.error ?? 'Insufficient permissions'}`)
  }

  return res
}
