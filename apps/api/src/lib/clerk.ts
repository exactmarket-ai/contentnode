/**
 * Shared Clerk backend client.
 * Used for server-side operations: email verification, session revocation.
 * Only available when CLERK_SECRET_KEY is set (not in DEV_MODE).
 */
import { createClerkClient } from '@clerk/backend'

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? ''

export const clerkClient = CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: CLERK_SECRET_KEY })
  : null

/**
 * Returns the primary email addresses for a Clerk user ID.
 * Returns [] if Clerk is not configured (dev mode).
 */
export async function getClerkUserEmails(clerkUserId: string): Promise<string[]> {
  if (!clerkClient) return []
  try {
    const user = await clerkClient.users.getUser(clerkUserId)
    return user.emailAddresses.map((e) => e.emailAddress.toLowerCase())
  } catch {
    return []
  }
}

/**
 * Batch-fetch display labels for a list of Clerk user IDs.
 * Returns a map of clerkUserId → { name, email } where:
 *   - name is "First Last" (null if not set in Clerk)
 *   - email is the primary email address
 * Returns {} if Clerk is not configured (dev mode) or all IDs are pending.
 */
export async function getClerkUserNames(
  clerkUserIds: string[],
): Promise<Record<string, { name: string | null; email: string }>> {
  if (!clerkClient) return {}
  const realIds = clerkUserIds.filter((id) => !id.startsWith('pending-'))
  if (realIds.length === 0) return {}

  const result: Record<string, { name: string | null; email: string }> = {}
  await Promise.allSettled(
    realIds.map(async (id) => {
      try {
        const u = await clerkClient!.users.getUser(id)
        const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || null
        const primaryEmail = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ?? ''
        result[id] = { name: fullName, email: primaryEmail }
      } catch {
        // user not found or Clerk error — skip
      }
    })
  )
  return result
}

/**
 * Revokes all active sessions for a Clerk user.
 * Called when a team member is removed so they lose access immediately.
 * Silently no-ops in dev mode or if the user doesn't exist in Clerk.
 */
export async function revokeUserSessions(clerkUserId: string): Promise<void> {
  if (!clerkClient) return
  if (clerkUserId.startsWith('pending-')) return
  try {
    const sessions = await clerkClient.sessions.getSessionList({
      userId: clerkUserId,
      status: 'active',
    })
    await Promise.all(sessions.data.map((s) => clerkClient!.sessions.revokeSession(s.id)))
  } catch (err) {
    // Non-fatal — log but don't block the delete
    console.error('[clerk] Failed to revoke sessions for', clerkUserId, err)
  }
}
