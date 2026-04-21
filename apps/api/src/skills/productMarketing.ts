export interface Skill {
  key: string
  name: string
  description: string
  instructions: string
}

export interface SkillCategory {
  key: string
  label: string
  skills: Skill[]
}

export const PRODUCT_MARKETING_SKILLS: SkillCategory[] = [
  {
    key: 'pm-product-strategy',
    label: 'Product Strategy',
    skills: [
      {
        key: 'product-vision',
        name: 'Product Vision',
        description: 'Craft an inspiring, achievable vision statement that motivates teams and aligns stakeholders.',
        instructions: `## Product Vision

Help the user develop an inspiring, achievable, and emotionally resonant product vision statement.

**Vision vs Strategy:** Vision = where you're going (inspiring, long-term, emotional). Strategy = how you'll get there (specific, actionable, measurable). Never confuse the two.

**What makes a great product vision:**
- Inspirational: motivates the team even when things are hard
- Achievable: ambitious but not fantasy
- Customer-centric: describes the impact on people, not the technology
- Memorable: short enough to repeat from memory
- Directional: makes clear what you will and won't build

**Dimensions to explore:**
1. Who are the people whose lives will be fundamentally different?
2. What does their world look like after this product exists?
3. What is the core problem that no one has truly solved yet?
4. What would make this still relevant in 10 years?
5. What would you sacrifice to protect — and what would you cut?

**Synthesis format:**
- 1-sentence vision statement
- 3-5 principles that flow from it
- What this vision explicitly rules out`,
      },
      {
        key: 'product-strategy',
        name: 'Product Strategy',
        description: 'Build a Product Strategy Canvas covering vision, segments, value prop, trade-offs, and growth.',
        instructions: `## Product Strategy Canvas

9-section framework: Vision, Market Segments, Relative Costs, Value Proposition, Trade-offs, Key Metrics, Growth, Capabilities, Can't/Won't.

**Sections to explore:**
1. **Vision** — Where are you going? What world does this create?
2. **Market Segments** — Who specifically? Which segment gets value first?
3. **Relative Costs** — What's your cost structure vs. alternatives?
4. **Value Proposition** — What job does this do that nothing else does as well?
5. **Trade-offs** — What are you explicitly NOT doing to stay focused?
6. **Key Metrics** — How will you measure success at each stage?
7. **Growth** — How do you acquire, retain, and expand?
8. **Capabilities** — What must you build, buy, or partner for?
9. **Can't/Won't** — What defensibility do you have? What won't you compromise?

**Multi-directional probes:**
- The trade-offs section is where most strategies break down — push hard here
- "Can't/Won't" reveals the real strategy — what would you walk away from a deal over?
- Metrics should cascade from the vision, not be chosen in isolation`,
      },
      {
        key: 'value-proposition',
        name: 'Value Proposition',
        description: 'Define the core value prop using the 6-part JTBD template: Who, Why, What Before, How, What After, Alternatives.',
        instructions: `## Value Proposition (JTBD Framework)

6-part template:
1. **Who** — Specific customer persona (not a demographic, a person with a job to do)
2. **Why (Problem)** — The struggle, the friction, the job not getting done well
3. **What Before** — What they're doing today (the alternative we're replacing)
4. **How (Solution)** — The mechanism that makes the job easier/better/cheaper
5. **What After** — The outcome they experience; how their life changes
6. **Alternatives** — Why existing solutions fail at this job

**Key probes:**
- "What Before" is critical — the real competition is always the status quo
- "What After" should be concrete and measurable, not vague ("saves time" is weak; "closes deals 40% faster" is strong)
- Ask "why does the current solution fail?" 3 times — you'll find the real wedge on the 3rd answer
- The person in "Who" should be specific enough that you could call them by name

**Synthesis:** One clear value proposition statement + alternative framings for different audiences`,
      },
      {
        key: 'swot-analysis',
        name: 'SWOT Analysis',
        description: 'Map Strengths, Weaknesses, Opportunities, and Threats with cross-referenced strategic actions.',
        instructions: `## SWOT Analysis

Four quadrants + cross-reference for strategic insights.

**Standard quadrants:**
- **Strengths** — Internal advantages (assets, capabilities, brand, data, team)
- **Weaknesses** — Internal gaps (missing capabilities, cost structure, brand gaps)
- **Opportunities** — External shifts you can exploit (market changes, tech shifts, competitor weakness)
- **Threats** — External risks (new entrants, regulation, customer behavior shift)

**Cross-reference for strategy:**
- S+O = Build: Use strengths to capture opportunities
- S+T = Defend: Use strengths to neutralize threats
- W+O = Pivot: Fix weaknesses to capture opportunities
- W+T = Exit/Reduce: Minimize exposure where weak AND threatened

**Multi-directional probes:**
- Most SWOTs list generic strengths — push for evidence ("what data proves this is a strength?")
- Weaknesses are often rationalised away — ask "what do your worst critics say?"
- Threats should be on a timeline: which could materialize in 12 months vs. 3 years?`,
      },
      {
        key: 'business-model',
        name: 'Business Model Canvas',
        description: 'Map all 9 building blocks: partners, activities, resources, value props, relationships, channels, segments, costs, revenue.',
        instructions: `## Business Model Canvas (BMC)

9 building blocks:
**Left (efficiency):** Key Partners, Key Activities, Key Resources
**Center:** Value Propositions
**Right (effectiveness):** Customer Relationships, Channels, Customer Segments
**Bottom:** Cost Structure, Revenue Streams

**Key probes per block:**
- **Key Partners** — Which partnerships are truly load-bearing? Which are nice-to-have?
- **Key Activities** — What must you do exceptionally well to deliver the value prop?
- **Key Resources** — What's your most defensible asset? (Data? Brand? Network?)
- **Channels** — How do customers find you, buy from you, and get value after buying?
- **Customer Relationships** — Automated or personal? High-touch or self-serve?
- **Revenue Streams** — One stream or multiple? How does pricing signal value?

**Multi-directional probes:**
- Misaligned models: the Revenue Stream doesn't match the Value Prop (e.g. charging for what customers won't pay for)
- Key Activities should drive the Value Prop — if they don't, something is off
- Cost Structure should reflect Key Resources — if the biggest cost isn't your biggest asset, investigate`,
      },
      {
        key: 'lean-canvas',
        name: 'Lean Canvas',
        description: 'Startup hypothesis testing with Problem, Solution, UVP, Unfair Advantage, Segments, Channels, Revenue, Costs, Key Metrics.',
        instructions: `## Lean Canvas

9 sections optimised for startup hypothesis validation:
1. **Problem** — Top 3 problems. What's the #1 thing customers complain about?
2. **Customer Segments** — Who has this problem most acutely? Who are the early adopters?
3. **Unique Value Proposition** — Single, clear message why you're different and worth attention
4. **Solution** — Top 3 features that address the top 3 problems
5. **Channels** — Path to customers (free vs. paid; owned vs. rented)
6. **Revenue Streams** — How you make money. Pricing model.
7. **Cost Structure** — Fixed and variable costs. Customer acquisition cost.
8. **Key Metrics** — The one number that tells you if you're on track
9. **Unfair Advantage** — What can't be easily copied or bought?

**Multi-directional probes:**
- Most founders inflate Solution before validating Problem — probe Problem depth first
- "Unfair Advantage" is often left blank or generic — push: "If a well-funded competitor copied you tomorrow, what would still make you win?"
- Early Adopter ≠ target market. Who will tolerate a buggy v1 because the problem is so painful?`,
      },
      {
        key: 'pricing-strategy',
        name: 'Pricing Strategy',
        description: 'Design pricing covering value delivery, competitive positioning, willingness to pay, and model selection.',
        instructions: `## Pricing Strategy

7 pricing models to evaluate:
1. **Flat-rate** — One price, one product. Simple, predictable.
2. **Per-seat** — Price per user. Scales with team size.
3. **Usage-based** — Price per unit of value delivered. Aligns cost with value.
4. **Tiered** — Good/Better/Best. Anchors with high tier, captures with low.
5. **Freemium** — Free tier + paid upgrade. Reduces acquisition friction.
6. **Freemium+usage** — Free entry, usage unlocks paid. Best of both.
7. **Value-based** — Price reflects outcome achieved, not inputs.

**Key probes:**
- What is the customer's alternative cost? (Price to their DIY or incumbent)
- What outcome are you creating? Can you quantify it in dollars?
- Who controls the budget at the customer? Is pricing designed for that person?
- What behavior does your current pricing incentivize? Is that what you want?
- Where does your pricing create friction vs. where does it reduce it?

**Multi-directional probes:**
- Pricing is positioning — a $9/mo tool signals different things than a $900/mo tool even if they're identical
- Freemium burns cash if the free-to-paid conversion rate isn't modeled carefully
- Anchoring: what's the first price the customer sees? It frames everything else.`,
      },
      {
        key: 'monetization-strategy',
        name: 'Monetization Strategy',
        description: 'Brainstorm 3–5 monetization models with audience fit, unit economics, risks, and validation experiments.',
        instructions: `## Monetization Strategy

For each candidate model, evaluate:
- How it works mechanically
- Audience fit (who pays willingly?)
- Unit economics (revenue per customer, CAC payback)
- Risks and failure modes
- Competitive positioning (does this model create or erode moat?)
- How to validate demand before building

**Dimensions to explore:**
1. What is the primary value delivered — is it measurable in a unit? (If yes, usage-based is on the table)
2. Who are the economic buyers vs. end users? (They're often different)
3. What's the natural expansion path? (More seats? More usage? Upsell?)
4. What's the lock-in mechanism? (Switching cost, data gravity, network effects?)
5. What signals willingness to pay? (Time they spend today, money spent on workarounds)

**Multi-directional probes:**
- Most B2B products under-price — ask "what would enterprise customers pay if the ROI story was told correctly?"
- Freemium without a conversion funnel is charity — push on the conversion mechanism
- Monetize the right side of the table: the person who benefits most isn't always the one who pays`,
      },
      {
        key: 'ansoff-matrix',
        name: 'Ansoff Matrix',
        description: 'Map growth strategies across market penetration, market development, product development, and diversification.',
        instructions: `## Ansoff Matrix

Four growth quadrants:
1. **Market Penetration** (existing product + existing market) — Lowest risk. Grow share.
2. **Market Development** (existing product + new market) — Medium risk. Same product, different segment or geography.
3. **Product Development** (new product + existing market) — Medium risk. New offering to current customers.
4. **Diversification** (new product + new market) — Highest risk. Entering unknown territory.

**For each quadrant, evaluate:**
- Specific opportunity being pursued
- Strategic rationale
- Risk level and key assumptions
- Resource requirements
- Timeline to value
- Success metrics

**Multi-directional probes:**
- Most companies try to do all four simultaneously — push for a primary quadrant that gets 70% of focus
- Market Development is often underrated — same product in a new vertical can be massive
- Diversification should be resisted unless a competitive threat forces it
- Which quadrant is your competitor neglecting? That's often where the opportunity is.`,
      },
      {
        key: 'pestle-analysis',
        name: 'PESTLE Analysis',
        description: 'Assess macro-environment: Political, Economic, Social, Technological, Legal, Environmental factors.',
        instructions: `## PESTLE Analysis

Six external factors:
- **Political** — Government policy, political stability, trade restrictions, regulatory environment
- **Economic** — Growth rates, inflation, exchange rates, consumer confidence, industry health
- **Social** — Demographics, cultural shifts, lifestyle trends, education, consumer behavior
- **Technological** — R&D activity, automation, innovation rate, tech adoption, disruption risk
- **Legal** — Employment law, consumer protection, industry regulation, IP law, compliance requirements
- **Environmental** — Climate considerations, sustainability trends, ESG requirements, supply chain exposure

**For each factor:**
- What is the specific factor?
- How does it impact this product/market?
- Is the impact positive, negative, or mixed?
- What's the probability and timing?
- What strategic response does it require?

**Multi-directional probes:**
- Most analyses stay surface-level — push for specific named regulations, specific economic data
- Cross-factor interactions are often more powerful (e.g., Technology + Legal = AI regulation)
- Ask: "Which factor, if it shifted 20% against you, would be most damaging?"`,
      },
      {
        key: 'porters-five-forces',
        name: "Porter's Five Forces",
        description: 'Evaluate competitive dynamics: rivalry, supplier power, buyer power, substitutes, new entrants.',
        instructions: `## Porter's Five Forces

Five competitive forces:
1. **Competitive Rivalry** — Number of competitors, growth rate, switching costs, differentiation
2. **Supplier Power** — Concentration, switching costs, uniqueness of inputs, forward integration threat
3. **Buyer Power** — Concentration, price sensitivity, switching costs, backward integration threat
4. **Threat of Substitutes** — Alternative ways to solve the same problem, price-performance of alternatives
5. **Threat of New Entrants** — Barriers to entry (capital, IP, regulation, network effects, brand)

**For each force: High / Medium / Low + specific evidence**

**Strategic implications:**
- High rivalry + low differentiation = commoditization risk → must invest in moat
- High buyer power = pricing pressure → need switching costs or lock-in
- Low barriers to entry = race to scale before a well-funded entrant arrives

**Multi-directional probes:**
- "Substitutes" is often missed — what would customers use if this product didn't exist?
- Supplier power applies to talent as well as materials — ask about key dependency risks
- New entrant threat isn't just startups — ask about large platforms entering the space`,
      },
      {
        key: 'startup-canvas',
        name: 'Startup Canvas',
        description: 'Combine 9-section Product Strategy with Business Model for a new venture.',
        instructions: `## Startup Canvas

Combines Product Strategy Canvas + Business Model for a complete startup picture.

**9 Strategy sections + 2 Business Model sections:**
Product side: Vision, Market Segments, Relative Costs, Value Proposition, Trade-offs, Key Metrics, Growth, Capabilities, Can't/Won't
Business model: Cost Structure, Revenue Streams

**Key probes:**
- What is the founding insight? (The thing you believe that the market doesn't yet)
- What unfair advantage makes you the right team to build this?
- What does the unit economics look like at 100 customers? At 10,000?
- What's the hardest assumption to validate — and what's the cheapest way to test it?
- Where does the strategy break down first?`,
      },
    ],
  },
  {
    key: 'pm-product-discovery',
    label: 'Product Discovery',
    skills: [
      {
        key: 'opportunity-solution-tree',
        name: 'Opportunity Solution Tree',
        description: 'Map desired outcome → customer opportunities → solutions → experiments (Teresa Torres framework).',
        instructions: `## Opportunity Solution Tree (OST)

4-level structure:
1. **Desired Outcome** — Single measurable metric (e.g., "increase 7-day retention to 40%")
2. **Opportunities** — Customer needs/pain/desires discovered through research. "I struggle to..." framing. Prioritize: Importance × (1 − Satisfaction)
3. **Solutions** — Multiple ways to address each opportunity. Never commit to first idea.
4. **Experiments** — Fast, cheap tests. Prefer skin-in-the-game validation over opinions.

**Key principles:**
- One outcome at a time — don't try to solve everything
- Opportunities = problems, not features
- Always generate 3+ solutions per opportunity before choosing
- Discovery is not linear — loop back when experiments fail

**Multi-directional probes:**
- What outcome are you actually optimizing for? (Teams often say retention but measure activity)
- Which opportunity, if solved, would move the metric most — and why haven't you solved it yet?
- For each solution: what assumption has to be true for this to work?
- Where does the customer actually break down? (Show me the moment of failure, not the category of failure)`,
      },
      {
        key: 'interview-script',
        name: 'Customer Interview Script',
        description: 'Create structured interview scripts using The Mom Test principles — past behavior, no leading questions.',
        instructions: `## Customer Interview Script

Principles (The Mom Test):
- Ask about their life, not your idea
- Ask about the past, not the future
- Talk less, listen more (80/20)
- Never pitch during the interview
- Compliments are noise

**Script structure:**
1. Opening (2-3 min) — purpose, expectations, permission to record
2. Warm-up (5 min) — role, context, background
3. Core exploration — JTBD probing: specific past instances, pain, desired outcomes, willingness to pay
4. Probing techniques: "Tell me more", "Why?", "Specific example?", "What happened next?"
5. Wrap-up — what wasn't asked, who else to talk to

**Multi-directional probes:**
- Who else besides the direct user is affected by this problem? (Stakeholders, downstream)
- What does the workaround cost them — in time, money, reputation?
- What have they tried and abandoned? Why did they stop?
- Where does this problem rank against their other priorities? Would they pay to fix it?`,
      },
      {
        key: 'user-stories',
        name: 'User Stories',
        description: 'Write user stories with acceptance criteria, edge cases, and INVEST principles.',
        instructions: `## User Stories

Format: "As a [specific user], I want to [action], so that [outcome/value]."

INVEST criteria:
- **I**ndependent — can be built without dependencies
- **N**egotiable — not a contract, a conversation
- **V**aluable — delivers value to a user or customer
- **E**stimable — team can estimate effort
- **S**mall — fits in one sprint
- **T**estable — has clear acceptance criteria

**For each story, define:**
- Persona (specific, not generic)
- Action (what they do, not what the system does)
- Outcome (the benefit they receive)
- Acceptance criteria (given/when/then format)
- Edge cases
- What's out of scope

**Multi-directional probes:**
- Who is the user really? (The person who clicks vs. the person who benefits may differ)
- What happens when it fails? Is the error state as important as the happy path?
- Are there implicit assumptions in this story that need to be surfaced?`,
      },
      {
        key: 'brainstorm-ideas-existing',
        name: 'Brainstorm Ideas (Existing Product)',
        description: 'Multi-perspective ideation from PM, Designer, and Engineer viewpoints for an existing product.',
        instructions: `## Brainstorm Product Ideas (Existing Product)

Product Trio approach (Teresa Torres): PM + Designer + Engineer ideate together. "Best ideas often come from engineers."

**Three perspectives — 5 ideas each:**
- **PM lens:** Business value, strategic alignment, customer impact
- **Designer lens:** UX, usability, delight, onboarding reduction
- **Engineer lens:** Technical possibilities, data leverage, scalable solutions

**Prioritize top 5 across perspectives based on:**
- Strategic alignment
- Potential impact on outcomes
- Feasibility and effort
- Differentiation from existing solutions

**Multi-directional probes:**
- What does your data say users do just before they churn? (That's where to focus)
- What features do power users use that casual users never discover? (Activation gap)
- What would you build if engineering effort was unlimited? Now what if it was 2 weeks?
- Which competitor feature do customers specifically mention when evaluating you?`,
      },
      {
        key: 'identify-assumptions-existing',
        name: 'Identify Assumptions (Existing)',
        description: 'Devil\'s advocate risk analysis across Value, Usability, Viability, and Feasibility.',
        instructions: `## Identify Assumptions (Existing Product)

Four risk areas:
- **Value** — Will it create value? Does it solve a real problem?
- **Usability** — Will users figure it out? Acceptable learning curve?
- **Viability** — Can marketing, sales, finance, legal support it?
- **Feasibility** — Can it be built with current tech? Integration risks?

**Three devil's advocate perspectives:**
- PM: Business viability, market fit, strategic alignment
- Designer: Usability, adoption barriers, user experience
- Engineer: Technical feasibility, performance, integration challenges

**For each assumption:**
- What specifically could go wrong
- Confidence level (High/Medium/Low)
- Cheapest way to test it

**Multi-directional probes:**
- What's the assumption you're most reluctant to test? That's the one to test first.
- Which stakeholder is most likely to block this? What's their objection?
- If this assumption is wrong, what's the cost to reverse course?`,
      },
      {
        key: 'prioritize-features',
        name: 'Prioritize Features',
        description: 'Rank feature backlog by impact, effort, risk, and strategic alignment.',
        instructions: `## Prioritize Feature Backlog

Evaluation criteria:
- **Impact** — Opportunity Score (Importance × [1 − Satisfaction]) × number of customers affected
- **Effort** — Development, design, coordination required
- **Risk** — Uncertainty level; assumptions that need testing
- **Strategic alignment** — Fit with product vision and current goals

**ICE scoring:** Impact × Confidence × Ease
**RICE scoring:** (Reach × Impact × Confidence) / Effort

**Output:** Top 5 features with ranking, rationale, trade-offs, and what was explicitly deprioritized.

**Multi-directional probes:**
- What are you saying NO to by choosing this? (Every yes has a hidden cost)
- Which feature has the highest impact but the team avoids because it's hard? Why?
- What would your best customer say is missing? What would your worst customer say?
- If you shipped nothing but the top 1 feature this quarter, would that be enough?`,
      },
      {
        key: 'metrics-dashboard',
        name: 'Metrics Dashboard',
        description: 'Design a product metrics dashboard with North Star, input metrics, health metrics, alerts, and review cadence.',
        instructions: `## Product Metrics Dashboard

Framework:
- **North Star Metric** — Single metric capturing core value delivery
- **Input Metrics** (3-5) — Levers that drive the North Star
- **Health Metrics** — Guardrails ensuring overall product health
- **Business Metrics** — Revenue, cost, unit economics

**4 criteria for a good metric (Ben Yoskovitz):**
1. Understandable — creates common language
2. Comparative — tracks over time, not just a snapshot
3. Ratio or Rate — more revealing than absolutes
4. Behavior-changing — if it won't change behavior, it's a bad metric

**Multi-directional probes:**
- What decision would you make differently if this metric was 2x higher? If it was 0? (If nothing, it's vanity)
- What's the leading indicator of your most important lagging metric?
- Who is responsible when a metric drops? (If no one owns it, it won't improve)
- Are you measuring what you can, or what you should?`,
      },
      {
        key: 'summarize-interview',
        name: 'Summarize Customer Interview',
        description: 'Transform interview transcripts into structured summaries with JTBD, satisfaction signals, and action items.',
        instructions: `## Summarize Customer Interview

Output template:
- Date + Participants
- Background (customer context)
- Current Solution
- What they like about current solution (JTBD + satisfaction level)
- Problems with current solution (JTBD + importance + dissatisfaction)
- Key Insights (unexpected findings, notable quotes)
- Action Items (date, owner, action)

**Key focus areas:**
- Jobs to Be Done: what is the customer actually trying to accomplish?
- Satisfaction signals: where are they genuinely happy? (Don't ignore these — they're also insights)
- Language: capture exact words used — this feeds messaging directly
- Pain intensity: mild inconvenience vs. deal-breaker?

**Multi-directional probes:**
- What surprised you most in this interview?
- What did the customer say vs. what do you think they meant?
- What would you have asked if you had 30 more minutes?`,
      },
      {
        key: 'analyze-feature-requests',
        name: 'Analyze Feature Requests',
        description: 'Synthesize and prioritize feature requests by frequency, impact, and strategic fit.',
        instructions: `## Analyze Feature Requests

Synthesis framework:
1. Cluster requests by underlying job-to-be-done (not surface feature)
2. Score each cluster: Frequency × Importance × Strategic Fit
3. Identify patterns: What does the concentration of requests reveal about gaps?
4. Separate "nice to have" from "deal-breaker" signals
5. Cross-reference: which requests come from high-value customers vs. churned customers?

**Multi-directional probes:**
- What request do you keep getting but keep deprioritizing? What's the real reason?
- Which requests are actually the same underlying need in different words?
- What does the absence of a certain type of request tell you?
- Are these requests solving a current problem or anticipating a future state?`,
      },
      {
        key: 'prioritize-assumptions',
        name: 'Prioritize Assumptions',
        description: 'Triage assumptions using an Impact × Risk matrix and suggest experiments for each.',
        instructions: `## Prioritize Assumptions

Impact × Risk matrix:
- **Low Impact + Low Risk** → Defer
- **High Impact + Low Risk** → Proceed to implementation
- **Low Impact + High Risk** → Reject
- **High Impact + High Risk** → Design experiment immediately

**For assumptions requiring testing:**
- Maximize learning with minimum effort
- Measure actual behavior, not opinions
- Clear success metric and threshold

**Multi-directional probes:**
- Which assumption, if wrong, kills the entire strategy — not just this feature?
- What's the cheapest possible test? (Often a conversation or a fake landing page)
- What assumptions are you treating as facts without evidence?`,
      },
    ],
  },
  {
    key: 'pm-market-research',
    label: 'Market Research',
    skills: [
      {
        key: 'user-personas',
        name: 'User Personas',
        description: 'Build research-backed personas covering demographics, behaviors, JTBD, pain points, and motivations.',
        instructions: `## User Personas

Evidence-based, not made-up. Each persona must be grounded in real research.

**Persona structure:**
- Name + demographic snapshot (role, seniority, company type)
- A day in their life (workflow, tools, pain points)
- Jobs to Be Done (functional + emotional + social)
- Goals and motivations
- Fears and frustrations
- How they discover and evaluate solutions
- Decision criteria and deal-breakers

**Multi-directional probes:**
- What does this person fear most about their job — not just their workflow pain?
- Who influences their decisions even if they're the buyer? (The hidden stakeholder)
- What does success look like for them personally — not just for the product?
- What's the conversation they dread having with their boss that your product should make easier?`,
      },
      {
        key: 'competitor-analysis',
        name: 'Competitor Analysis',
        description: 'Map the competitive landscape: positioning, strengths, weaknesses, pricing, and strategic movements.',
        instructions: `## Competitor Analysis

For each competitor:
- Positioning statement (how they describe themselves)
- Target customer (who they're actually winning with)
- Core strengths (what they're genuinely good at)
- Core weaknesses (where they consistently lose)
- Pricing model and price points
- Recent strategic moves (new features, acquisitions, pivots)
- Customer sentiment (what do switchers say?)

**Competitive landscape dimensions:**
- Direct competitors (same job, same approach)
- Indirect competitors (same job, different approach)
- Status quo (doing nothing or spreadsheet)

**Multi-directional probes:**
- Which competitor do you most often get compared to — and why do you win? Why do you lose?
- What is your biggest competitor doing that you wish you'd thought of first?
- Where is the market heading that no current competitor is well-positioned for?
- What would it take for a well-funded entrant to take your best customer?`,
      },
      {
        key: 'market-sizing',
        name: 'Market Sizing',
        description: 'Calculate TAM, SAM, and SOM with top-down and bottom-up approaches.',
        instructions: `## Market Sizing

Three levels:
- **TAM** (Total Addressable Market) — If you had 100% share of the entire market
- **SAM** (Serviceable Addressable Market) — The segment you can realistically reach with your model
- **SOM** (Serviceable Obtainable Market) — What you can win in the next 3-5 years

**Two approaches:**
- **Top-down:** Start with industry reports, apply segment percentages down to your niche
- **Bottom-up:** Count potential customers × average contract value × purchase frequency

**Multi-directional probes:**
- Which assumption in your TAM, if wrong by 50%, most changes the strategy?
- Is your SAM constraint a go-to-market limitation or a product limitation?
- What has to be true about your SOM estimate for the business to be worth building?
- Who is currently underserved in this market that no one is counting?`,
      },
      {
        key: 'market-segments',
        name: 'Market Segments',
        description: 'Identify and prioritize market segments by size, fit, accessibility, and strategic value.',
        instructions: `## Market Segments

Segmentation criteria:
- **Firmographic** — Industry, company size, geography, revenue
- **Behavioral** — Usage patterns, purchase behavior, switching triggers
- **Needs-based** — The job they need done, the pain they're solving
- **Technographic** — Tech stack, digital maturity, tool adoption

**For each segment:**
- Size (estimated # of potential customers)
- Fit with value proposition (how well do you solve their specific version of the problem?)
- Accessibility (can you reach them? What does acquisition look like?)
- Willingness to pay (budget availability, urgency, alternatives)
- Strategic value (long-term growth, reference value, expansion potential)

**Multi-directional probes:**
- Which segment would miss you most if you disappeared?
- Where is there a segment that your competitors ignore but could love you?
- What's the segment you keep saying you don't serve but keeps buying anyway?`,
      },
      {
        key: 'customer-journey-map',
        name: 'Customer Journey Map',
        description: 'Map the full customer experience from awareness through advocacy, capturing touchpoints, emotions, and gaps.',
        instructions: `## Customer Journey Map

Stages: Awareness → Consideration → Decision → Onboarding → Adoption → Retention → Advocacy

**For each stage:**
- What is the customer trying to do?
- What touchpoints do they have with your product/brand?
- What does success feel like? What does failure feel like?
- What questions/objections do they have?
- What emotion are they experiencing? (frustrated, curious, excited, anxious)
- What gaps or friction exist?

**Multi-directional probes:**
- Where does the journey most often break down? What does that cost you?
- What moment, if improved, would have the highest leverage on retention?
- Where does the customer feel most uncertain — and are you addressing that uncertainty?
- What journey are your best customers on that your average customers aren't?`,
      },
      {
        key: 'user-segmentation',
        name: 'User Segmentation',
        description: 'Segment your user base by behavior, needs, and value to prioritize product and marketing investment.',
        instructions: `## User Segmentation

Behavioral segmentation dimensions:
- Activation status (activated vs. never-activated)
- Usage frequency (daily/weekly/monthly/dormant)
- Feature adoption (power users vs. casual users)
- Revenue potential (high-LTV vs. low-LTV segments)
- Growth trajectory (expanding vs. contracting usage)

**For each segment:**
- Size and % of total user base
- Revenue contribution
- Key behaviors that define this segment
- What they need most from the product
- What would move them to the next segment

**Multi-directional probes:**
- What does the top 10% of your users do that the bottom 50% doesn't?
- What would it take to graduate users from low-usage to high-usage?
- Which segment is growing fastest? Is that a signal or noise?`,
      },
      {
        key: 'sentiment-analysis',
        name: 'Sentiment Analysis',
        description: 'Synthesize customer sentiment from reviews, interviews, and feedback into actionable themes.',
        instructions: `## Sentiment Analysis

Sources to analyze:
- Customer reviews (G2, Capterra, Trustpilot, App Store)
- Support tickets and NPS comments
- Sales call transcripts (especially lost deals)
- Interview transcripts
- Social mentions

**Analysis framework:**
1. Theme clustering — group feedback by topic
2. Sentiment scoring — positive/negative/neutral per theme
3. Frequency weighting — how often does each theme appear?
4. Segment filtering — which user segments feel this most strongly?
5. Trend analysis — is sentiment improving or deteriorating over time?

**Multi-directional probes:**
- What do you hear in sales calls that never makes it into product feedback?
- What are customers defending when they push back on pricing? (That's your real value)
- What does support silence mean? (Some pain is so normalized users don't report it)`,
      },
    ],
  },
  {
    key: 'pm-go-to-market',
    label: 'Go-to-Market',
    skills: [
      {
        key: 'ideal-customer-profile',
        name: 'Ideal Customer Profile (ICP)',
        description: 'Define the ICP with firmographic, behavioral, JTBD, and disqualification criteria.',
        instructions: `## Ideal Customer Profile (ICP)

ICP components:
- **Firmographic profile** — Industry, company size, geography, revenue, tech stack
- **Behavioral profile** — How they buy, who's involved, decision timeline, trigger events
- **JTBD mapping** — What job are they hiring your product to do? What outcome do they measure?
- **Pain intensity** — How bad is the problem? What's the cost of inaction?
- **Disqualification criteria** — Who looks like a fit but isn't? (Saves sales time)
- **High-value segment** — Within the ICP, who drives the most revenue and referrals?

**Multi-directional probes:**
- Which of your current customers do you wish you had 100 more of — and why?
- Which customers did you win that you later regretted? What pattern do they share?
- What trigger event makes a company suddenly ready to buy? (Before = won't buy. After = will buy)
- What does your ICP do in the 90 days before they become a customer?`,
      },
      {
        key: 'beachhead-segment',
        name: 'Beachhead Segment',
        description: 'Identify the first market segment to dominate before expanding — the beachhead for growth.',
        instructions: `## Beachhead Segment

4 key criteria for a strong beachhead:
1. **Burning Pain Point** — The problem is urgent, not just nice-to-have
2. **Willingness to Pay** — They have budget and urgency to spend it now
3. **Winnable Market Share** — You can realistically beat incumbents here
4. **Referral Potential** — Winning here opens doors to adjacent segments

**Evaluation process:**
1. List 3-5 candidate segments
2. Score each on the 4 criteria (1-10)
3. Rank and recommend primary beachhead
4. 90-day acquisition plan for the winning segment

**Multi-directional probes:**
- Why can you win this segment when a larger, better-funded competitor cannot?
- What's the sequence from this beachhead to the next segment — is it obvious?
- What do you have to be uniquely true about you to win here?
- If you owned 30% of this segment, what becomes possible that isn't possible today?`,
      },
      {
        key: 'gtm-strategy',
        name: 'GTM Strategy',
        description: 'Build a launch GTM strategy: channels, messaging, metrics, timeline, and 90-day execution plan.',
        instructions: `## Go-to-Market Strategy

Components:
- **Target audience** — Specific ICP for this launch (not everyone)
- **Positioning** — How you want to be perceived vs. alternatives
- **Channel strategy** — Where to reach the ICP; why these channels specifically
- **Messaging** — Core message + proof points + CTA per channel
- **Launch timeline** — Phases with milestones and owners
- **KPI targets** — What does success look like in 30/60/90 days?
- **Risk mitigation** — What could go wrong and what's the plan B?

**Multi-directional probes:**
- What's the one channel where if it worked, this would be a success? Why aren't you betting everything on it?
- What message has worked in sales calls that marketing hasn't used yet?
- Who would be a credible third party to amplify your launch? (Analysts, press, influencers, partners)
- What does your competitor's launch playbook look like — and how are you different?`,
      },
      {
        key: 'gtm-motions',
        name: 'GTM Motions',
        description: 'Evaluate and select GTM motions: inbound, outbound, PLG, ABM, partner, community, paid.',
        instructions: `## GTM Motions

7 motion types:
1. **Inbound Marketing** — Content, SEO, thought leadership attracts customers
2. **Outbound Sales** — Direct outreach to ICP accounts
3. **Paid Digital** — Paid ads to target audience
4. **Community Marketing** — Build community that becomes a distribution channel
5. **Partner Marketing** — Co-market or co-sell with complementary products
6. **Account-Based Marketing (ABM)** — Targeted campaigns to specific named accounts
7. **Product-Led Growth (PLG)** — Product itself drives acquisition, conversion, and expansion

**For each motion:**
- Tools and tactics
- Best use case (when does this motion shine?)
- Strengths and challenges
- Resource requirements
- Leading indicators of success

**Multi-directional probes:**
- Which motion aligns with how your best customers actually found you?
- Where are you wasting the most money on a motion that doesn't fit your product?
- What would PLG require you to change about the product — and is that worth it?`,
      },
      {
        key: 'competitive-battlecard',
        name: 'Competitive Battlecard',
        description: 'Build sales-ready battlecards: where you win, where you lose, objections, and landmines.',
        instructions: `## Competitive Battlecard

For each named competitor:
- **Company overview** — What they do, who they serve, their positioning
- **Quick comparison** — Feature-by-feature or capability-by-capability
- **Where you win** — Specific scenarios where you consistently beat them
- **Where you lose** — Honest assessment of where they're stronger
- **Common objections** — What prospects say when they prefer the competitor
- **Objection responses** — Specific, evidence-backed responses (not spin)
- **Landmines to plant** — Questions to ask that expose competitor weaknesses
- **Win/loss patterns** — What do your wins have in common? Your losses?

**Multi-directional probes:**
- What does a prospect who chose the competitor over you have in common?
- What's the competitor's story about why they beat you? Is any of it true?
- What would make a current competitor customer switch to you today?
- What are you afraid to put on this battlecard because it's too honest?`,
      },
      {
        key: 'growth-loops',
        name: 'Growth Loops',
        description: 'Identify and design growth flywheels: viral, usage, collaboration, UGC, and referral loops.',
        instructions: `## Growth Loops (Flywheels)

5 loop types:
1. **Viral loop** — Users invite users; growth compounds
2. **Usage loop** — More usage → more value → more usage
3. **Collaboration loop** — Product is better with more collaborators in same organization
4. **User-Generated Content loop** — Users create content that attracts more users
5. **Referral loop** — Incentivized sharing that drives acquisition

**For each loop:**
- Mechanism: how does it work, step by step
- Trigger: what causes a user to pull others in?
- Friction: what slows the loop?
- Metrics: what measures loop efficiency?

**Evaluation criteria:**
- Scalability (does it improve with scale?)
- Defensibility (is it hard to replicate?)
- Time to value (how fast does the loop turn?)

**Multi-directional probes:**
- Where does your product naturally create "invites" or "shares" — and are you capitalizing on those moments?
- What is the moment in your product where the user is most likely to tell someone else about it?
- Which loop, if it worked, would change the economics of your CAC permanently?`,
      },
    ],
  },
  {
    key: 'pm-marketing-growth',
    label: 'Marketing & Growth',
    skills: [
      {
        key: 'north-star-metric',
        name: 'North Star Metric',
        description: 'Define the single metric that best captures core value delivery and leads to business success.',
        instructions: `## North Star Metric

A great North Star Metric:
- Measures value delivered to customers (not just business health)
- Is a leading indicator of revenue (not revenue itself)
- Can be influenced by the team's decisions
- Creates alignment across product, engineering, and growth

**Framework:**
1. What is the core action that delivers value to the user?
2. How do you measure that action is successful?
3. Does this metric, when improved, predictably improve revenue?
4. Can you break it down into leading inputs the team can drive?

**Common mistakes:**
- Using revenue or DAU (lagging, not behavioral)
- Choosing a metric the team can't influence
- Choosing a metric that doesn't map to customer value

**Multi-directional probes:**
- If this metric doubled, would customers be twice as successful? Would your business grow?
- What's the gap between users who hit this metric and those who don't — what creates it?
- How would a short-term-thinking PM game this metric? How do you prevent that?`,
      },
      {
        key: 'positioning-ideas',
        name: 'Positioning Ideas',
        description: 'Generate and evaluate positioning territories for a product or feature.',
        instructions: `## Positioning Ideas

Positioning formula: "For [ICP], [product] is the [category] that [differentiated value] because [proof]."

**Positioning dimensions:**
- Category framing: Are you redefining a category or competing in one?
- Differentiation: What makes you different in a way that matters?
- Target specificity: Broad appeal vs. narrow and deep
- Competitive context: Positioned vs. whom?
- Emotional register: Rational (features/ROI) vs. emotional (identity, aspiration)

**Positioning territories to explore:**
- Feature-based: Best at one specific capability
- Audience-based: Built for this specific persona
- Outcome-based: Defined by the result you create
- Category creation: Defining a new way of thinking
- Against: Defined by who/what you're not

**Multi-directional probes:**
- What's the one thing you want to own in the customer's mind?
- What would you have to stop saying to make your positioning razor-sharp?
- Where does your positioning break down in a sales call?`,
      },
      {
        key: 'value-prop-statements',
        name: 'Value Prop Statements',
        description: 'Write compelling value proposition statements for different audiences and contexts.',
        instructions: `## Value Proposition Statements

Statement types:
- **Headline** (10 words max) — Homepage or pitch opener
- **Elevator pitch** (2-3 sentences) — What you do and who for
- **Full value prop** (paragraph) — For landing pages and proposals
- **Audience-specific variants** — Different framing for different personas

**What makes a strong value prop:**
- Specific, not generic
- Outcome-focused, not feature-focused
- Uses customer language, not internal jargon
- Makes a claim you can substantiate

**Multi-directional probes:**
- What do your best customers say when they recommend you? (That's often your best value prop)
- What's the outcome your customer will put in their performance review after using you?
- Where does your current value prop attract the wrong customers?
- What claim would make a competitor nervous? Are you making it?`,
      },
      {
        key: 'marketing-ideas',
        name: 'Marketing Ideas',
        description: 'Generate creative marketing ideas by channel, budget, and growth stage.',
        instructions: `## Marketing Ideas

Channels to ideate across:
- Content marketing (SEO, thought leadership, case studies)
- Paid acquisition (search, social, display)
- Community building (Slack groups, forums, events)
- Partnership marketing (co-marketing, integrations, co-sell)
- Product marketing (in-product prompts, viral loops, referral programs)
- PR and earned media (press, analyst relations, awards)
- Events (webinars, conferences, roundtables)

**Evaluation criteria per idea:**
- Estimated reach
- Cost (time + money)
- Time to see results
- Repeatability
- Brand fit

**Multi-directional probes:**
- What's the highest-leverage marketing you've done that you've never doubled down on?
- Where are your customers talking to each other right now — and are you present?
- What's one contrarian marketing bet your competitors would never take?`,
      },
      {
        key: 'product-name',
        name: 'Product Name',
        description: 'Generate and evaluate product or feature names for memorability, positioning fit, and availability.',
        instructions: `## Product Name

Criteria for a great product name:
- Memorable and distinctive
- Easy to spell and pronounce
- Reinforces positioning (even subtly)
- Not already taken (trademark, domain, App Store)
- Works across markets if international

**Name types to explore:**
- **Descriptive** — Directly says what it does (e.g., Dropbox)
- **Evocative** — Suggests a feeling or outcome (e.g., Slack)
- **Abstract** — Invented word with no prior meaning (e.g., Kodak)
- **Founder/Place name** — Credibility through origin
- **Metaphor** — Borrows meaning from another domain

**Multi-directional probes:**
- What does this name suggest about who the product is for?
- What does this name NOT suggest that it should?
- What will customers call it casually — and is that the name you want?
- What negative associations could this name accidentally carry?`,
      },
    ],
  },
  {
    key: 'pm-execution',
    label: 'Execution',
    skills: [
      {
        key: 'create-prd',
        name: 'Product Requirements Doc (PRD)',
        description: 'Write a complete PRD covering problem, solution, requirements, success metrics, and out-of-scope.',
        instructions: `## Product Requirements Document (PRD)

Standard sections:
- **Overview** — What are we building and why, in one paragraph
- **Problem Statement** — The user problem, business opportunity, and evidence
- **Goals and Success Metrics** — What success looks like; how you'll measure it
- **Non-goals** — What this does NOT include (critical for scope control)
- **User Stories / Requirements** — What users can do; functional requirements
- **Design and UX** — Key flows, wireframes, edge cases
- **Technical Considerations** — Key constraints, dependencies, risks
- **Timeline** — Phases and milestones
- **Open Questions** — Unresolved decisions that need input

**Multi-directional probes:**
- What's the one thing in the requirements that will cause the most debate in planning?
- What are you leaving out of scope now that will hurt you if you don't address it in v2?
- What's the success metric that the team will actually check in 3 months?`,
      },
      {
        key: 'brainstorm-okrs',
        name: 'Brainstorm OKRs',
        description: 'Develop Objectives and Key Results aligned to company strategy with strong outcome orientation.',
        instructions: `## Brainstorm OKRs

OKR formula:
- **Objective** — Qualitative, inspiring, directional. Answers "what are we trying to achieve?"
- **Key Results** — Quantitative, time-bound, measurable. Answers "how will we know we got there?"

**Strong OKR characteristics:**
- Objective is aspirational but achievable
- Key Results measure outcomes, not outputs (not "launch feature X" — that's a task)
- 2-5 KRs per Objective
- KRs should be stretchy (70% achievement = success)
- KRs should be independent enough that if you hit them all, you definitely hit the objective

**Multi-directional probes:**
- Is this an output (we shipped something) or an outcome (something changed for customers)?
- If you hit all three KRs but the objective wasn't achieved, what went wrong?
- What's a KR that would be easy to game — and how do you design around it?`,
      },
      {
        key: 'outcome-roadmap',
        name: 'Outcome Roadmap',
        description: 'Build a roadmap organized around customer outcomes and business objectives, not features.',
        instructions: `## Outcome-Based Roadmap

Structure: Outcomes → Opportunities → Solutions (not features → features → features)

**Roadmap levels:**
- **Now** (current quarter): What we're actively working on
- **Next** (next 1-2 quarters): What's up next if priorities hold
- **Later** (6+ months): Direction, not commitment

**For each roadmap item:**
- Desired outcome (the metric it moves)
- Customer opportunity (the problem being solved)
- Proposed solution (the approach, not the spec)
- Success criteria (how you'll know it worked)
- Dependencies and risks

**Multi-directional probes:**
- What's the outcome you're most confident will move — and what makes you confident?
- What's on the roadmap because it's strategically right vs. because someone important asked for it?
- What would fall off the roadmap if a key stakeholder was removed from the room?`,
      },
      {
        key: 'sprint-plan',
        name: 'Sprint Plan',
        description: 'Structure a sprint with goals, stories, capacity, and dependencies.',
        instructions: `## Sprint Plan

Components:
- **Sprint Goal** — One sentence: what will be true at the end of this sprint?
- **Stories / Tasks** — What's included, in priority order
- **Capacity** — Available engineering days; story points assigned
- **Dependencies** — What must be unblocked for this sprint to succeed?
- **Risks** — What could derail this sprint?
- **Definition of Done** — What does "complete" mean for each story?

**Multi-directional probes:**
- Is the sprint goal an output or an outcome? Can you make it an outcome?
- What's the riskiest story in this sprint — and should it go first or last?
- What did last sprint's retrospective say that changes how you're planning this one?`,
      },
      {
        key: 'pre-mortem',
        name: 'Pre-Mortem',
        description: 'Imagine the project failed — work backwards to identify risks and prevention strategies.',
        instructions: `## Pre-Mortem Analysis

Process: "It is 6 months from now and this project has failed completely. What happened?"

**Five failure categories to explore:**
1. **Execution failures** — Missed deadlines, quality issues, technical debt
2. **Assumption failures** — Key assumptions that proved wrong
3. **Alignment failures** — Stakeholder conflicts, unclear ownership, changing priorities
4. **Market failures** — Customer didn't want it, competition responded, timing was wrong
5. **Resource failures** — Not enough time, budget, or the right skills

**For each identified failure:**
- How likely is this? (High/Medium/Low)
- What early warning signs would signal this is happening?
- What can be done now to prevent it?
- Who owns preventing it?

**Multi-directional probes:**
- What failure would you be most embarrassed to explain to leadership?
- What's the failure you're subconsciously avoiding thinking about?
- What assumptions is the team making in unison that no one has challenged?`,
      },
      {
        key: 'retro',
        name: 'Sprint Retrospective',
        description: 'Structure a retrospective covering what went well, what to improve, and concrete next actions.',
        instructions: `## Sprint Retrospective

Classic format: What went well? What could be improved? What will we do differently?

**Deeper facilitation questions:**
- **Went well:** What should we protect and repeat? Why did it work?
- **Improved:** What caused friction? What's the root cause (not just the symptom)?
- **Try next:** Concrete, owned, time-bound actions — not vague intentions

**Retrospective anti-patterns to avoid:**
- Blaming individuals instead of processes
- Identifying problems without owners
- Surface-level observations ("we communicated better" — what does that mean specifically?)
- Never following up on retro action items

**Multi-directional probes:**
- What's the elephant in the room that nobody brought up?
- What systemic issue keeps appearing across retros but never gets fixed?
- What would the team do differently if they were starting this sprint fresh?`,
      },
      {
        key: 'stakeholder-map',
        name: 'Stakeholder Map',
        description: 'Identify and map stakeholders by influence, interest, support level, and engagement strategy.',
        instructions: `## Stakeholder Map

Stakeholder dimensions:
- **Influence** — How much power do they have over the outcome?
- **Interest** — How much do they care about this initiative?
- **Support level** — Champion, Neutral, Skeptic, Blocker
- **Engagement strategy** — How and how often should you communicate with them?

**Quadrants:**
- High influence + High interest = Manage closely (keep informed and involved)
- High influence + Low interest = Keep satisfied (update proactively, don't overwhelm)
- Low influence + High interest = Keep informed (they'll amplify your message)
- Low influence + Low interest = Monitor (don't ignore, but minimal effort)

**Multi-directional probes:**
- Who is the hidden decision-maker — the person without a formal title who shapes outcomes?
- Which stakeholder is most at risk of derailing this at the last minute?
- Who is a champion now but could become a blocker if their priorities change?`,
      },
      {
        key: 'release-notes',
        name: 'Release Notes',
        description: 'Write customer-facing release notes that communicate value, not just features.',
        instructions: `## Release Notes

Principles:
- Lead with value/outcome, not feature name
- Use customer language, not engineering language
- Be specific about who benefits and how
- Include what changed and why (brief context)
- Link to documentation for details

**Structure:**
- **Headline:** What's new in one line (value-oriented)
- **What changed:** 2-3 bullet points of specific changes
- **Why it matters:** One sentence on the benefit
- **Who it affects:** Which user segment/plan
- **How to use it:** One sentence or link

**Multi-directional probes:**
- Who is the audience for these release notes — power users or new users?
- What question will customers ask after reading these?
- What context is assumed that should actually be explained?`,
      },
      {
        key: 'job-stories',
        name: 'Job Stories',
        description: 'Write job stories in the "When... I want to... So I can..." format to capture context and motivation.',
        instructions: `## Job Stories

Format: "When [situation/trigger], I want to [motivation/goal], so I can [expected outcome]."

**Job stories vs. user stories:**
- User stories focus on WHO (the persona)
- Job stories focus on WHEN (the context and situation)
- Job stories are better for uncovering the real motivation behind behavior

**Strong job stories:**
- Specific triggering situation (not "when I use the app")
- Clear motivation (what drives the action)
- Meaningful outcome (what changes as a result)
- No solution embedded in the story (pure need, not feature request)

**Multi-directional probes:**
- What's the emotional trigger, not just the functional trigger?
- What happens if this job doesn't get done? What's the consequence?
- Are there secondary jobs that get done along the way?`,
      },
      {
        key: 'test-scenarios',
        name: 'Test Scenarios',
        description: 'Define test scenarios covering happy path, edge cases, and failure modes.',
        instructions: `## Test Scenarios

Scenario categories:
- **Happy path** — Everything works as expected
- **Edge cases** — Boundary conditions, unusual inputs
- **Error states** — What happens when things fail?
- **Permission/access** — What can different user roles do?
- **Performance** — Behavior under load or with large data sets

**For each scenario:**
- Preconditions (what state must exist before)
- Steps (what the user/system does)
- Expected outcome
- Actual outcome (for test runs)
- Pass/Fail

**Multi-directional probes:**
- What's the worst thing a user could do with this feature — intentionally or accidentally?
- What breaks downstream when this feature fails?
- What does a new user do on first encounter that a power user would never do?`,
      },
      {
        key: 'summarize-meeting',
        name: 'Summarize Meeting',
        description: 'Transform meeting notes into structured summaries with decisions, action items, and context.',
        instructions: `## Meeting Summary

Output structure:
- **Date, Attendees, Meeting Purpose**
- **Key Decisions Made** — What was decided (not discussed — decided)
- **Open Questions / Unresolved** — What still needs an answer and from whom
- **Action Items** — Date, owner, specific deliverable
- **Context for the Record** — Background that future readers need

**What to capture:**
- Decisions, not discussions
- Commitments, not intentions
- Questions that need answering, not questions asked and forgotten

**Multi-directional probes:**
- What was decided that people will interpret differently next week?
- Who was absent who should have been there?
- What follow-up is needed that wasn't formally assigned?`,
      },
      {
        key: 'dummy-dataset',
        name: 'Dummy Dataset',
        description: 'Generate realistic synthetic datasets for testing, prototyping, and demos.',
        instructions: `## Dummy Dataset

Use when: prototyping a feature, creating demo environments, writing tests with realistic data.

**Dataset design questions:**
- What entity types are needed? (users, transactions, products, events?)
- What volume makes the demo feel real?
- What edge cases need to be represented in the data?
- What relationships between entities are important?
- What time range and patterns should be reflected?

**Quality criteria:**
- Realistic distributions (not perfectly uniform)
- Appropriate edge cases included
- Referential integrity maintained
- Sensitive fields anonymized
- Consistent internal logic (timestamps make sense, relationships are valid)

**Multi-directional probes:**
- What would make a demo using this data feel fake — and how do you prevent that?
- What real-world patterns (seasonality, spikes, nulls) need to be in the data?`,
      },
      {
        key: 'prioritization-frameworks',
        name: 'Prioritization Frameworks',
        description: 'Apply and compare ICE, RICE, Kano, MoSCoW, and Opportunity Scoring frameworks.',
        instructions: `## Prioritization Frameworks

Key frameworks:

**ICE:** Impact × Confidence × Ease (score 1-10 each)
- Impact: How much does this move the needle?
- Confidence: How certain are you it'll have that impact?
- Ease: How easy is it to implement?

**RICE:** (Reach × Impact × Confidence) / Effort
- Reach: How many users in a period?
- Effort: Person-weeks required

**Kano Model:**
- Basic needs (must-have — their absence creates dissatisfaction)
- Performance needs (more = better)
- Delighters (unexpected, create delight when present)

**MoSCoW:**
- Must have, Should have, Could have, Won't have this time

**Opportunity Scoring:** Importance × (1 − Satisfaction) — finds under-served needs

**Multi-directional probes:**
- Which framework fits your current decision — and what would the others say differently?
- Who on the team would score these items most differently from you — and why?
- What's being excluded from the scoring that matters?`,
      },
    ],
  },
  {
    key: 'pm-data-analytics',
    label: 'Data & Analytics',
    skills: [
      {
        key: 'ab-test-analysis',
        name: 'A/B Test Analysis',
        description: 'Analyze experiment results: statistical significance, sample size, guardrail metrics, and ship/extend/stop decisions.',
        instructions: `## A/B Test Analysis

Analysis framework:
1. **Validate test setup** — Was the test run correctly? Sample size, duration, randomization?
2. **Statistical significance** — p-value < 0.05 (or your threshold), confidence intervals
3. **Primary metric movement** — Did the metric you were testing actually move?
4. **Guardrail metrics** — Did any important metrics you weren't testing degrade?
5. **Segment analysis** — Did the effect vary by segment? (Overall lift may hide segment harm)
6. **Recommendation** — Ship / Extend (need more data) / Stop (no effect or harm)

**Common mistakes:**
- Peeking: stopping early when the test looks good
- Sample ratio mismatch: unequal split from a bug
- Survivorship bias: measuring only users who completed the funnel

**Multi-directional probes:**
- What metric would you check that you didn't plan to check?
- What behavior might the test have changed that you can't measure?
- Who was excluded from the test — and does that matter for interpreting results?`,
      },
      {
        key: 'cohort-analysis',
        name: 'Cohort Analysis',
        description: 'Analyze user retention and engagement patterns by cohort to identify trends and drivers.',
        instructions: `## Cohort Analysis

Standard cohort types:
- **Acquisition cohorts** — Users grouped by sign-up date
- **Behavioral cohorts** — Users grouped by first key action
- **Revenue cohorts** — Customers grouped by first purchase date

**Key metrics to analyze:**
- Retention rate by week/month
- Revenue per cohort over time
- Feature adoption by cohort
- Churn patterns by cohort age

**Interpretation framework:**
- Are newer cohorts retaining better than older ones? (Product improvement signal)
- Are specific acquisition sources producing better cohorts?
- Is there a drop-off cliff at a specific time interval?
- What do the best cohorts have in common in their first week?

**Multi-directional probes:**
- What does the cohort analysis reveal that aggregate metrics hide?
- Which cohort is your "ideal" — what made it that way?
- What would you change in onboarding based on where cohorts lose the most users?`,
      },
      {
        key: 'sql-queries',
        name: 'SQL Query Builder',
        description: 'Generate optimized SQL queries for product analytics across BigQuery, PostgreSQL, Snowflake, and more.',
        instructions: `## SQL Query Builder

Supported platforms: BigQuery, PostgreSQL, MySQL, Snowflake, SQL Server

**Query types:**
- Funnel analysis (step-by-step conversion rates)
- Cohort retention tables
- User segmentation queries
- Revenue and usage metrics
- Event sequence analysis

**Best practices:**
- Explain the business question, not just the technical query
- Consider performance (avoid full table scans on large tables)
- Include comments for complex logic
- Parameterize dates and IDs for reusability

**Multi-directional probes:**
- What question is this query trying to answer — can it be stated in plain English first?
- What table relationships are involved — are there any gotchas with how they join?
- What edge cases in the data (nulls, duplicates, time zones) could skew results?`,
      },
    ],
  },
  {
    key: 'pm-toolkit',
    label: 'Quick Tools',
    skills: [
      {
        key: 'grammar-check',
        name: 'Grammar & Flow Check',
        description: 'Identify and fix grammar, logic, and flow errors in any text.',
        instructions: `## Grammar and Flow Check

Error categories:
- **Grammar:** Spelling, punctuation, subject-verb agreement, tense consistency
- **Logic:** Contradictions, unsupported claims, non-sequiturs
- **Flow:** Awkward transitions, unclear antecedents, passive voice overuse, jargon

Output format:
- Error summary (count by category)
- Fixes by category with original and corrected versions
- Priority fixes (top 3 most impactful)
- Overall tone and objective alignment assessment`,
      },
      {
        key: 'draft-nda',
        name: 'Draft NDA',
        description: 'Draft a non-disclosure agreement for mutual or one-way confidentiality.',
        instructions: `## Non-Disclosure Agreement (NDA)

IMPORTANT: This is a starting template. Always have a qualified attorney review before signing.

NDA types:
- **Mutual (bilateral)** — Both parties share confidential information
- **One-way (unilateral)** — Only one party shares information

Key sections:
1. Preamble — Parties, date, purpose
2. Definition of Confidential Information — What's covered and what's excluded
3. Obligations — What the receiving party must do/not do
4. Permitted Disclosures — Legal carve-outs (courts, regulators)
5. Term and Duration — How long the agreement lasts
6. Return or Destruction — What happens to information after the agreement ends
7. Remedies — Consequences of breach (often injunctive relief)
8. General Provisions — Governing law, entire agreement, severability`,
      },
      {
        key: 'privacy-policy',
        name: 'Privacy Policy',
        description: 'Generate a privacy policy template for web applications and SaaS products.',
        instructions: `## Privacy Policy Generator

IMPORTANT: This is a template only. Consult a privacy attorney before publishing.

Key sections (14):
1. Preamble — Company name, contact, effective date
2. Information We Collect — Specific data types
3. How We Collect — Methods (forms, cookies, APIs, third parties)
4. How We Use — Purposes (service delivery, analytics, marketing)
5. Legal Basis — GDPR lawful basis if applicable
6. Data Sharing — Third parties, with what protections
7. International Transfers — Cross-border data movement
8. Retention — How long data is kept
9. User Rights — Access, deletion, portability, opt-out
10. Cookies — What cookies, what for, how to opt out
11. Security — How data is protected
12. Children's Privacy — Under-13/under-16 policy
13. Contact — How to reach the DPO or privacy team
14. Policy Changes — How users are notified of changes`,
      },
    ],
  },
]

export function findSkill(categoryKey: string, skillKey: string): Skill | undefined {
  const category = PRODUCT_MARKETING_SKILLS.find((c) => c.key === categoryKey)
  return category?.skills.find((s) => s.key === skillKey)
}

export function allSkills(): Skill[] {
  return PRODUCT_MARKETING_SKILLS.flatMap((c) => c.skills.map((s) => ({ ...s, category: c.key })))
}
