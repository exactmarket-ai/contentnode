import { Node, Edge } from 'reactflow'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'blog' | 'social' | 'email' | 'seo' | 'general' | 'marketing' | 'demand_gen'
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
      'Upload a video — automatically transcribes it, generates a title (max 100 chars) and full description (1000–1500 words) from the transcript, and extracts a downloadable thumbnail frame.',
    category: 'general',
    icon: 'Film',
    nodes: [
      // ─── SOURCE ─────────────────────────────────────────────────────────────

      {
        id: 'vid-source',
        type: 'source',
        position: { x: 80, y: 260 },
        data: {
          label: 'Upload Video',
          subtype: 'video-upload',
          config: { subtype: 'video-upload', video_files: [] },
        },
      },

      // ─── TRANSCRIPTION ───────────────────────────────────────────────────────

      {
        id: 'vid-transcription',
        type: 'source',
        position: { x: 380, y: 140 },
        data: {
          label: 'Transcription',
          subtype: 'transcription',
          config: {
            subtype: 'transcription',
            provider: 'assemblyai',
            api_key_ref: 'ASSEMBLYAI_API_KEY',
            enable_diarization: false,
            audio_files: [],
          },
        },
      },

      // ─── TITLE ───────────────────────────────────────────────────────────────

      {
        id: 'vid-title-gen',
        type: 'logic',
        position: { x: 680, y: 60 },
        data: {
          label: 'Generate Title',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'generate-headlines',
            additional_instructions:
              'Create a video title based on the transcript above.\n\nRequirements:\n- Maximum 100 characters (including spaces)\n- Compelling and specific — describe what the video is actually about\n- Front-load the most important keyword or topic\n- No clickbait, no vague promises\n\nOutput ONLY the title — no quotes, no numbering, no explanation.',
            model_config: null,
          },
        },
      },
      {
        id: 'vid-title-out',
        type: 'output',
        position: { x: 980, y: 60 },
        data: {
          label: 'Video Title',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },

      // ─── DESCRIPTION ─────────────────────────────────────────────────────────

      {
        id: 'vid-desc-gen',
        type: 'logic',
        position: { x: 680, y: 220 },
        data: {
          label: 'Generate Description',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            task_type: 'expand',
            additional_instructions:
              'Write a video description based on the transcript above.\n\nRequirements:\n- Length: 1000–1500 words\n- Structure:\n  1. Opening hook (2–3 sentences that grab attention and state the value)\n  2. What viewers will learn or gain (3–5 bullet points)\n  3. Key topics covered with placeholder timestamps (e.g. 0:00 Intro, 2:30 Topic 1)\n  4. About the presenter or channel (1 paragraph — use placeholders if unknown)\n  5. Call-to-action (subscribe, like, comment with a question)\n  6. 8–12 relevant hashtags on the final line\n- Tone: informative, conversational, SEO-friendly\n- Include the primary keyword naturally in the first 100 characters',
            model_config: null,
          },
        },
      },
      {
        id: 'vid-desc-out',
        type: 'output',
        position: { x: 980, y: 220 },
        data: {
          label: 'Video Description',
          subtype: 'display',
          config: { subtype: 'display' },
        },
      },

      // ─── THUMBNAIL ───────────────────────────────────────────────────────────

      {
        id: 'vid-frame',
        type: 'logic',
        position: { x: 380, y: 420 },
        data: {
          label: 'Extract Thumbnail',
          subtype: 'video-frame-extractor',
          config: {
            subtype: 'video-frame-extractor',
            timestamp_mode: 'percent',
            timestamp_value: 50,
          },
        },
      },
      {
        id: 'vid-thumb-dl',
        type: 'output',
        position: { x: 680, y: 420 },
        data: {
          label: 'Thumbnail',
          subtype: 'media-download',
          config: { subtype: 'media-download' },
        },
      },
    ],
    edges: [
      { id: 'e-src-transcription', source: 'vid-source',      target: 'vid-transcription' },
      { id: 'e-src-frame',         source: 'vid-source',      target: 'vid-frame' },
      { id: 'e-transcription-title', source: 'vid-transcription', target: 'vid-title-gen' },
      { id: 'e-transcription-desc',  source: 'vid-transcription', target: 'vid-desc-gen' },
      { id: 'e-title-out',         source: 'vid-title-gen',   target: 'vid-title-out' },
      { id: 'e-desc-out',          source: 'vid-desc-gen',    target: 'vid-desc-out' },
      { id: 'e-frame-thumb',       source: 'vid-frame',       target: 'vid-thumb-dl' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // DEMAND GENERATION TEMPLATES
  // These templates use the Client Brain source node to pull from the client's
  // GTM Framework, Demand Gen brain, and Brand Profile automatically.
  // ─────────────────────────────────────────────────────────────────────────────

  {
    id: 'dg-lead-magnet',
    name: 'Lead Magnet Builder',
    description: 'Pulls ICP, messaging, and offer data from the client brain to generate a complete downloadable lead magnet — guide, checklist, or template pack structured and ready for design.',
    category: 'demand_gen',
    icon: 'Gift',
    nodes: [
      {
        id: 'dg-lm-brain',
        type: 'client_brain',
        position: { x: 80, y: 80 },
        data: {
          label: 'Client Brain',
          subtype: 'client-brain',
          config: {
            subtype: 'client-brain',
            verticalId: '', verticalName: '', clientName: '',
            gtmSections: ['02', '08', '16'],
            dgBaseSections: ['B1'],
            dgVertSections: ['S2', 'S3'],
            includeBrand: true,
          },
        },
      },
      {
        id: 'dg-lm-outline',
        type: 'logic',
        position: { x: 380, y: 80 },
        data: {
          label: 'Generate Outline',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Using the client brain context provided, create a detailed outline for a lead magnet that will attract and convert ideal prospects.

The lead magnet should:
- Address the #1 pain point of the ICP
- Demonstrate clear, specific value (not generic tips)
- Be completable in under 20 minutes
- Lead naturally toward the core offer

Output the outline as:
1. Lead Magnet Title (clear, outcome-focused)
2. Subtitle (who it's for + what they'll get)
3. Format recommendation (guide / checklist / template / swipe file) with rationale
4. 5-8 section headings with 2-3 bullet points under each
5. CTA at the end (what they should do next)`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-lm-write',
        type: 'logic',
        position: { x: 680, y: 80 },
        data: {
          label: 'Write Full Content',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Using the outline above and the client brain context, write the complete lead magnet content.

Requirements:
- Write in the client's brand voice (use the Brand Profile if included)
- Every section should be immediately actionable — no fluff
- Include specific examples, stats, or frameworks where relevant
- Use headers, short paragraphs, and bullet points for readability
- End each section with a clear takeaway
- Final CTA should be specific and low-friction

Do not pad. If a section is complete in 3 paragraphs, stop at 3 paragraphs.`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-lm-out',
        type: 'output',
        position: { x: 980, y: 80 },
        data: {
          label: 'Lead Magnet',
          subtype: 'content-output',
          config: {
            subtype: 'content-output',
            outputType: 'Blog Post',
            targetWordCountMin: 1200,
            targetWordCountMax: 2500,
          },
        },
      },
    ],
    edges: [
      { id: 'e-lm-brain-outline', source: 'dg-lm-brain',   target: 'dg-lm-outline' },
      { id: 'e-lm-outline-write', source: 'dg-lm-outline', target: 'dg-lm-write' },
      { id: 'e-lm-write-out',     source: 'dg-lm-write',   target: 'dg-lm-out' },
    ],
  },

  {
    id: 'dg-email-nurture',
    name: 'Email Nurture Sequence',
    description: 'Generates a 5-email nurture sequence from the client brain — each email has a specific job: deliver, walkthrough, objection handling, proof, and trial CTA.',
    category: 'demand_gen',
    icon: 'Mail',
    nodes: [
      {
        id: 'dg-en-brain',
        type: 'client_brain',
        position: { x: 80, y: 300 },
        data: {
          label: 'Client Brain',
          subtype: 'client-brain',
          config: {
            subtype: 'client-brain',
            verticalId: '', verticalName: '', clientName: '',
            gtmSections: ['08', '10', '12'],
            dgBaseSections: ['B2'],
            dgVertSections: ['S2', 'S3'],
            includeBrand: true,
          },
        },
      },
      {
        id: 'dg-en-e1',
        type: 'logic',
        position: { x: 380, y: 0 },
        data: {
          label: 'Email 1 — Deliver',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Write Email 1 of a 5-email nurture sequence.

Job: Deliver the lead magnet and open a conversation.

Structure:
- Subject line (curiosity + specificity, under 50 chars)
- Preview text (completes the subject line thought)
- Body: Thank them for downloading, deliver the resource link, then ask ONE question: "What's the biggest bottleneck in your [relevant process] right now?" — keep the email under 150 words
- Signature

Tone: warm, direct, human. No corporate language.

Use the client brain context to make the subject line and question specific to the ICP.`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-en-e2',
        type: 'logic',
        position: { x: 380, y: 150 },
        data: {
          label: 'Email 2 — Walkthrough',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Write Email 2 of a 5-email nurture sequence. Send: Day 3.

Job: Show the product in action. Make it real and visual.

Structure:
- Subject line (show don't tell — reference the outcome, not the feature)
- Body: "Here's exactly how [client name] works for a [ICP role]..." — walk through one specific use case step by step. Reference a real workflow, real output, or real time-saving scenario based on the client brain context. Under 200 words.
- CTA: Soft — "Does this match how your team works?"

Keep it conversational. No bullet lists. Tell a mini-story.`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-en-e3',
        type: 'logic',
        position: { x: 380, y: 300 },
        data: {
          label: 'Email 3 — Objections',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Write Email 3 of a 5-email nurture sequence. Send: Day 5.

Job: Handle the most common objection head-on. Do not dance around it.

Using the objection handling and competitive differentiation sections from the client brain, pick the #1 objection a prospect would have at this stage (usually: "We already use X" or "We don't have time to implement something new").

Structure:
- Subject line: name the objection directly ("You probably already use [competitor/tool]")
- Body: Acknowledge the objection genuinely, then reframe — not with features, but with the outcome they're actually looking for. Under 180 words.
- CTA: "Worth a 10-minute look?"`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-en-e4',
        type: 'logic',
        position: { x: 380, y: 450 },
        data: {
          label: 'Email 4 — Proof',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Write Email 4 of a 5-email nurture sequence. Send: Day 8.

Job: Social proof. Make the result feel real and achievable.

Using proof points, case studies, and customer quotes from the client brain, write a brief case study or before/after story. If no specific case study exists, build a realistic scenario using the ICP profile and offer details.

Structure:
- Subject line: lead with the result ("[Type of client] went from X to Y")
- Body: Brief story — who they were, what they were dealing with, what changed, what it meant for them. 150-200 words.
- Specific numbers wherever possible (time saved, leads generated, revenue impact)
- CTA: "Want to see if this works for your situation?"`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-en-e5',
        type: 'logic',
        position: { x: 380, y: 600 },
        data: {
          label: 'Email 5 — CTA',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Write Email 5 of a 5-email nurture sequence. Send: Day 14.

Job: Direct trial or demo CTA. This is the ask. Be clear.

Structure:
- Subject line: direct and low-pressure ("Quick question before I go quiet")
- Body: Acknowledge they've been reading (briefly). Make the ask specific and easy — not "schedule a call" but a single low-friction action (start a trial, watch a 2-min Loom, answer one question). Under 120 words.
- One CTA, linked, prominent
- PS: Brief reason why now (limited spots, relevant timing, seasonal angle)

Do not apologize. Do not hedge. This email should feel like it comes from a peer, not a salesperson.`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-en-out',
        type: 'output',
        position: { x: 680, y: 300 },
        data: {
          label: 'Email Sequence',
          subtype: 'content-output',
          config: { subtype: 'content-output', outputType: 'Email' },
        },
      },
    ],
    edges: [
      { id: 'e-en-brain-e1', source: 'dg-en-brain', target: 'dg-en-e1' },
      { id: 'e-en-brain-e2', source: 'dg-en-brain', target: 'dg-en-e2' },
      { id: 'e-en-brain-e3', source: 'dg-en-brain', target: 'dg-en-e3' },
      { id: 'e-en-brain-e4', source: 'dg-en-brain', target: 'dg-en-e4' },
      { id: 'e-en-brain-e5', source: 'dg-en-brain', target: 'dg-en-e5' },
      { id: 'e-en-e1-out',   source: 'dg-en-e1',   target: 'dg-en-out' },
      { id: 'e-en-e2-out',   source: 'dg-en-e2',   target: 'dg-en-out' },
      { id: 'e-en-e3-out',   source: 'dg-en-e3',   target: 'dg-en-out' },
      { id: 'e-en-e4-out',   source: 'dg-en-e4',   target: 'dg-en-out' },
      { id: 'e-en-e5-out',   source: 'dg-en-e5',   target: 'dg-en-out' },
    ],
  },

  {
    id: 'dg-seo-landing',
    name: 'SEO Landing Page Copy',
    description: 'Combines a target keyword with the client brain to generate conversion-focused landing page copy — headline, subheads, body, and CTA for one intent-based search query.',
    category: 'demand_gen',
    icon: 'Search',
    nodes: [
      {
        id: 'dg-seo-keyword',
        type: 'source',
        position: { x: 80, y: 80 },
        data: {
          label: 'Target Keyword',
          subtype: 'text-input',
          config: {
            subtype: 'text-input',
            text: '',
            placeholder: 'Enter the target search query, e.g. "content workflow automation for agencies"',
          },
        },
      },
      {
        id: 'dg-seo-brain',
        type: 'client_brain',
        position: { x: 80, y: 230 },
        data: {
          label: 'Client Brain',
          subtype: 'client-brain',
          config: {
            subtype: 'client-brain',
            verticalId: '', verticalName: '', clientName: '',
            gtmSections: ['02', '08', '12'],
            dgBaseSections: [],
            dgVertSections: ['S2', 'S3', 'S7'],
            includeBrand: true,
          },
        },
      },
      {
        id: 'dg-seo-write',
        type: 'logic',
        position: { x: 400, y: 150 },
        data: {
          label: 'Write Landing Page Copy',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Write conversion-focused landing page copy for the target keyword provided, using the client brain context.

This is not a blog post. It is a page for people who are already frustrated and searching for a solution.

Output the following sections in order:

**H1 Headline:** Outcome-first. Under 10 words. Speaks to what they want, not what the product is.

**H2 Subheadline:** 1-2 sentences expanding the headline. Who it's for + what changes.

**Problem Statement (2-3 short paragraphs):** Name the specific pain clearly. Speak their internal monologue. Use language from the ICP and external intelligence sections.

**Solution Bridge (1 paragraph):** Transition from problem to solution without pitching yet.

**How It Works (3-5 bullet points):** Specific, outcome-oriented. Not features — results.

**Social Proof Block:** 1-2 quotes or a brief stat. Pull from proof points if available.

**CTA Section:** One clear action. Headline the CTA. Subtext handles objections.

Target 700-900 words total. Do not pad.`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-seo-out',
        type: 'output',
        position: { x: 720, y: 150 },
        data: {
          label: 'Landing Page Copy',
          subtype: 'content-output',
          config: {
            subtype: 'content-output',
            outputType: 'Landing Page',
            targetWordCountMin: 700,
            targetWordCountMax: 900,
          },
        },
      },
    ],
    edges: [
      { id: 'e-seo-kw-write',    source: 'dg-seo-keyword', target: 'dg-seo-write' },
      { id: 'e-seo-brain-write', source: 'dg-seo-brain',   target: 'dg-seo-write' },
      { id: 'e-seo-write-out',   source: 'dg-seo-write',   target: 'dg-seo-out' },
    ],
  },

  {
    id: 'dg-linkedin-outreach',
    name: 'LinkedIn Outreach Messages',
    description: 'Generates 10 LinkedIn outreach message variants from the client brain — personalized by ICP role and trigger event, short and conversion-focused.',
    category: 'demand_gen',
    icon: 'MessageSquare',
    nodes: [
      {
        id: 'dg-li-brain',
        type: 'client_brain',
        position: { x: 80, y: 120 },
        data: {
          label: 'Client Brain',
          subtype: 'client-brain',
          config: {
            subtype: 'client-brain',
            verticalId: '', verticalName: '', clientName: '',
            gtmSections: ['02', '07', '08'],
            dgBaseSections: ['B2'],
            dgVertSections: ['S3'],
            includeBrand: false,
          },
        },
      },
      {
        id: 'dg-li-write',
        type: 'logic',
        position: { x: 380, y: 120 },
        data: {
          label: 'Generate Outreach Messages',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            taskType: 'Generate',
            prompt: `Using the client brain context, generate 10 LinkedIn outreach message variants.

Rules:
- Every message must be under 75 words
- One ask per message — no pitch decks, no case studies
- Personalization hook in the first line (their role, their company size, a specific trigger)
- The ask should be frictionless: a yes/no question, a Loom link, or "worth 10 minutes?"
- Never say "I hope this finds you well" or any opener that sounds like a template
- No exclamation marks

Format each message as:
---
**Variant [N] — [Trigger/Context]**
[Message body]
---

Vary the following across the 10 variants:
- 3 different ICP roles (use segments from the brain)
- 3 trigger angles (hiring, funding, new role, recent content, pain signal)
- Mix of question-close and link-close
- Tone: direct professional / warm peer / brief and curious`,
            additionalInstructions: '',
          },
        },
      },
      {
        id: 'dg-li-out',
        type: 'output',
        position: { x: 680, y: 120 },
        data: {
          label: 'Outreach Messages',
          subtype: 'content-output',
          config: { subtype: 'content-output', outputType: 'Custom' },
        },
      },
    ],
    edges: [
      { id: 'e-li-brain-write', source: 'dg-li-brain', target: 'dg-li-write' },
      { id: 'e-li-write-out',   source: 'dg-li-write', target: 'dg-li-out' },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // INTELLIGENCE TOOL TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────

  {
    id: 'intel-competitive',
    name: 'Competitive Intelligence Pack',
    description:
      'Mine Trustpilot reviews for your client and their top competitors, deep-scrape competitor websites, then generate a battlecard and messaging opportunities.',
    category: 'demand_gen',
    icon: 'Swords',
    nodes: [
      {
        id: 'ci-reviews',
        type: 'review_miner',
        position: { x: 80, y: 120 },
        data: {
          label: 'Review Mining',
          subtype: 'review-miner',
          config: {
            subtype: 'review-miner',
            companyName: '',
            companySlug: '',
            platforms: ['trustpilot'],
            competitors: '',
            maxReviewsPerSource: 20,
            synthesisType: 'battlecard',
          },
        },
      },
      {
        id: 'ci-scrape',
        type: 'deep_web_scrape',
        position: { x: 80, y: 320 },
        data: {
          label: 'Competitor Website Crawl',
          subtype: 'deep-web-scrape',
          config: {
            subtype: 'deep-web-scrape',
            seedUrls: '',
            maxPages: 10,
            linkPattern: '/about|/pricing|/features|/why',
            stayOnDomain: true,
            synthesisTarget: 'gtm_12',
            synthesisInstructions: 'Focus on competitor positioning, messaging, value props, and pricing signals',
          },
        },
      },
      {
        id: 'ci-synthesize',
        type: 'logic',
        position: { x: 420, y: 220 },
        data: {
          label: 'Compile Intelligence Brief',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            prompt: `You are a competitive intelligence analyst. Using the review mining and website analysis provided, create a comprehensive Competitive Intelligence Brief:

## Executive Summary
One paragraph on the competitive landscape and our client's position.

## Battlecard
| Factor | Our Client | Competitor 1 | Competitor 2 |
|--------|-----------|--------------|--------------|
[Fill based on data]

## Messaging Opportunities
White space in the market — claims we can own based on competitor gaps.

## Proof Point Priorities
Which customer outcomes and metrics to lead with, based on what competitors aren't saying.

## Objection Playbook
Top 5 objections buyers raise (from reviews) with our recommended counters.

Format for use by sales and marketing teams.`,
          },
        },
      },
      {
        id: 'ci-out',
        type: 'output',
        position: { x: 740, y: 220 },
        data: {
          label: 'Competitive Brief',
          subtype: 'content-output',
          config: { subtype: 'content-output', outputType: 'Custom' },
        },
      },
    ],
    edges: [
      { id: 'e-ci-rev-synth',   source: 'ci-reviews',   target: 'ci-synthesize' },
      { id: 'e-ci-scrape-synth', source: 'ci-scrape',   target: 'ci-synthesize' },
      { id: 'e-ci-synth-out',   source: 'ci-synthesize', target: 'ci-out' },
    ],
  },

  {
    id: 'intel-seo-content-strategy',
    name: 'SEO Content Strategy',
    description:
      'Combine Reddit audience signals with keyword intent analysis to produce a prioritized content calendar with keyword clusters and topic angles.',
    category: 'demand_gen',
    icon: 'BarChart3',
    nodes: [
      {
        id: 'seo-keywords',
        type: 'seo_intent',
        position: { x: 80, y: 120 },
        data: {
          label: 'Keyword Intent Analysis',
          subtype: 'seo-intent',
          config: {
            subtype: 'seo-intent',
            topic: '',
            seedKeywords: '',
            expandCount: 40,
            dataSource: 'google_autocomplete',
            funnelMapping: true,
          },
        },
      },
      {
        id: 'seo-audience',
        type: 'audience_signal',
        position: { x: 80, y: 320 },
        data: {
          label: 'Audience Signal Research',
          subtype: 'audience-signal',
          config: {
            subtype: 'audience-signal',
            searchTerms: '',
            subreddits: '',
            maxPosts: 25,
            minUpvotes: 5,
            synthesisGoal: 'questions',
          },
        },
      },
      {
        id: 'seo-calendar',
        type: 'logic',
        position: { x: 420, y: 220 },
        data: {
          label: 'Build Content Calendar',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            prompt: `You are a content strategist. Using the keyword intent data and audience signal research provided, build a 12-piece content calendar:

## Content Strategy Brief

### Thesis
One sentence on what this content program is designed to do.

### Content Calendar (12 pieces)

For each piece:
**Title:** [SEO-optimized title]
**Format:** [Blog post / Video / Landing page / Email / LinkedIn]
**Target keyword:** [Primary keyword + volume tier]
**Funnel stage:** [Awareness / Consideration / Decision]
**Angle:** [What makes this worth reading — the hook]
**Audience need:** [The question or pain from Reddit this answers]
**CTA:** [What the reader should do next]
**Priority:** [High / Medium — based on volume + audience signal strength]

### Quick Win Picks
Top 3 pieces to publish first and why.

Format as a brief the content team can execute immediately.`,
          },
        },
      },
      {
        id: 'seo-out',
        type: 'output',
        position: { x: 740, y: 220 },
        data: {
          label: 'Content Strategy',
          subtype: 'content-output',
          config: { subtype: 'content-output', outputType: 'Custom' },
        },
      },
    ],
    edges: [
      { id: 'e-seo-kw-cal',  source: 'seo-keywords', target: 'seo-calendar' },
      { id: 'e-seo-aud-cal', source: 'seo-audience',  target: 'seo-calendar' },
      { id: 'e-seo-cal-out', source: 'seo-calendar',  target: 'seo-out' },
    ],
  },

  {
    id: 'intel-market-signal-brief',
    name: 'Market Signal Research Brief',
    description:
      'Crawl industry sites and mine Reddit to produce a demand gen intelligence brief covering audience pain points, external signals, and content opportunities.',
    category: 'demand_gen',
    icon: 'Radar',
    nodes: [
      {
        id: 'ms-reddit',
        type: 'audience_signal',
        position: { x: 80, y: 80 },
        data: {
          label: 'Reddit Signal Mining',
          subtype: 'audience-signal',
          config: {
            subtype: 'audience-signal',
            searchTerms: '',
            subreddits: '',
            maxPosts: 30,
            minUpvotes: 10,
            synthesisGoal: 'all',
          },
        },
      },
      {
        id: 'ms-web',
        type: 'deep_web_scrape',
        position: { x: 80, y: 280 },
        data: {
          label: 'Industry Site Crawl',
          subtype: 'deep-web-scrape',
          config: {
            subtype: 'deep-web-scrape',
            seedUrls: '',
            maxPages: 12,
            linkPattern: '',
            stayOnDomain: true,
            synthesisTarget: 'dg_s7',
            synthesisInstructions: 'Extract market trends, statistics, and buyer signals relevant to demand generation',
          },
        },
      },
      {
        id: 'ms-brain',
        type: 'client_brain',
        position: { x: 80, y: 480 },
        data: {
          label: 'Client Context',
          subtype: 'client-brain',
          config: {
            subtype: 'client-brain',
            verticalId: '',
            verticalName: '',
            gtmSections: ['02', '08', '12'],
            dgBaseSections: ['B1'],
            dgVertSections: ['S2', 'S3'],
            includeBrand: false,
          },
        },
      },
      {
        id: 'ms-brief',
        type: 'logic',
        position: { x: 440, y: 280 },
        data: {
          label: 'Compile Demand Gen Brief',
          subtype: 'ai-generate',
          config: {
            subtype: 'ai-generate',
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            prompt: `You are a demand generation strategist. Using the Reddit audience signals, industry research, and client context provided, produce a Market Signal Intelligence Brief:

## Executive Summary (3 sentences max)

## Audience Signals
What the target audience is actually saying, worrying about, and looking for — in their own words.

## External Market Intelligence
Trends, stats, and dynamics from the industry research.

## Demand Gen Opportunities
5 specific opportunities to capture demand based on the signals above. For each:
- The opportunity
- The signal that surfaced it
- The channel/format to capture it
- A content angle or hook to lead with

## Vocabulary for Messaging
10–15 phrases to use (and 5 to avoid) based on audience language.

## Recommended Next Actions
3 immediate actions for the demand gen program.

Write for a marketing director to review with their team.`,
          },
        },
      },
      {
        id: 'ms-out',
        type: 'output',
        position: { x: 760, y: 280 },
        data: {
          label: 'Market Signal Brief',
          subtype: 'content-output',
          config: { subtype: 'content-output', outputType: 'Custom' },
        },
      },
    ],
    edges: [
      { id: 'e-ms-reddit-brief', source: 'ms-reddit', target: 'ms-brief' },
      { id: 'e-ms-web-brief',   source: 'ms-web',    target: 'ms-brief' },
      { id: 'e-ms-brain-brief', source: 'ms-brain',  target: 'ms-brief' },
      { id: 'e-ms-brief-out',   source: 'ms-brief',  target: 'ms-out' },
    ],
  },
]
