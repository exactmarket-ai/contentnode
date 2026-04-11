import { Node, Edge } from 'reactflow'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'blog' | 'social' | 'email' | 'seo' | 'general' | 'marketing'
  icon: string
  nodes: Node[]
  edges: Edge[]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // ★ RECOMMENDED — Full Campaign Brief → Content + Design Pack
  {
    id: 'full-campaign',
    name: 'Full Campaign Pack',
    description:
      'Feed in a campaign brief, brand docs, and product details. Generates a Creative Brief, Content Brief, and Visual Brief, then produces a blog post, LinkedIn post, email newsletter, ad copy, hero image, and social image pack — all humanized and ready for client review.',
    category: 'marketing',
    icon: 'Megaphone',
    nodes: [
      // ─── PHASE 1: INPUTS ────────────────────────────────────────────────────

      {
        id: 'src-campaign',
        type: 'source',
        position: { x: 80, y: 80 },
        data: {
          label: 'Campaign Brief',
          subtype: 'text-input',
          config: {
            subtype: 'text-input',
            text: '',
            placeholder:
              'Describe the campaign: goals, key messages, timeline, budget range, any mandatories or restrictions.',
          },
        },
      },
      {
        id: 'src-brand',
        type: 'source',
        position: { x: 80, y: 230 },
        data: {
          label: 'Brand & Company Profile',
          subtype: 'file-upload',
          config: {
            subtype: 'file-upload',
            description:
              'Upload brand guidelines, company overview, positioning statement, or tone-of-voice doc.',
          },
        },
      },
      {
        id: 'src-product',
        type: 'source',
        position: { x: 80, y: 380 },
        data: {
          label: 'Product / Service Brief',
          subtype: 'file-upload',
          config: {
            subtype: 'file-upload',
            description:
              'Upload product specs, features, differentiators, pricing, or a one-pager.',
          },
        },
      },
      {
        id: 'src-audience',
        type: 'source',
        position: { x: 80, y: 530 },
        data: {
          label: 'Target Audience',
          subtype: 'text-input',
          config: {
            subtype: 'text-input',
            text: '',
            placeholder:
              'Describe the target audience: job title, age range, industry, pain points, goals, objections.',
          },
        },
      },

      // ─── PHASE 2: MASTER CREATIVE BRIEF ─────────────────────────────────────

      {
        id: 'creative-brief',
        type: 'logic',
        position: { x: 380, y: 295 },
        data: {
          label: 'Creative Brief',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate',
            prompt: `You are a senior creative director at a top-tier marketing agency. Synthesize all inputs below into a comprehensive Creative Brief that will guide the entire campaign.

Structure your response EXACTLY as follows:

# Creative Brief

## 1. Campaign Overview
One clear, compelling sentence that captures what this campaign is and why it matters.

## 2. Campaign Goals
- Primary goal (measurable)
- Secondary goals (2–3 bullet points)

## 3. Target Audience
**Primary:** [title / age range / industry]
**Pain points:** [what keeps them up at night]
**Goals:** [what they're trying to achieve]
**What motivates them to act:** [specific triggers]

## 4. Key Messages (ranked by priority)
1. [Most important — must appear in every asset]
2. [Second priority]
3. [Third priority]
4. [Supporting message]
5. [Supporting message]

## 5. Brand Voice & Tone
- Personality in 3 adjectives: [e.g. bold, empathetic, authoritative]
- Formality level: [formal / semi-formal / casual]
- Point of view: [first person / second person / third person]
- Always use: [signature phrases or language patterns from the brand]
- Never say: [words, phrases, or tones to avoid]

## 6. Unique Value Proposition
One sentence: "[Brand] helps [audience] [achieve outcome] by [differentiating mechanism]."

## 7. Visual Direction
- Overall aesthetic: [clean & modern / bold & expressive / warm & human / etc.]
- Color mood: [warm / cool / neutral — describe energy and emotion]
- Imagery style: [photography / illustration / mixed — candid / staged / abstract]
- Approved visual themes: [list 3–5 recurring visual concepts]
- Visual taboos: [what to never show or evoke]

## 8. The Big Idea
2–3 sentences: the single creative concept tying all assets together. The tagline, metaphor, or theme that runs through everything.

## 9. Deliverables This Campaign Requires
- Blog Post (800–1,200 words)
- LinkedIn Post (150–300 words)
- Email Newsletter (250–400 words)
- Ad Copy (search, social, display)
- Hero Image (website / blog header)
- Social Media Image Pack (LinkedIn, Instagram)

## 10. Success Metrics
How will we know this campaign worked? (clicks, leads, engagement rate, etc.)`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.6,
              max_tokens: 2000,
            },
          },
        },
      },

      // ─── PHASE 3: SPECIALIZED BRIEFS ────────────────────────────────────────

      {
        id: 'content-brief',
        type: 'logic',
        position: { x: 660, y: 140 },
        data: {
          label: 'Content Writer Brief',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate',
            prompt: `You are a content strategy director briefing a team of writers. Using the Creative Brief below, produce a detailed Content Writing Brief.

# Content Writing Brief

## Voice & Tone Rules (apply to ALL formats)
Write 5 specific, actionable guidelines. Not generic — pulled directly from the brand's voice in the Creative Brief.
Example: "Use second-person ('you') throughout. Never start a paragraph with 'We'."

## Key Messages — Priority Order
List each key message and note: which formats it must appear in, suggested placement (headline / body / CTA), and the exact emotional note to hit.

## Language Toolkit
**Power words to use:** [10–15 words that match brand voice and resonate with audience]
**Phrases to avoid:** [specific language that feels off-brand or alienates the audience]
**Tone calibration:** [one sentence per format — blog: __, LinkedIn: __, email: __, ads: __]

## Call-to-Action Strategy
Primary CTA: [the action we most want readers to take]
CTA language options: [3–5 ways to phrase it across formats]
Urgency/scarcity signals to use (if any):

## Per-Format Writing Instructions

### Blog Post (800–1,200 words)
- Headline formula: [structure or approach — question / how-to / list / bold statement]
- Opening: [specific guidance on the hook — stat, story, provocation?]
- Structure: [H2 section topics to cover]
- Closing: [how to end + CTA placement]
- SEO note: [primary keyword phrase if known]

### LinkedIn Post (150–300 words)
- Opening line rule: [how to start — what format grabs attention for this audience]
- Format preference: [short paragraphs / bullet points / numbered list]
- Hashtag strategy: [how many, what type]
- Engagement hook: [end with question / poll / challenge?]

### Email Newsletter (250–400 words)
- Subject line formula: [approach — curiosity / benefit / urgency / personalization]
- Preview text strategy:
- Email body structure: [sections and their purpose]
- CTA placement and copy guidance:

### Ad Copy
- What emotion should the ad trigger first?
- Lead with: [pain point / aspiration / curiosity / social proof]
- Unique angle vs. competitors:`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.5,
              max_tokens: 1800,
            },
          },
        },
      },

      {
        id: 'visual-brief',
        type: 'logic',
        position: { x: 660, y: 460 },
        data: {
          label: 'Visual Designer Brief',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate',
            prompt: `You are an art director briefing a design team and AI image generation pipeline. Using the Creative Brief below, produce a detailed Visual Design Brief.

# Visual Design Brief

## Creative Direction Summary
2–3 sentences: the visual story this campaign tells. What should someone feel in the first 3 seconds of seeing any asset?

## Style Pillars
Define 3 visual pillars with a name and description each.
Example: "Human Connection — real people, candid moments, eye contact. Not stock-photo stiffness."

## Color Direction
- Primary emotional note: [energetic / calm / trustworthy / playful / premium / etc.]
- Color temperature: [warm / cool / neutral]
- Palette guidance: [specific colors if known from brand; otherwise describe the mood]
- What to avoid: [clashing colors, neon overload, etc.]

## Imagery Style
- Photography vs. illustration vs. mixed: [choice + rationale]
- If photography: [candid / staged / lifestyle / documentary / architectural / product]
- Lighting mood: [bright & airy / dramatic contrast / golden hour / studio clean / etc.]
- People guidance: [include / avoid / diverse / specific demographic]
- Composition preference: [centered / rule-of-thirds / full-bleed / white space heavy]

## Absolute Visual Taboos
List 5–8 things to never include in any asset for this brand.

## AI Image Generation Keywords
Write two keyword prompts — one for each asset below — optimized for AI image generation (Midjourney / DALL-E / Flux style):

### Hero Image (website/blog header, 1920×1080 or 16:9)
Prompt: [detailed visual description — subject, environment, lighting, style, mood, composition, color palette, aspect ratio]
Negative prompt: [what to exclude]

### Social Media Pack (LinkedIn 1200×627 / Instagram 1080×1080)
Prompt: [detailed visual description for social-optimized imagery]
Negative prompt: [what to exclude]`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.6,
              max_tokens: 1500,
            },
          },
        },
      },

      // ─── PHASE 4: CONTENT PRODUCTION ────────────────────────────────────────

      {
        id: 'blog-writer',
        type: 'logic',
        position: { x: 940, y: 30 },
        data: {
          label: 'Blog Post',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            output_type: 'blog_post',
            prompt: `You are a skilled content writer. Using the Content Writing Brief below, write a complete, publication-ready blog post.

## Deliverable

**Headline:** Write a primary headline + 2 alternatives (label them H1-A, H1-B, H1-C)

**Meta Description:** 150–155 characters, includes primary keyword, compels the click.

**Blog Post Body (800–1,200 words):**
- Opening paragraph: hook immediately — a surprising stat, a counterintuitive statement, or a vivid scenario. No "In today's world" openers.
- 3–4 main sections with H2 subheadings
- Use short paragraphs (2–4 sentences max). Break up text with bullet points where logical.
- Weave in the Key Messages from the brief — don't force them, make them feel natural.
- Pull quote: Identify the single most quotable sentence and format it as a pull quote (put it on its own line between --- markers)
- Closing paragraph: summarize the insight + clear CTA

Write in the exact voice and tone specified in the brief. If the brief says casual, write casual. If formal, write formal.`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.7,
              max_tokens: 2000,
            },
          },
        },
      },

      {
        id: 'linkedin-writer',
        type: 'logic',
        position: { x: 940, y: 190 },
        data: {
          label: 'LinkedIn Post',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate',
            output_type: 'linkedin_post',
            prompt: `You are a social media specialist. Using the Content Writing Brief below, write a LinkedIn post that stops the scroll.

## Deliverable

Write 2 LinkedIn post variations (label them Version A and Version B — different angles, same brand voice):

**Format rules:**
- First line must be the hook — bold, specific, surprising, or provocative. No "Excited to share" or "Thrilled to announce."
- Short paragraphs — 1–3 sentences each. LinkedIn readers skim.
- Use line breaks between paragraphs (blank line between each).
- Build to a clear point or insight.
- End with either: a direct question to prompt comments, OR a CTA that's specific and easy to act on.
- 3–5 hashtags at the end (relevant, not generic).
- 150–300 words per version.

Match the voice and tone from the brief exactly.`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.72,
              max_tokens: 800,
            },
          },
        },
      },

      {
        id: 'email-writer',
        type: 'logic',
        position: { x: 940, y: 350 },
        data: {
          label: 'Email Newsletter',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate',
            output_type: 'email',
            prompt: `You are an email marketing specialist. Using the Content Writing Brief below, write a high-converting marketing email.

## Deliverable

**Subject Lines (write 3 options — A/B/C test candidates):**
- A: [benefit-forward, under 50 chars]
- B: [curiosity-gap, under 50 chars]
- C: [personalization or urgency angle, under 50 chars]

**Preview Text (90 chars max):** Complements the subject line, doesn't repeat it.

**Email Body:**
Greeting → [first name], or a segment-specific opener
Hook (1–2 sentences): Lead with value, not the company name.
Body (3–5 short paragraphs or bullet sections): Deliver the message. Short sentences. One idea per paragraph.
CTA Button Copy: [2–5 words, action-oriented — not "Click Here" or "Learn More"]
Supporting CTA line: One sentence around the button to reduce friction.
P.S. line: Optional but often gets the second-highest click rate — use it to reinforce urgency or a secondary benefit.

Total body length: 200–350 words. Scannable. No walls of text.`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.65,
              max_tokens: 1000,
            },
          },
        },
      },

      {
        id: 'adcopy-writer',
        type: 'logic',
        position: { x: 940, y: 510 },
        data: {
          label: 'Ad Copy',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'Generate Variations',
            output_type: 'ad_copy',
            prompt: `You are a direct-response copywriter. Using the Content Writing Brief below, write ad copy for multiple paid media formats.

## Deliverable

### Google / Search Ads
Write 3 complete ad variations. Each variation has:
- Headline 1 (30 chars max)
- Headline 2 (30 chars max)
- Headline 3 (30 chars max)
- Description 1 (90 chars max)
- Description 2 (90 chars max)

### Meta / Social Ads (Facebook & Instagram)
Write 3 hook variations for A/B testing. Each has:
- Primary Text (first 125 chars are shown before "more" — make them count)
- Headline (27 chars max — shown below the image)
- CTA button: [choose from: Learn More / Shop Now / Sign Up / Get Quote / Contact Us / Download]

### LinkedIn Ads
- Introductory text (150 chars max)
- Headline (70 chars max)
- CTA: [choose appropriate]

### Banner / Display Ads
One set of copy for standard display sizes:
- Super headline (4–6 words — the attention grabber)
- Headline (8–12 words — the value prop)
- CTA (2–4 words)

Lead with the primary emotion from the brief. Every character counts.`,
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.75,
              max_tokens: 1500,
            },
          },
        },
      },

      {
        id: 'img-prompt-hero',
        type: 'logic',
        position: { x: 940, y: 670 },
        data: {
          label: 'Hero Image Prompt',
          subtype: 'image-prompt-builder',
          config: {
            subtype: 'image-prompt-builder',
            style_hint: 'professional marketing photography, hero banner, 16:9 landscape',
            aspect_ratio_override: '16:9',
          },
        },
      },

      {
        id: 'img-prompt-social',
        type: 'logic',
        position: { x: 940, y: 820 },
        data: {
          label: 'Social Pack Prompt',
          subtype: 'image-prompt-builder',
          config: {
            subtype: 'image-prompt-builder',
            style_hint: 'social media graphic, bold composition, square format optimized for LinkedIn and Instagram',
            aspect_ratio_override: '1:1',
          },
        },
      },

      // ─── PHASE 5: HUMANIZE WRITTEN CONTENT ──────────────────────────────────

      {
        id: 'blog-hum',
        type: 'logic',
        position: { x: 1200, y: 30 },
        data: {
          label: 'Humanize Blog',
          subtype: 'humanizer-pro',
          config: { subtype: 'humanizer-pro', humanizer_service: 'undetectable' },
        },
      },
      {
        id: 'linkedin-hum',
        type: 'logic',
        position: { x: 1200, y: 190 },
        data: {
          label: 'Humanize LinkedIn',
          subtype: 'humanizer-pro',
          config: { subtype: 'humanizer-pro', humanizer_service: 'undetectable' },
        },
      },
      {
        id: 'email-hum',
        type: 'logic',
        position: { x: 1200, y: 350 },
        data: {
          label: 'Humanize Email',
          subtype: 'humanizer-pro',
          config: { subtype: 'humanizer-pro', humanizer_service: 'undetectable' },
        },
      },
      {
        id: 'adcopy-hum',
        type: 'logic',
        position: { x: 1200, y: 510 },
        data: {
          label: 'Humanize Ad Copy',
          subtype: 'humanizer-pro',
          config: { subtype: 'humanizer-pro', humanizer_service: 'undetectable' },
        },
      },

      // ─── PHASE 5B: IMAGE GENERATION ─────────────────────────────────────────

      {
        id: 'hero-gen',
        type: 'output',
        position: { x: 1200, y: 670 },
        data: {
          label: 'Hero Image',
          subtype: 'image-generation',
          config: {
            subtype: 'image-generation',
            provider: 'dalle3',
            aspect_ratio: '16:9',
            quality: 'hd',
            num_outputs: 1,
          },
        },
      },
      {
        id: 'social-gen',
        type: 'output',
        position: { x: 1200, y: 820 },
        data: {
          label: 'Social Pack',
          subtype: 'image-generation',
          config: {
            subtype: 'image-generation',
            provider: 'dalle3',
            aspect_ratio: '1:1',
            quality: 'hd',
            num_outputs: 2,
          },
        },
      },

      // ─── PHASE 6: OUTPUTS ────────────────────────────────────────────────────

      {
        id: 'out-blog',
        type: 'output',
        position: { x: 1460, y: 30 },
        data: {
          label: 'Blog Post',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
      {
        id: 'out-linkedin',
        type: 'output',
        position: { x: 1460, y: 190 },
        data: {
          label: 'LinkedIn Post',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
      {
        id: 'out-email',
        type: 'output',
        position: { x: 1460, y: 350 },
        data: {
          label: 'Email Newsletter',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
      {
        id: 'out-adcopy',
        type: 'output',
        position: { x: 1460, y: 510 },
        data: {
          label: 'Ad Copy',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
      {
        id: 'out-feedback',
        type: 'output',
        position: { x: 1460, y: 750 },
        data: {
          label: 'Client Feedback',
          subtype: 'client-feedback',
          config: {
            subtype: 'client-feedback',
            source_type: 'portal',
            trigger_mode: 'manual',
            max_auto_retries: 2,
            stakeholder_ids: [],
          },
        },
      },
    ],
    edges: [
      // Inputs → Creative Brief
      { id: 'e-src-campaign-brief',  source: 'src-campaign',  target: 'creative-brief' },
      { id: 'e-src-brand-brief',     source: 'src-brand',     target: 'creative-brief' },
      { id: 'e-src-product-brief',   source: 'src-product',   target: 'creative-brief' },
      { id: 'e-src-audience-brief',  source: 'src-audience',  target: 'creative-brief' },

      // Creative Brief → Specialized Briefs
      { id: 'e-brief-content',       source: 'creative-brief', target: 'content-brief' },
      { id: 'e-brief-visual',        source: 'creative-brief', target: 'visual-brief'  },

      // Content Brief → Writers
      { id: 'e-content-blog',        source: 'content-brief', target: 'blog-writer'     },
      { id: 'e-content-linkedin',    source: 'content-brief', target: 'linkedin-writer' },
      { id: 'e-content-email',       source: 'content-brief', target: 'email-writer'    },
      { id: 'e-content-adcopy',      source: 'content-brief', target: 'adcopy-writer'   },

      // Visual Brief → Image Prompt Builders
      { id: 'e-visual-hero-prompt',  source: 'visual-brief', target: 'img-prompt-hero'  },
      { id: 'e-visual-social-prompt',source: 'visual-brief', target: 'img-prompt-social'},

      // Writers → Humanizers
      { id: 'e-blog-hum',            source: 'blog-writer',     target: 'blog-hum'    },
      { id: 'e-linkedin-hum',        source: 'linkedin-writer', target: 'linkedin-hum'},
      { id: 'e-email-hum',           source: 'email-writer',    target: 'email-hum'   },
      { id: 'e-adcopy-hum',          source: 'adcopy-writer',   target: 'adcopy-hum'  },

      // Image Prompts → Image Generation
      { id: 'e-hero-gen',            source: 'img-prompt-hero',  target: 'hero-gen'   },
      { id: 'e-social-gen',          source: 'img-prompt-social',target: 'social-gen' },

      // Humanizers → Displays
      { id: 'e-hum-blog-out',        source: 'blog-hum',    target: 'out-blog'     },
      { id: 'e-hum-linkedin-out',    source: 'linkedin-hum',target: 'out-linkedin' },
      { id: 'e-hum-email-out',       source: 'email-hum',   target: 'out-email'    },
      { id: 'e-hum-adcopy-out',      source: 'adcopy-hum',  target: 'out-adcopy'   },

      // Written content → Client Feedback
      { id: 'e-blog-feedback',       source: 'out-blog',    target: 'out-feedback' },
    ],
  },

  // ★ RECOMMENDED — Blog Post with Humanizer Loop
  {
    id: 'blog-humanizer',
    name: 'Blog Post with Humanizer',
    description:
      'Generates a blog post with Claude, humanizes via StealthGPT, runs AI detection, and loops back if score is too high.',
    category: 'blog',
    icon: 'RefreshCw',
    nodes: [
      {
        id: 'source-1',
        type: 'source',
        position: { x: 100, y: 160 },
        data: {
          label: 'Upload Document',
          subtype: 'file-upload',
          config: { subtype: 'file-upload' },
        },
      },
      {
        id: 'source-2',
        type: 'source',
        position: { x: 100, y: 280 },
        data: {
          label: 'Instructions',
          subtype: 'text-input',
          config: { subtype: 'text-input', text: '' },
        },
      },
      {
        id: 'ai-1',
        type: 'logic',
        position: { x: 320, y: 200 },
        data: {
          label: 'Generate Blog Post',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            output_type: 'blog_post',
            prompt: '',
            model_config: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-6',
              temperature: 0.7,
            },
          },
        },
      },
      {
        id: 'hum-1',
        type: 'logic',
        position: { x: 540, y: 200 },
        data: {
          label: 'Humanize',
          subtype: 'humanizer-pro',
          config: {
            subtype: 'humanizer-pro',
            humanizer_service: 'undetectable',
          },
        },
      },
      {
        id: 'det-1',
        type: 'logic',
        position: { x: 760, y: 200 },
        data: {
          label: 'Detect AI',
          subtype: 'detection',
          config: {
            subtype: 'detection',
            service: 'local',
            threshold: 40,
            max_retries: 3,
          },
        },
      },
      {
        id: 'branch-1',
        type: 'logic',
        position: { x: 980, y: 200 },
        data: {
          label: 'Check Score',
          subtype: 'conditional-branch',
          config: {
            subtype: 'conditional-branch',
            condition_type: 'detection_score',
            operator: 'above',
            value: 40,
          },
        },
      },
      {
        id: 'out-1',
        type: 'output',
        position: { x: 1200, y: 200 },
        data: {
          label: 'Display',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-source-1-ai-1', source: 'source-1', target: 'ai-1' },
      { id: 'e-source-2-ai-1', source: 'source-2', target: 'ai-1' },
      { id: 'e-ai-1-hum-1', source: 'ai-1', target: 'hum-1' },
      { id: 'e-hum-1-det-1', source: 'hum-1', target: 'det-1' },
      { id: 'e-det-1-branch-1', source: 'det-1', target: 'branch-1' },
      { id: 'e-branch-1-out-1', source: 'branch-1', target: 'out-1', sourceHandle: 'pass' },
      { id: 'e-branch-1-hum-1', source: 'branch-1', target: 'hum-1', sourceHandle: 'fail' },
    ],
  },

  // Blog Post (Simple)
  {
    id: 'blog-simple',
    name: 'Blog Post (Simple)',
    description: 'Upload a document and expand it into a full blog post with AI.',
    category: 'blog',
    icon: 'FileText',
    nodes: [
      {
        id: 'source-1',
        type: 'source',
        position: { x: 100, y: 200 },
        data: {
          label: 'Upload Document',
          subtype: 'file-upload',
          config: { subtype: 'file-upload' },
        },
      },
      {
        id: 'ai-1',
        type: 'logic',
        position: { x: 320, y: 200 },
        data: {
          label: 'Generate Blog Post',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            output_type: 'blog_post',
            prompt: '',
          },
        },
      },
      {
        id: 'out-1',
        type: 'output',
        position: { x: 540, y: 200 },
        data: {
          label: 'Display',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-source-1-ai-1', source: 'source-1', target: 'ai-1' },
      { id: 'e-ai-1-out-1', source: 'ai-1', target: 'out-1' },
    ],
  },


  // 3. LinkedIn Post
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    description:
      'Turn a text brief into a polished LinkedIn post, then humanize it for a natural tone.',
    category: 'social',
    icon: 'Users',
    nodes: [
      {
        id: 'source-1',
        type: 'source',
        position: { x: 100, y: 200 },
        data: {
          label: 'Brief / Key Points',
          subtype: 'text-input',
          config: { subtype: 'text-input', text: '' },
        },
      },
      {
        id: 'ai-1',
        type: 'logic',
        position: { x: 320, y: 200 },
        data: {
          label: 'Generate LinkedIn Post',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'summarize',
            output_type: 'linkedin_post',
            prompt: '',
          },
        },
      },
      {
        id: 'hum-1',
        type: 'logic',
        position: { x: 540, y: 200 },
        data: {
          label: 'Humanize',
          subtype: 'humanizer-pro',
          config: {
            subtype: 'humanizer-pro',
            humanizer_service: 'undetectable',
          },
        },
      },
      {
        id: 'out-1',
        type: 'output',
        position: { x: 760, y: 200 },
        data: {
          label: 'Display',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-source-1-ai-1', source: 'source-1', target: 'ai-1' },
      { id: 'e-ai-1-hum-1', source: 'ai-1', target: 'hum-1' },
      { id: 'e-hum-1-out-1', source: 'hum-1', target: 'out-1' },
    ],
  },

  // 4. Email Newsletter
  {
    id: 'email-newsletter',
    name: 'Email Newsletter',
    description:
      'Convert a source document into a newsletter-style email and humanize the copy.',
    category: 'email',
    icon: 'Mail',
    nodes: [
      {
        id: 'source-1',
        type: 'source',
        position: { x: 100, y: 200 },
        data: {
          label: 'Upload Document',
          subtype: 'file-upload',
          config: { subtype: 'file-upload' },
        },
      },
      {
        id: 'ai-1',
        type: 'logic',
        position: { x: 320, y: 200 },
        data: {
          label: 'Generate Email',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            output_type: 'email',
            prompt: '',
          },
        },
      },
      {
        id: 'hum-1',
        type: 'logic',
        position: { x: 540, y: 200 },
        data: {
          label: 'Humanize',
          subtype: 'humanizer-pro',
          config: {
            subtype: 'humanizer-pro',
            humanizer_service: 'undetectable',
          },
        },
      },
      {
        id: 'out-1',
        type: 'output',
        position: { x: 760, y: 200 },
        data: {
          label: 'Display',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-source-1-ai-1', source: 'source-1', target: 'ai-1' },
      { id: 'e-ai-1-hum-1', source: 'ai-1', target: 'hum-1' },
      { id: 'e-hum-1-out-1', source: 'hum-1', target: 'out-1' },
    ],
  },

  // 5. Ad Copy Variations
  {
    id: 'ad-copy-variations',
    name: 'Ad Copy Variations',
    description:
      'Generate multiple ad copy variations from a product brief for testing and selection.',
    category: 'general',
    icon: 'Zap',
    nodes: [
      {
        id: 'source-1',
        type: 'source',
        position: { x: 100, y: 200 },
        data: {
          label: 'Product Brief',
          subtype: 'text-input',
          config: { subtype: 'text-input', text: '' },
        },
      },
      {
        id: 'ai-1',
        type: 'logic',
        position: { x: 320, y: 200 },
        data: {
          label: 'Generate Ad Copy',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'Generate Variations',
            output_type: 'ad_copy',
            prompt: '',
          },
        },
      },
      {
        id: 'out-1',
        type: 'output',
        position: { x: 540, y: 200 },
        data: {
          label: 'Display',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-source-1-ai-1', source: 'source-1', target: 'ai-1' },
      { id: 'e-ai-1-out-1', source: 'ai-1', target: 'out-1' },
    ],
  },

  // 6. Translated Blog Post
  {
    id: 'translated-blog',
    name: 'Translated Blog Post',
    description:
      'Generate a blog post from a document, humanize it, then translate it to Spanish.',
    category: 'blog',
    icon: 'Globe',
    nodes: [
      {
        id: 'source-1',
        type: 'source',
        position: { x: 100, y: 200 },
        data: {
          label: 'Upload Document',
          subtype: 'file-upload',
          config: { subtype: 'file-upload' },
        },
      },
      {
        id: 'ai-1',
        type: 'logic',
        position: { x: 320, y: 200 },
        data: {
          label: 'Generate Blog Post',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            output_type: 'blog_post',
            prompt: '',
          },
        },
      },
      {
        id: 'hum-1',
        type: 'logic',
        position: { x: 540, y: 200 },
        data: {
          label: 'Humanize',
          subtype: 'humanizer-pro',
          config: {
            subtype: 'humanizer-pro',
            humanizer_service: 'undetectable',
          },
        },
      },
      {
        id: 'trans-1',
        type: 'logic',
        position: { x: 760, y: 200 },
        data: {
          label: 'Translate to Spanish',
          subtype: 'translate',
          config: {
            subtype: 'translate',
            targetLanguage: 'ES',
            provider: 'deepl',
          },
        },
      },
      {
        id: 'out-1',
        type: 'output',
        position: { x: 980, y: 200 },
        data: {
          label: 'Display',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-source-1-ai-1', source: 'source-1', target: 'ai-1' },
      { id: 'e-ai-1-hum-1', source: 'ai-1', target: 'hum-1' },
      { id: 'e-hum-1-trans-1', source: 'hum-1', target: 'trans-1' },
      { id: 'e-trans-1-out-1', source: 'trans-1', target: 'out-1' },
    ],
  },

  // ★ Video Extractor: Title, Description, Thumbnail
  {
    id: 'video-extractor',
    name: 'Video Extractor: Title, Description, Thumbnail',
    description:
      'Upload a video to extract a thumbnail frame, then generate an SEO-optimised title (max 100 characters) and a 1000–1500 word description from a transcript or brief.',
    category: 'general',
    icon: 'Film',
    nodes: [
      // ─── INPUTS ────────────────────────────────────────────────────────────

      {
        id: 'vid-transcript',
        type: 'source',
        position: { x: 80, y: 80 },
        data: {
          label: 'Video Transcript or Brief',
          subtype: 'text-input',
          config: {
            subtype: 'text-input',
            text: '',
            placeholder:
              'Paste the video transcript here, or describe what the video is about. Include key topics, speakers, and any important points you want highlighted in the title and description.',
          },
        },
      },
      {
        id: 'vid-frame',
        type: 'source',
        position: { x: 80, y: 340 },
        data: {
          label: 'Upload Video',
          subtype: 'video-frame-extractor',
          config: {
            subtype: 'video-frame-extractor',
            video_files: [],
            timestamp_mode: 'percent',
            timestamp_value: 50,
          },
        },
      },

      // ─── TITLE GENERATION ──────────────────────────────────────────────────

      {
        id: 'vid-title-gen',
        type: 'logic',
        position: { x: 420, y: 80 },
        data: {
          label: 'Generate Title',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate-headlines',
            additional_instructions:
              'Create a YouTube video title for this content. Requirements:\n- Maximum 100 characters (including spaces)\n- Compelling and click-worthy without clickbait\n- Specific — include the main topic or key benefit\n- Front-load the most important keyword\n\nOutput ONLY the title — no quotes, no numbering, no explanation.',
            model_config: null,
          },
        },
      },
      {
        id: 'vid-title-out',
        type: 'output',
        position: { x: 760, y: 80 },
        data: {
          label: 'Video Title',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },

      // ─── DESCRIPTION GENERATION ────────────────────────────────────────────

      {
        id: 'vid-desc-gen',
        type: 'logic',
        position: { x: 420, y: 220 },
        data: {
          label: 'Generate Description',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            additional_instructions:
              'Write a YouTube video description based on this content. Requirements:\n- Length: 1000–1500 words\n- Structure:\n  1. Opening hook (2–3 sentences that grab attention and state the value)\n  2. What viewers will learn or gain (3–5 bullet points)\n  3. Key topics covered with placeholder timestamps (e.g. 0:00 Intro, 2:30 Topic 1, etc.)\n  4. About the presenter or channel (1 short paragraph — leave placeholder if unknown)\n  5. Call-to-action (subscribe, like, comment with a question)\n  6. 8–12 relevant hashtags on the final line\n- Tone: informative, conversational, SEO-friendly\n- Include the primary keyword naturally in the first 100 characters',
            model_config: null,
          },
        },
      },
      {
        id: 'vid-desc-out',
        type: 'output',
        position: { x: 760, y: 220 },
        data: {
          label: 'Video Description',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },
    ],
    edges: [
      { id: 'e-vid-transcript-title', source: 'vid-transcript', target: 'vid-title-gen' },
      { id: 'e-vid-transcript-desc',  source: 'vid-transcript', target: 'vid-desc-gen' },
      { id: 'e-vid-title-out',        source: 'vid-title-gen',  target: 'vid-title-out' },
      { id: 'e-vid-desc-out',         source: 'vid-desc-gen',   target: 'vid-desc-out' },
    ],
  },
]
