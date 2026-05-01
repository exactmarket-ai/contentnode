import Anthropic from '@anthropic-ai/sdk'
import { prisma, withAgency, getModelForRole } from '@contentnode/database'
import { fetchUrlText, synthesiseThoughtLeaderContext } from './clientBrainExtraction.js'

interface SocialProfile {
  platform: 'linkedin' | 'x' | 'substack' | 'website' | 'other'
  url: string
  syncEnabled: boolean
}

async function searchAndSummarize(
  query: string,
  memberName: string,
  platform: string,
  url: string,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 0 })
  const { model: wsModel } = await getModelForRole('brain_processing')

  const prompt = `Search for recent public content from ${memberName} on ${platform}.
Search query: ${query}
Profile URL: ${url}

Analyze what you find and write a structured signal report in this format:

SOCIAL & WEB PRESENCE SIGNAL

Platform: ${platform}
URL: ${url}
Period: ${new Date().getFullYear()} (recent)
Content analyzed: [estimated count of posts/articles found]

Topics they are actively posting or writing about:
[bullet list of topics, one per line starting with -]

Language and framing patterns observed:
[2-3 sentences on how they write — sentence length, vocabulary, how they open]

Positions and perspectives visible in recent content:
[2-3 sentences on what they are saying and what they are not saying]

Engagement signals:
[which content got the most engagement and why — if detectable, otherwise note "not detectable"]

If no content is found for this person on this platform, respond with only: NO_CONTENT_FOUND`

  try {
    const response = await anthropic.messages.create({
      model: wsModel,
      max_tokens: 1200,
      system: 'You are a social media researcher extracting voice and positioning signals from a thought leader\'s public content. Return plain text, no JSON.',
      tools: [{ type: 'web_search_20250305' as never, name: 'web_search', max_uses: 3 } as never],
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!text || text.includes('NO_CONTENT_FOUND')) return null
    return text
  } catch {
    return null
  }
}

async function fetchAndSummarizeUrl(
  url: string,
  memberName: string,
  platform: string,
): Promise<string | null> {
  try {
    const html = await fetchUrlText(url)
    if (!html || html.length < 200) return null

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return null

    const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 0 })
    const { model: fuModel } = await getModelForRole('brain_processing')
    const response = await anthropic.messages.create({
      model: fuModel,
      max_tokens: 1000,
      system: 'You extract voice and positioning signals from web page content.',
      messages: [{
        role: 'user',
        content: `Analyze this content from ${memberName}'s ${platform} at ${url}.

PAGE CONTENT (first 8000 chars):
${html.slice(0, 8000)}

Write a signal report in this format:

SOCIAL & WEB PRESENCE SIGNAL

Platform: ${platform}
URL: ${url}
Period: recent
Content analyzed: [estimated count of posts/articles visible]

Topics they are actively posting or writing about:
[bullet list of topics, one per line starting with -]

Language and framing patterns observed:
[2-3 sentences on how they write — sentence length, vocabulary, how they open]

Positions and perspectives visible in recent content:
[2-3 sentences on what they are saying and what they are not saying]

Engagement signals:
[which content got the most engagement and why — if detectable, otherwise: not detectable from this page]

If no authored content is found, respond with only: NO_CONTENT_FOUND`,
      }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (!text || text.includes('NO_CONTENT_FOUND')) return null
    return text
  } catch {
    return null
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

function extractHandleFromX(url: string): string {
  const match = url.match(/(?:x\.com|twitter\.com)\/@?([^/?]+)/)
  return match?.[1] ?? ''
}

async function syncProfile(
  profile: SocialProfile,
  memberName: string,
  currentYear: number,
): Promise<string | null> {
  const { platform, url } = profile

  if (platform === 'linkedin') {
    const query = `site:linkedin.com "${memberName}" posts ${currentYear}`
    return searchAndSummarize(query, memberName, 'LinkedIn', url)
  }

  if (platform === 'x') {
    const handle = extractHandleFromX(url)
    const query = handle ? `from:${handle} recent tweets ${currentYear}` : `"${memberName}" site:x.com ${currentYear}`
    return searchAndSummarize(query, memberName, 'X / Twitter', url)
  }

  if (platform === 'substack') {
    return fetchAndSummarizeUrl(url, memberName, 'Substack')
  }

  if (platform === 'website') {
    return fetchAndSummarizeUrl(url, memberName, 'Personal site')
  }

  // 'other' — web search by name + domain
  const domain = extractDomain(url)
  const query = `"${memberName}" site:${domain} ${currentYear}`
  return searchAndSummarize(query, memberName, domain, url)
}

export async function runThoughtLeaderSocialSync(
  agencyId: string,
  leadershipMemberId: string,
  options: { synthesizeOnly?: boolean } = {},
): Promise<void> {
  await withAgency(agencyId, async () => {
    const member = await prisma.leadershipMember.findFirst({
      where: { id: leadershipMemberId, agencyId },
      select: { name: true, clientId: true, socialProfiles: true },
    })
    if (!member) {
      console.warn(`[tl-social-sync] member ${leadershipMemberId} not found`)
      return
    }

    // synthesizeOnly mode — just re-run synthesis from existing attachments
    if (options.synthesizeOnly) {
      await synthesiseThoughtLeaderContext(agencyId, member.clientId, leadershipMemberId)
      console.log(`[tl-social-sync] synthesis-only run for ${member.name}`)
      return
    }

    const profiles = (member.socialProfiles as unknown as SocialProfile[]).filter((p) => p.syncEnabled && p.url)
    if (profiles.length === 0) {
      console.log(`[tl-social-sync] no sync-enabled profiles for ${member.name}`)
      return
    }

    const currentYear = new Date().getFullYear()
    let writtenCount = 0

    for (const profile of profiles) {
      try {
        const signal = await syncProfile(profile, member.name, currentYear)
        if (!signal) {
          console.log(`[tl-social-sync] no content found for ${member.name} on ${profile.platform}`)
          continue
        }

        await prisma.thoughtLeaderBrainAttachment.create({
          data: {
            agencyId,
            clientId: member.clientId,
            leadershipMemberId,
            source: 'social_sync',
            content: signal,
            metadata: { platform: profile.platform, url: profile.url },
          },
        })
        writtenCount++
        console.log(`[tl-social-sync] wrote ${profile.platform} signal for ${member.name}`)
      } catch (err) {
        console.warn(`[tl-social-sync] ${profile.platform} sync failed for ${member.name}:`, err instanceof Error ? err.message : err)
      }
    }

    await prisma.leadershipMember.update({
      where: { id: leadershipMemberId },
      data: { socialSyncLastRanAt: new Date() },
    })

    if (writtenCount > 0) {
      await synthesiseThoughtLeaderContext(agencyId, member.clientId, leadershipMemberId).catch((err) => {
        console.error(`[tl-social-sync] synthesis failed for ${leadershipMemberId}:`, err)
      })
    }

    console.log(`[tl-social-sync] ${member.name} — ${writtenCount}/${profiles.length} profiles synced`)
  })
}
