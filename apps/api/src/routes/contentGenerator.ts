/**
 * contentGenerator.ts
 *
 * POST /api/v1/content-generator/research-and-write
 *   Search industry news (Google News RSS), synthesise, write N blogs + LinkedIn posts
 *
 * POST /api/v1/content-generator/download-docx
 *   Convert a blog's markdown content to a .docx file and stream it
 *
 * POST /api/v1/content-generator/save-to-review
 *   Persist generated blogs as a WorkflowRun so they appear in Reviews / Deliverables
 */

import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { prisma, getModelForRole } from '@contentnode/database'
import { callModel }           from '@contentnode/ai'
import {
  Document, Paragraph, TextRun, HeadingLevel, AlignmentType,
  convertInchesToTwip, BorderStyle, ExternalHyperlink, Packer,
  UnderlineType,
} from 'docx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsArticle {
  title:   string
  url:     string
  pubDate: string
  source:  string
  snippet: string
}

export interface GeneratedBlog {
  title:    string
  slug:     string
  excerpt:  string
  content:  string            // Markdown
  sources:  string[]
  linkedIn: { post: string; imagePrompt: string }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim()
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) })
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 3000)
}

async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, 6000)
    if (!res.ok) return ''
    const html = await res.text()
    return stripHtml(html)
  } catch {
    return ''
  }
}

async function searchGoogleNews(query: string, timeframeDays: number): Promise<NewsArticle[]> {
  try {
    const q = encodeURIComponent(`${query} news`)
    const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetchWithTimeout(rssUrl, 10000)
    if (!res.ok) return []
    const xml = await res.text()

    const cutoff    = new Date(Date.now() - timeframeDays * 86400000)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    const articles: NewsArticle[] = []
    let m: RegExpExecArray | null

    while ((m = itemRegex.exec(xml)) !== null && articles.length < 8) {
      const item    = m[1]
      const title   = decodeEntities(
        item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
          ?? item.match(/<title>([\s\S]*?)<\/title>/)?.[1]
          ?? '',
      )
      const rawLink = item.match(/<link>(.*?)<\/link>/)?.[1]
               ?? item.match(/<link\s*\/>([\s\S]*?)<\/item>/)?.[1]
               ?? ''
      // Google News redirects — grab the actual URL from the RSS guid
      const guid    = item.match(/<guid>(.*?)<\/guid>/)?.[1] ?? rawLink
      const snippet = decodeEntities(
        item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
          ?? item.match(/<description>([\s\S]*?)<\/description>/)?.[1]
          ?? '',
      ).slice(0, 300)
      const source  = decodeEntities(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '')
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ''

      // Filter by timeframe — if no pubDate, include anyway
      const tooOld = pubDate && new Date(pubDate) < cutoff
      if (!tooOld && title) {
        articles.push({ title, url: guid, pubDate, source, snippet })
      }
    }
    return articles
  } catch {
    return []
  }
}

// ─── Markdown → DOCX conversion ───────────────────────────────────────────────

function parseInlineRuns(line: string): TextRun[] {
  // Handle **bold**, [source: x] citations, and plain text
  const runs: TextRun[] = []
  const parts = line.split(/(\*\*[^*]+\*\*|\[source:[^\]]*\])/g)
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }))
    } else if (/^\[source:[^\]]*\]$/.test(part)) {
      runs.push(new TextRun({
        text: part,
        color: '6B7280',
        italics: true,
        size: 18,
      }))
    } else {
      runs.push(new TextRun({ text: part }))
    }
  }
  return runs.length ? runs : [new TextRun({ text: line })]
}

