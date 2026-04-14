import { callModel, type ModelConfig } from '@contentnode/ai'
import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

const MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  api_key_ref: 'ANTHROPIC_API_KEY',
  temperature: 0.2,
  max_tokens: 4096,
}

const REDDIT_HEADERS = {
  'User-Agent': 'ContentNode/1.0 (market research bot; contact: hello@contentnode.ai)',
  Accept: 'application/json',
}

// ─────────────────────────────────────────────────────────────────────────────
// Reddit JSON API helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RedditPost {
  title: string
  selftext: string
  score: number
  num_comments: number
  permalink: string
  subreddit: string
  url: string
}

interface RedditComment {
  body: string
  score: number
  author: string
}

async function searchReddit(
  query: string,
  subreddit: string | null,
  limit: number,
  minScore: number,
): Promise<RedditPost[]> {
  try {
    const encoded = encodeURIComponent(query)
    const base = subreddit
      ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encoded}&restrict_sr=1`
      : `https://www.reddit.com/search.json?q=${encoded}`
    const url = `${base}&sort=top&t=year&limit=${limit}&type=link`
    const res = await fetch(url, { headers: REDDIT_HEADERS, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return []
    const data = await res.json() as {
      data?: { children?: Array<{ data: RedditPost }> }
    }
    return (data.data?.children ?? [])
      .map((c) => c.data)
      .filter((p) => p.score >= minScore)
  } catch {
    return []
  }
}

async function fetchTopComments(permalink: string, max: number): Promise<RedditComment[]> {
  try {
    const url = `https://www.reddit.com${permalink}.json?limit=${max}&depth=1&sort=top`
    const res = await fetch(url, { headers: REDDIT_HEADERS, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = await res.json() as Array<{
      data?: { children?: Array<{ data: RedditComment }> }
    }>
    const commentListing = data[1]?.data?.children ?? []
    return commentListing
      .map((c) => c.data)
      .filter((c) => c.body && c.body !== '[deleted]' && c.score > 0)
      .slice(0, max)
  } catch {
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis prompts
// ─────────────────────────────────────────────────────────────────────────────

const SYNTHESIS_PROMPTS: Record<string, string> = {
  pain_points: `You are a market research analyst. Analyze the following Reddit discussions and extract the audience's real pain points.

For each pain point:
- State the problem in the audience's own language
- Note how frequently it appears (many/some/occasional)
- Include 1-2 direct quotes that capture it best
- Rate the emotional intensity (frustration/irritation/mild concern)

Group by category. End with: **Top 3 Pain Points** for use in marketing copy.`,

  vocabulary: `You are a brand voice researcher. Analyze these Reddit discussions to extract the authentic vocabulary this audience uses.

Extract:
1. **Industry jargon and terminology** they use (not what vendors use)
2. **Phrases that signal frustration** (exact wording)
3. **Phrases that signal delight/success** (exact wording)
4. **How they describe their job/role** to themselves
5. **Metaphors and analogies** they reach for
6. **Words to avoid** — terms that sound inauthentic or "salesy" to this audience

This vocabulary map is for use in content, ads, and sales copy.`,

  objections: `You are a sales strategist. Analyze these Reddit discussions to map the objections and concerns this audience has.

For each objection:
- The objection as they'd say it
- What's really behind it (underlying fear/concern)
- How often it appears
- What makes them change their mind (based on what they say works)

Organize by: Budget/ROI, Trust/Risk, Complexity/Time, Competitive, Status quo bias.
End with: **Top 5 Objections to Address in Sales Process**.`,

  questions: `You are a content strategist. Extract the questions this audience is actively asking in these discussions.

Output:
1. **FAQ** — questions asked directly (with how many times each type appeared)
2. **Implied questions** — concerns not asked directly but clearly present
3. **Content gaps** — questions that weren't well-answered in the discussions
4. **Search intent** — what they'd type into Google to find answers

Map each question to a content format (blog post, video, FAQ page, etc.) and funnel stage.`,

  all: `You are a market intelligence analyst. Perform a complete audience signal analysis of these Reddit discussions.

Deliver:
1. **Audience portrait** — who is participating, their sophistication level, their context
2. **Pain points** — top 5 with direct quotes
3. **Vocabulary map** — authentic language to use/avoid
4. **Question map** — what they want answers to
5. **Objections** — top objections with counter-narratives
6. **Sentiment** — overall mood toward this problem space and available solutions
7. **Opportunity signals** — unmet needs and content/product gaps

Format for use in a demand gen brief.`,
}

// ─────────────────────────────────────────────────────────────────────────────
// Executor
// ─────────────────────────────────────────────────────────────────────────────

export class AudienceSignalExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const searchTerms = ((config.searchTerms as string | undefined) ?? '')
      .split('\n').map((t) => t.trim()).filter(Boolean)
    const subreddits = ((config.subreddits as string | undefined) ?? '')
      .split('\n').map((s) => s.trim().replace(/^r\//i, '')).filter(Boolean)
    const minUpvotes = Math.max(1, (config.minUpvotes as number) ?? 5)
    const maxPosts = Math.min(50, Math.max(5, (config.maxPosts as number) ?? 25))
    const synthesisGoal = (config.synthesisGoal as string) ?? 'all'

    if (searchTerms.length === 0) {
      throw new Error('Audience Signal: at least one search term is required')
    }

    // ── Collect Reddit data ───────────────────────────────────────────────────
    const allPosts: RedditPost[] = []

    // Search with subreddit constraints (or globally if none specified)
    const searchTargets: Array<[string, string | null]> = []
    if (subreddits.length > 0) {
      for (const term of searchTerms.slice(0, 3)) {
        for (const sub of subreddits.slice(0, 3)) {
          searchTargets.push([term, sub])
        }
      }
    } else {
      for (const term of searchTerms.slice(0, 3)) {
        searchTargets.push([term, null])
      }
    }

    const searchResults = await Promise.all(
      searchTargets.map(([term, sub]) =>
        searchReddit(term, sub, Math.ceil(maxPosts / searchTargets.length), minUpvotes)
      )
    )

    for (const posts of searchResults) {
      for (const post of posts) {
        if (!allPosts.some((p) => p.permalink === post.permalink)) {
          allPosts.push(post)
        }
      }
    }

    if (allPosts.length === 0) {
      throw new Error(
        'Audience Signal: no Reddit posts found. ' +
        'Try broader search terms or remove subreddit filters.'
      )
    }

    // Sort by score and take top posts
    allPosts.sort((a, b) => b.score - a.score)
    const topPosts = allPosts.slice(0, maxPosts)

    // ── Fetch comments for top posts ─────────────────────────────────────────
    const postsWithComments = await Promise.all(
      topPosts.slice(0, 15).map(async (post) => {
        const comments = post.num_comments > 0
          ? await fetchTopComments(post.permalink, 5)
          : []
        return { post, comments }
      })
    )

    // ── Format raw data for synthesis ────────────────────────────────────────
    const sections = postsWithComments.map(({ post, comments }, i) => {
      const lines = [
        `### Post ${i + 1}: "${post.title}"`,
        `r/${post.subreddit} | Score: ${post.score} | Comments: ${post.num_comments}`,
        `URL: https://reddit.com${post.permalink}`,
      ]
      if (post.selftext && post.selftext.length > 20) {
        lines.push(`\n**Post body:**\n${post.selftext.slice(0, 500)}`)
      }
      if (comments.length > 0) {
        lines.push('\n**Top comments:**')
        for (const c of comments) {
          lines.push(`- [${c.score} upvotes] ${c.body.slice(0, 300)}`)
        }
      }
      return lines.join('\n')
    })

    const rawData = [
      `# Reddit Audience Signal Research`,
      `Search terms: ${searchTerms.join(', ')}`,
      subreddits.length > 0 ? `Subreddits: ${subreddits.map((s) => `r/${s}`).join(', ')}` : 'Global Reddit search',
      `Posts analyzed: ${postsWithComments.length}`,
      '',
      ...sections,
    ].join('\n\n')

    // ── Synthesize ────────────────────────────────────────────────────────────
    const systemPrompt = SYNTHESIS_PROMPTS[synthesisGoal] ?? SYNTHESIS_PROMPTS.all
    const result = await callModel({ ...MODEL }, `${systemPrompt}\n\n${rawData}`)

    return {
      output: result.text,
      tokensUsed: result.tokens_used,
      modelUsed: result.model_used,
    }
  }
}
