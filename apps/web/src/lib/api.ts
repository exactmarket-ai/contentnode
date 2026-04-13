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

/** Resolve a worker-generated asset path (e.g. /files/generated/abc.png) to an absolute URL. */
export function assetUrl(localPath: string): string {
  return `${BASE_URL}${localPath}`
}

/**
 * Compress an image File to a base64 JPEG data URI using the browser Canvas API.
 * Resizes to maxWidth if larger, then encodes at the given quality.
 * Falls back to a plain FileReader read if canvas is unavailable.
 */
export function compressImageFile(
  file: File,
  maxWidth = 1280,
  quality = 0.85,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale  = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        // Canvas unavailable — fall back to uncompressed read
        const reader = new FileReader()
        reader.onload = e => resolve(e.target?.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = objectUrl
  })
}

// Download a cross-origin asset as a blob so the browser doesn't navigate away.
export async function downloadAsset(url: string, filename: string): Promise<void> {
  try {
    const res  = await fetch(url)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href     = objectUrl
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Delay revoke so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (e) {
    console.error('[downloadAsset] failed:', e)
    window.open(url, '_blank')
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