function blogToDocx(title: string, content: string, sources: string[], linkedIn?: { post: string; imagePrompt: string }): Document {
  const paragraphs: Paragraph[] = []

  // Title
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 52, color: '111827' })],
      spacing: { after: 400 },
    }),
  )

  // Content — line by line
  const lines = content.split('\n')
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }))
      continue
    }

    if (line.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: line.slice(3), bold: true, size: 28, color: '111827' })],
        spacing: { before: 360, after: 160 },
      }))
    } else if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: line.slice(4), bold: true, size: 24, color: '374151' })],
        spacing: { before: 280, after: 120 },
      }))
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      paragraphs.push(new Paragraph({
        bullet: { level: 0 },
        children: parseInlineRuns(line.slice(2)),
        spacing: { after: 120 },
      }))
    } else {
      paragraphs.push(new Paragraph({
        children: parseInlineRuns(line),
        spacing: { after: 200 },
      }))
    }
  }

  // Sources appendix (if not already in content)
  if (sources.length > 0 && !content.includes('## Sources')) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'Sources', bold: true, size: 28, color: '111827' })],
        spacing: { before: 400, after: 160 },
      }),
    )
    for (const url of sources) {
      try {
        const domain = new URL(url).hostname
        paragraphs.push(new Paragraph({
          bullet: { level: 0 },
          children: [
            new ExternalHyperlink({
              link: url,
              children: [new TextRun({ text: domain, color: '2563EB', underline: { type: UnderlineType.SINGLE } })],
            }),
          ],
          spacing: { after: 120 },
        }))
      } catch {
        paragraphs.push(new Paragraph({ bullet: { level: 0 }, text: url, spacing: { after: 120 } }))
      }
    }
  }

  // LinkedIn post section
  if (linkedIn?.post) {
    paragraphs.push(
      new Paragraph({ text: '', spacing: { after: 200 } }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'LinkedIn Post', bold: true, size: 28, color: '111827' })],
        spacing: { before: 400, after: 160 },
      }),
    )
    for (const line of linkedIn.post.split('\n')) {
      paragraphs.push(new Paragraph({
        children: parseInlineRuns(line.trimEnd()),
        spacing: { after: 160 },
      }))
    }
  }

  // Image prompt section
  if (linkedIn?.imagePrompt) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: 'Image Generation Prompt', bold: true, size: 28, color: '111827' })],
        spacing: { before: 400, after: 160 },
      }),
      new Paragraph({
        children: [new TextRun({ text: linkedIn.imagePrompt, italics: true, color: '374151' })],
        spacing: { after: 200 },
      }),
    )
  }

  return new Document({
    creator:     'ContentNode.ai',
    description: title,
    sections:    [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1),
            right:  convertInchesToTwip(1.2),
            bottom: convertInchesToTwip(1),
            left:   convertInchesToTwip(1.2),
          },
        },
      },
      children: paragraphs,
    }],
  })
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

const generateBody = z.object({
  clientId:      z.string().min(1),
  verticalId:    z.string().optional(),
  topics:        z.array(z.string().min(1)).min(1).max(6),
  timeframeDays: z.number().int().min(1).max(365).default(30),
  blogCount:     z.number().int().min(1).max(5).default(2),
})

const docxBody = z.object({
  title:    z.string().min(1),
  content:  z.string().min(1),
  sources:  z.array(z.string()).default([]),
  linkedIn: z.object({ post: z.string(), imagePrompt: z.string() }).optional(),
})

const reviewBody = z.object({
  clientId:   z.string().min(1),
  taskLabel:  z.string().min(1),
  blogs:      z.array(z.any()),
})

