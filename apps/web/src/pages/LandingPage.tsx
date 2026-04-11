import { useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import * as Icons from 'lucide-react'

const FEATURES = [
  {
    icon: Icons.Workflow,
    title: 'Visual Workflow Builder',
    description:
      'Drag-and-drop nodes onto a canvas to build content pipelines. Connect sources, AI generators, humanizers, and client outputs in any configuration.',
    color: '#185fa5',
    bg: '#f0f6fd',
  },
  {
    icon: Icons.BrainCircuit,
    title: 'AI Detection & Humanization',
    description:
      'Built-in AI detection scoring and multi-provider humanization. Run content through automatic loops until it passes your threshold.',
    color: '#a200ee',
    bg: '#fdf5ff',
  },
  {
    icon: Icons.Globe,
    title: 'Client Feedback Portals',
    description:
      'Give clients a branded portal to review deliverables, leave structured feedback, and approve content — no email chains, no confusion.',
    color: '#166534',
    bg: '#f0fdf4',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Build your workflow',
    body: 'Open the visual editor and connect source nodes, AI processors, and output nodes into a reusable pipeline.',
  },
  {
    n: '02',
    title: 'Run and refine',
    body: 'Execute the workflow with one click. Review per-node outputs, rerun from any point, and humanize content automatically.',
  },
  {
    n: '03',
    title: 'Deliver to clients',
    body: 'Share a branded portal link. Clients review, leave feedback, and approve. Their responses feed directly back into the workflow.',
  },
]

export function LandingPage() {
  const { isSignedIn, isLoaded } = useAuth()
  const navigate = useNavigate()

  // Redirect authenticated users straight into the app
  useEffect(() => {
    if (isLoaded && isSignedIn) navigate('/workflows', { replace: true })
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ backgroundColor: '#fafaf8' }}>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#a200ee] border-t-transparent" />
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: '#fafaf8', color: '#1a1a14', fontFamily: 'inherit' }}>

      {/* ── Nav ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b" style={{ backgroundColor: '#fafaf8', borderColor: '#e8e7e1' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <img src="/logo-full.png" alt="ContentNode AI" className="h-8 w-auto object-contain" />
          <div className="flex items-center gap-3">
            <Link
              to="/sign-in"
              className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: '#5c5b52' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#1a1a14')}
              onMouseLeave={e => (e.currentTarget.style.color = '#5c5b52')}
            >
              Sign in
            </Link>
            <Link
              to="/sign-in"
              className="rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#a200ee' }}
            >
              Get started →
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <div
          className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
          style={{ borderColor: '#e9c8ff', backgroundColor: '#fdf5ff', color: '#a200ee' }}
        >
          <Icons.Sparkles className="h-3 w-3" />
          AI-powered content operations for agencies
        </div>

        <h1
          className="mx-auto mb-6 max-w-3xl text-5xl font-bold leading-tight tracking-tight"
          style={{ color: '#1a1a14' }}
        >
          Content workflows your{' '}
          <span style={{ color: '#a200ee' }}>whole agency</span>{' '}
          can actually run.
        </h1>

        <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed" style={{ color: '#5c5b52' }}>
          Build reusable AI content pipelines with a visual node editor. Humanize outputs automatically,
          collect client feedback through branded portals, and ship faster without the back-and-forth.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            to="/sign-in"
            className="rounded-lg px-7 py-3 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#a200ee' }}
          >
            Get started free →
          </Link>
          <a
            href="#how-it-works"
            className="rounded-lg border px-7 py-3 text-sm font-medium transition-colors"
            style={{ borderColor: '#dddcd6', color: '#5c5b52' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f4f4f2' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
          >
            See how it works
          </a>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section className="border-t border-b" style={{ borderColor: '#e8e7e1', backgroundColor: '#ffffff' }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="mb-3 text-center text-2xl font-bold" style={{ color: '#1a1a14' }}>
            Everything your team needs to deliver at scale
          </h2>
          <p className="mx-auto mb-12 max-w-xl text-center text-sm leading-relaxed" style={{ color: '#5c5b52' }}>
            From first draft to client approval — built for the way content agencies actually work.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, description, color, bg }) => (
              <div
                key={title}
                className="rounded-xl border p-6 transition-shadow hover:shadow-md"
                style={{ borderColor: '#e8e7e1', backgroundColor: '#fafaf8' }}
              >
                <div
                  className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: bg }}
                >
                  <Icon className="h-5 w-5" style={{ color }} />
                </div>
                <h3 className="mb-2 text-[15px] font-semibold" style={{ color: '#1a1a14' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#5c5b52' }}>{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="mb-3 text-center text-2xl font-bold" style={{ color: '#1a1a14' }}>
          How it works
        </h2>
        <p className="mx-auto mb-14 max-w-md text-center text-sm leading-relaxed" style={{ color: '#5c5b52' }}>
          Three steps from workflow creation to client delivery.
        </p>

        <div className="grid gap-8 md:grid-cols-3">
          {STEPS.map(({ n, title, body }) => (
            <div key={n} className="relative">
              {/* Step connector line */}
              <div
                className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold"
                style={{ backgroundColor: '#fdf5ff', color: '#a200ee', border: '1px solid #e9c8ff' }}
              >
                {n}
              </div>
              <h3 className="mb-2 text-[15px] font-semibold" style={{ color: '#1a1a14' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#5c5b52' }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── More features strip ────────────────────────────────────────── */}
      <section className="border-t border-b" style={{ borderColor: '#e8e7e1', backgroundColor: '#1a1a14' }}>
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { icon: Icons.GitBranch,   label: 'Conditional branching' },
              { icon: Icons.Languages,   label: 'Multi-language translation' },
              { icon: Icons.AudioLines,  label: 'Audio transcription' },
              { icon: Icons.BarChart3,   label: 'Detection scoring' },
              { icon: Icons.FileText,    label: 'GTM framework builder' },
              { icon: Icons.RefreshCw,   label: 'Re-run from any node' },
              { icon: Icons.Calendar,    label: 'Scheduled workflows' },
              { icon: Icons.Lightbulb,   label: 'Pattern intelligence' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: 'rgba(162,0,238,0.15)' }}
                >
                  <Icon className="h-4 w-4" style={{ color: '#c94fff' }} />
                </div>
                <span className="text-[13px] font-medium" style={{ color: '#dddcd6' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="mb-4 text-3xl font-bold" style={{ color: '#1a1a14' }}>
          Ready to build your first workflow?
        </h2>
        <p className="mx-auto mb-8 max-w-md text-sm leading-relaxed" style={{ color: '#5c5b52' }}>
          Get your team set up and running content workflows in minutes.
          No credit card required to get started.
        </p>
        <Link
          to="/sign-in"
          className="inline-flex items-center gap-2 rounded-lg px-8 py-3 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#a200ee' }}
        >
          Get started →
        </Link>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: '#e8e7e1' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <img src="/logo-full.png" alt="ContentNode AI" className="h-6 w-auto object-contain opacity-60" />
          <div className="flex items-center gap-5">
            <Link to="/sign-in" className="text-xs transition-colors" style={{ color: '#b4b2a9' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#5c5b52')}
              onMouseLeave={e => (e.currentTarget.style.color = '#b4b2a9')}
            >
              Sign in
            </Link>
            <span className="text-xs" style={{ color: '#b4b2a9' }}>© 2026 ContentNode.ai</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