export async function contentGeneratorRoutes(app: FastifyInstance) {

  // ── POST /research-and-write ───────────────────────────────────────────────
  app.post('/research-and-write', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = generateBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' })
    const { clientId, verticalId, topics, timeframeDays, blogCount } = parsed.data

    // Auth check
    const client = await prisma.client.findFirst({ where: { id: clientId, agencyId }, select: { name: true } })
    if (!client) return reply.code(404).send({ error: 'Client not found' })

    // Brand voice
    const brandBuilder = await prisma.clientBrandBuilder.findFirst({
      where: { clientId, agencyId },
      select: { dataJson: true },
      orderBy: { updatedAt: 'desc' },
    })
    const brandData   = (brandBuilder?.dataJson ?? {}) as Record<string, unknown>
    const toneOfVoice = String(brandData.toneOfVoice ?? brandData.tone ?? brandData.brand_voice ?? '')

    // ── Research phase ──────────────────────────────────────────────────────
    // Parallel: fetch news for each topic, then scrape top article per topic
    const allArticles: NewsArticle[] = []
    await Promise.all(
      topics.map(async (topic) => {
        const articles = await searchGoogleNews(topic, timeframeDays)
        allArticles.push(...articles)
      }),
    )

    // Deduplicate by title, take top 12
    const seen = new Set<string>()
    const uniqueArticles = allArticles.filter((a) => {
      const key = a.title.toLowerCase().slice(0, 60)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 12)

    // Fetch article text for top 4 articles (parallel, fire-and-forget if slow)
    const enriched = await Promise.all(
      uniqueArticles.slice(0, 4).map(async (a) => ({
        ...a,
        bodyText: await fetchArticleText(a.url),
      })),
    )
    const rest = uniqueArticles.slice(4).map((a) => ({ ...a, bodyText: '' }))
    const articles = [...enriched, ...rest]

    // Source URLs
    const sourceUrls = [...new Set(articles.map((a) => a.url).filter(Boolean))].slice(0, 15)

    // ── Research synthesis + blog generation ───────────────────────────────
    const timeframeLabel = timeframeDays <= 7 ? 'the past week'
      : timeframeDays <= 31  ? 'the past month'
      : timeframeDays <= 93  ? 'the past 3 months'
      : timeframeDays <= 186 ? 'the past 6 months'
      : 'the past year'

    const articleDigest = articles.map((a, i) =>
      `${i + 1}. "${a.title}" (${a.source || 'unknown source'}, ${a.pubDate ? new Date(a.pubDate).toLocaleDateString() : 'recent'})\n   URL: ${a.url}\n   ${a.snippet || a.bodyText.slice(0, 200)}`,
    ).join('\n\n')

    const buildSystemPrompt = (priorTitles: string[]) => {
      const avoidClause = priorTitles.length > 0
        ? `\nDo NOT cover the same angle as these already-written blogs:\n${priorTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\nPick a completely fresh angle from the research.`
        : ''
      return `You are a content strategist and expert B2B blog writer${client.name ? ` for ${client.name}` : ''}.
You have been given a curated set of recent industry news articles (from ${timeframeLabel}).
Write ONE publication-ready blog post that synthesises insights from these articles.${avoidClause}
${toneOfVoice ? `\nBrand voice: ${toneOfVoice}` : ''}

Blog requirements:
- Title: compelling, SEO-friendly (no clickbait)
- 700–950 words of substantive content
- Structure: engaging intro → 3–4 H2 sections → concise conclusion
- Cite sources inline as [source: domain.com] where relevant
- End with a ## Sources section listing the actual URLs used from the articles above
- No generic filler — every paragraph must add insight from the research

Also write:
- LinkedIn post: 150–200 words, punchy hook, 3 key bullet takeaways, CTA to read the blog
- Image prompt: describe a professional blog header image (subject, style, composition, lighting, mood — no text or logos)

Use EXACTLY this format with these delimiter lines — nothing before or after:
%%TITLE%%
[title here]
%%SLUG%%
[url-friendly-slug]
%%EXCERPT%%
[2-sentence summary]
%%CONTENT%%
[full markdown blog content]
%%LINKEDIN%%
[linkedin post text]
%%IMAGE_PROMPT%%
[image generation prompt]
%%SOURCES%%
[one URL per line]`
    }

    const userPrompt = `Research topics: ${topics.join(', ')}
Client: ${client.name}
Timeframe: ${timeframeLabel}

NEWS ARTICLES FOUND (${articles.length} articles):
${articleDigest}`

    const parseBlog = (text: string): GeneratedBlog | null => {
      const get = (key: string, nextKey: string) => {
        const re = new RegExp(`%%${key}%%\\s*([\\s\\S]*?)\\s*(?=%%${nextKey}%%|$)`)
        return text.match(re)?.[1]?.trim() ?? ''
      }
      const title       = get('TITLE',        'SLUG')
      const slug        = get('SLUG',         'EXCERPT')
      const excerpt     = get('EXCERPT',      'CONTENT')
      const content     = get('CONTENT',      'LINKEDIN')
      const post        = get('LINKEDIN',     'IMAGE_PROMPT')
      const imagePrompt = get('IMAGE_PROMPT', 'SOURCES')
      const sourcesRaw  = get('SOURCES',      'END_NEVER_MATCHES')
      if (!title || !content) {
        console.warn('[research-and-write] delimiter parse failed — missing title or content')
        return null
      }
      const sources  = sourcesRaw.split('\n').map(s => s.trim()).filter(s => s.startsWith('http'))
      const autoSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return { title, slug: slug || autoSlug, excerpt, content, sources, linkedIn: { post, imagePrompt } }
    }

    const generationModel = await getModelForRole('generation_primary')
    let blogs: GeneratedBlog[] = []
    let tokensUsed = 0
    for (let i = 0; i < blogCount; i++) {
      const priorTitles = blogs.map(b => b.title).filter(Boolean)
      try {
        const result = await callModel(
          {
            provider:      'anthropic',
            model:         generationModel,
            api_key_ref:   'ANTHROPIC_API_KEY',
            temperature:   0.65,
            max_tokens:    8192,
            system_prompt: buildSystemPrompt(priorTitles),
          },
          userPrompt,
        )
        tokensUsed += result.tokens_used ?? 0
        const blog = parseBlog(result.text)
        if (blog) blogs.push(blog)
      } catch (err) {
        console.error(`[research-and-write] blog ${i + 1} failed:`, err)
      }
    }
    if (!blogs.length) return reply.code(500).send({ error: 'Generation failed — check API connectivity or try again' })

    return reply.send({
      data: {
        blogs,
        research: {
          articlesFound: articles.length,
          articles: articles.map((a) => ({ title: a.title, url: a.url, source: a.source, pubDate: a.pubDate })),
          sourceUrls,
        },
        tokensUsed,
      },
    })
  })

  // ── POST /download-docx ────────────────────────────────────────────────────
  app.post('/download-docx', async (req, reply) => {
    const parsed = docxBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' })
    const { title, content, sources, linkedIn } = parsed.data

    const doc    = blogToDocx(title, content, sources, linkedIn)
    const buffer = await Packer.toBuffer(doc)
    const slug   = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${slug}.docx"`)
      .send(buffer)
  })

  // ── POST /save-to-review ──────────────────────────────────────────────────
  // Persists generated blogs as a WorkflowRun so they show in Reviews/Deliverables
  app.post('/save-to-review', async (req, reply) => {
    const { agencyId } = req.auth
    const parsed = reviewBody.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request' })
    const { clientId, taskLabel, blogs } = parsed.data

    // Find or create a "Content Hub" system workflow for this client
    let workflow = await prisma.workflow.findFirst({
      where: { agencyId, clientId, name: 'Content Hub' },
      select: { id: true },
    })
    if (!workflow) {
      workflow = await prisma.workflow.create({
        data: {
          agencyId,
          clientId,
          name:             'Content Hub',
          connectivityMode: 'online',
        },
        select: { id: true },
      })
    }

    const run = await prisma.workflowRun.create({
      data: {
        agencyId,
        workflowId:   workflow.id,
        status:       'completed',
        reviewStatus: 'pending',
        output: {
          generatedContent: true,
          sourceLabel:      taskLabel,
          blogs:            blogs.map((b: GeneratedBlog) => ({
            title:    b.title,
            slug:     b.slug,
            excerpt:  b.excerpt,
            sources:  b.sources,
          })),
          // Store full content separately for retrieval
          blogContents: (blogs as GeneratedBlog[]).map((b) => ({
            title:    b.title,
            content:  b.content,
            linkedIn: b.linkedIn,
          })),
        },
      },
      select: { id: true },
    })

    return reply.send({ data: { runId: run.id, workflowId: workflow.id } })
  })
}
