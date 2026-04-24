import { useState } from 'react'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ─── helpers ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground border-b border-border pb-2">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Swatch({ label, bg, hex, tailwind, textClass = 'text-foreground' }: {
  label: string; bg: string; hex: string; tailwind: string; textClass?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(tailwind); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
      className="flex flex-col overflow-hidden rounded-lg border border-border text-left hover:shadow-md transition-shadow"
      title={`Click to copy: ${tailwind}`}
    >
      <div className={cn('h-16 w-full', bg)} style={bg.startsWith('bg-') ? undefined : { background: bg }} />
      <div className="bg-white px-2.5 py-2 space-y-0.5">
        <p className="text-[11px] font-semibold text-foreground">{label}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{tailwind}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{hex}</p>
        {copied && <p className="text-[10px] text-emerald-600 font-medium">Copied!</p>}
      </div>
    </button>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative rounded-lg border border-border bg-muted/60 overflow-hidden">
      <pre className="overflow-x-auto px-4 py-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
        {code.trim()}
      </pre>
      <button
        onClick={() => { navigator.clipboard.writeText(code.trim()); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
        className="absolute top-2 right-2 rounded border border-border bg-white px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// ─── Diagram boxes ────────────────────────────────────────────────────────────

function TemplateDiagram({ label, rows }: {
  label: string
  rows: { label: string; height: string; style: string }[]
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-foreground">{label}</p>
      <div className="rounded-lg border-2 border-border overflow-hidden w-full">
        {rows.map((row, i) => (
          <div
            key={i}
            className={cn('flex items-center justify-center text-[10px] font-medium border-b last:border-b-0 border-border', row.height, row.style)}
          >
            {row.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ThemePage() {
  return (
    <div className="flex flex-col h-full bg-background">

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
        <div className="flex items-center gap-3">
          <Icons.Palette className="h-4 w-4 text-muted-foreground" />
          <div>
            <h1 className="text-sm font-semibold">Theme & Design System</h1>
            <p className="text-[11px] text-muted-foreground">Colors, templates, components, and rules</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 space-y-12 max-w-5xl">

        {/* ── 1. Page Templates ─────────────────────────────────────────── */}
        <Section title="Page Templates">
          <p className="text-xs text-muted-foreground mb-4">
            Three canonical layouts. Every new page must use one of these.
            Reference by name when asking Claude to build a page.
          </p>

          <div className="grid grid-cols-3 gap-6">
            {/* Template A */}
            <div className="space-y-3">
              <TemplateDiagram
                label="Template A — StandardPageLayout"
                rows={[
                  { label: 'Header h-14 · bg-background · border-b', height: 'h-10', style: 'bg-accent/60 text-foreground/60' },
                  { label: 'flex-1 · overflow-y-auto · p-6', height: 'h-32', style: 'bg-background text-muted-foreground' },
                ]}
              />
              <div className="rounded-lg border border-border bg-white p-3 space-y-1.5">
                <p className="text-[11px] font-semibold">Use for</p>
                <p className="text-[11px] text-muted-foreground">Single content area — Clients, Calendar, Usage, Team, Settings, Deliverables, Workflows</p>
                <p className="text-[11px] font-semibold mt-2">Import</p>
                <code className="text-[10px] font-mono text-purple-700">@/components/templates/StandardPageLayout</code>
              </div>
            </div>

            {/* Template B */}
            <div className="space-y-3">
              <TemplateDiagram
                label="Template B — TabbedPageLayout"
                rows={[
                  { label: 'Header h-14 (optional)', height: 'h-8', style: 'bg-accent/60 text-foreground/60' },
                  { label: 'Tab bar · shrink-0 · border-b', height: 'h-8', style: 'bg-muted text-foreground/60' },
                  { label: 'flex-1 · overflow-hidden (tab children scroll)', height: 'h-28', style: 'bg-background text-muted-foreground' },
                ]}
              />
              <div className="rounded-lg border border-border bg-white p-3 space-y-1.5">
                <p className="text-[11px] font-semibold">Use for</p>
                <p className="text-[11px] text-muted-foreground">Tab-switched views — Reviews & Runs, Quality & Reports, Client Detail, any multi-mode page</p>
                <p className="text-[11px] font-semibold mt-2">Import</p>
                <code className="text-[10px] font-mono text-purple-700">@/components/templates/TabbedPageLayout</code>
              </div>
            </div>

            {/* Template C */}
            <div className="space-y-3">
              <TemplateDiagram
                label="Template C — SplitPageLayout"
                rows={[
                  { label: 'Header h-14', height: 'h-8', style: 'bg-accent/60 text-foreground/60' },
                  { label: 'flex flex-1 overflow-hidden', height: 'h-36', style: 'bg-background text-muted-foreground' },
                ]}
              />
              <div className="h-[72px] -mt-[108px] ml-[50%] mr-0 rounded-r-lg border-l border-border bg-muted/40 flex items-center justify-center mb-[36px] z-10 relative">
                <p className="text-[10px] text-muted-foreground rotate-90 whitespace-nowrap">sidebar w-80</p>
              </div>
              <div className="rounded-lg border border-border bg-white p-3 space-y-1.5">
                <p className="text-[11px] font-semibold">Use for</p>
                <p className="text-[11px] text-muted-foreground">Main + side panel — My Work, Review page, detail + actions</p>
                <p className="text-[11px] font-semibold mt-2">Import</p>
                <code className="text-[10px] font-mono text-purple-700">@/components/templates/SplitPageLayout</code>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
            <p className="text-xs font-semibold text-amber-800">Header rules (all templates)</p>
            <ul className="text-[11px] text-amber-700 space-y-1 list-disc pl-4">
              <li>Height: <code className="font-mono">h-14</code> — never taller, never shorter</li>
              <li>Background: <code className="font-mono">bg-background</code> — never <code className="font-mono">bg-card</code> or <code className="font-mono">bg-white</code></li>
              <li>Bottom border: <code className="font-mono">border-b border-border</code></li>
              <li>Padding: <code className="font-mono">px-6</code> horizontal</li>
              <li>Left: icon + title (+ optional subtitle). Right: action buttons</li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold">Quick-start — Template A</p>
            <CodeBlock code={`
import { StandardPageLayout } from '@/components/templates/StandardPageLayout'
import * as Icons from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MyPage() {
  return (
    <StandardPageLayout
      icon={Icons.Users}
      title="Page Title"
      subtitle="Optional subtitle"
      headerActions={<Button size="sm">Action</Button>}
    >
      {/* your content here */}
    </StandardPageLayout>
  )
}
            `} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold">Quick-start — Template B</p>
            <CodeBlock code={`
import { useState } from 'react'
import { TabbedPageLayout } from '@/components/templates/TabbedPageLayout'
import * as Icons from 'lucide-react'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Icons.LayoutDashboard },
  { id: 'activity', label: 'Activity', icon: Icons.Activity },
]

export function MyPage() {
  const [tab, setTab] = useState('overview')
  return (
    <TabbedPageLayout
      title="Page Title"
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
    >
      <div className={tab !== 'overview' ? 'hidden' : 'h-full overflow-y-auto p-6'}>
        {/* overview content */}
      </div>
      <div className={tab !== 'activity' ? 'hidden' : 'h-full overflow-y-auto p-6'}>
        {/* activity content */}
      </div>
    </TabbedPageLayout>
  )
}
            `} />
          </div>
        </Section>

        {/* ── 2. Color Palette ──────────────────────────────────────────────── */}
        <Section title="Semantic Color Tokens">
          <p className="text-[11px] text-muted-foreground mb-3">
            Always prefer these tokens over hardcoded hex or Tailwind color classes.
            They adapt to theme changes and keep the UI consistent.
          </p>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
            <Swatch label="background" bg="bg-background" hex="#f5f4ef" tailwind="bg-background" />
            <Swatch label="foreground" bg="bg-foreground" hex="#1a1a14" tailwind="bg-foreground" textClass="text-white" />
            <Swatch label="card" bg="bg-card" hex="#ffffff" tailwind="bg-card" />
            <Swatch label="muted" bg="bg-muted" hex="#fafaf7" tailwind="bg-muted" />
            <Swatch label="muted-fg" bg="bg-muted-foreground" hex="#5f5e5a" tailwind="bg-muted-foreground" textClass="text-white" />
            <Swatch label="accent" bg="bg-accent" hex="#f0ede8" tailwind="bg-accent" />
            <Swatch label="primary" bg="bg-primary" hex="#a200ee" tailwind="bg-primary" textClass="text-white" />
            <Swatch label="border" bg="bg-border" hex="#e0deda" tailwind="bg-border" />
            <Swatch label="destructive" bg="bg-destructive" hex="#dc2626" tailwind="bg-destructive" textClass="text-white" />
          </div>
        </Section>

        <Section title="Status & Accent Colors">
          <p className="text-[11px] text-muted-foreground mb-3">
            Hardcoded Tailwind colors used for semantic state. Use these consistently.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Approved / Success', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', name: 'emerald' },
              { label: 'Warning / Pending', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', name: 'amber' },
              { label: 'Error / Rejected', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500', name: 'red' },
              { label: 'Info / Active', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500', name: 'blue' },
              { label: 'In Review', bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dot: 'bg-violet-500', name: 'violet' },
              { label: 'AI / Insights', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500', name: 'purple' },
              { label: 'Overdue', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-500', name: 'orange' },
              { label: 'Neutral / Draft', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', dot: 'bg-slate-400', name: 'slate' },
            ].map((s) => (
              <div key={s.name} className={cn('rounded-lg border p-3 flex items-center gap-2.5', s.bg, s.border)}>
                <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', s.dot)} />
                <div>
                  <p className={cn('text-[11px] font-semibold', s.text)}>{s.label}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{s.name}-50/200/700</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 3. Typography ─────────────────────────────────────────────────── */}
        <Section title="Typography">
          <div className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-muted-foreground">text-sm font-semibold — page title / section header</p>
              <p className="text-sm font-semibold">Page Title or Section Header</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-muted-foreground">text-xs font-semibold — card title / label</p>
              <p className="text-xs font-semibold">Card Title or Label</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-muted-foreground">text-xs — body text</p>
              <p className="text-xs">Standard body text for descriptions and content inside cards or forms.</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-muted-foreground">text-[11px] text-muted-foreground — secondary / helper text</p>
              <p className="text-[11px] text-muted-foreground">Secondary description, timestamps, helper text below fields.</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-muted-foreground">text-[10px] font-mono text-muted-foreground — code / meta</p>
              <p className="text-[10px] font-mono text-muted-foreground">SYSTEM_ENV_VAR, token references, small code snippets</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-mono text-muted-foreground">text-xs font-semibold uppercase tracking-widest text-muted-foreground — section divider label</p>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Section Divider Label</p>
            </div>
          </div>
        </Section>

        {/* ── 4. Cards ──────────────────────────────────────────────────────── */}
        <Section title="Card Patterns">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 mb-4">
            <p className="text-[11px] font-semibold text-red-700">Non-negotiable card rules</p>
            <ul className="text-[11px] text-red-600 mt-1 space-y-0.5 list-disc pl-4">
              <li>Inline list cards (inside a page): <code className="font-mono">bg-transparent border border-border</code> — never <code className="font-mono">bg-card</code></li>
              <li>
                Modal / dialog content box:{' '}
                <code className="font-mono">bg-white border border-border rounded-xl</code>{' '}
                <code className="font-mono">shadow-2xl</code>
                {' — never '}
                <code className="font-mono">bg-card</code>
                {' or '}
                <code className="font-mono">bg-background</code>
              </li>
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold">Inline list card</p>
              <div className="bg-transparent border border-border rounded-xl p-4 space-y-1.5">
                <p className="text-xs font-semibold">Client Name</p>
                <p className="text-[11px] text-muted-foreground">3 active workflows · Last run 2h ago</p>
                <div className="flex gap-1.5 mt-2">
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700 font-medium">Active</span>
                </div>
              </div>
              <CodeBlock code={`<div className="bg-transparent border border-border rounded-xl p-4">`} />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold">Metric / stat card</p>
              <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                <p className="text-[11px] text-muted-foreground">Total Runs</p>
                <p className="text-2xl font-bold">142</p>
                <p className="text-[11px] text-emerald-600">↑ 12% this week</p>
              </div>
              <CodeBlock code={`<div className="rounded-xl border border-border bg-card p-4">`} />
            </div>
          </div>
        </Section>

        {/* ── 5. Modal rules ────────────────────────────────────────────────── */}
        <Section title="Modal / Dialog Rules">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
            <p className="text-[11px] font-semibold text-red-800">Non-negotiable — do not deviate</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold text-red-700 mb-1">Overlay div</p>
                <code className="text-[10px] font-mono text-red-600 block leading-relaxed">
                  fixed inset-0 z-50 flex items-center<br/>
                  justify-center bg-black/60 backdrop-blur-sm
                </code>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-red-700 mb-1">Content box</p>
                <code className="text-[10px] font-mono text-red-600 block leading-relaxed">
                  bg-white border border-border<br/>
                  rounded-xl shadow-2xl
                </code>
              </div>
            </div>
            <p className="text-[11px] text-red-600 mt-2">
              Never use <code className="font-mono">bg-card</code>, <code className="font-mono">bg-background</code>,
              or any opacity suffix on modal content boxes.
              Reference: <code className="font-mono">CampaignCreationModal.tsx</code>
            </p>
          </div>

          <CodeBlock code={`
{/* Modal overlay */}
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
  {/* Modal content */}
  <div className="w-[480px] rounded-xl border border-border bg-white shadow-2xl">
    {/* header */}
    <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
      <span className="text-sm font-semibold">Modal Title</span>
      <button onClick={onClose}><Icons.X className="h-4 w-4" /></button>
    </div>
    {/* body */}
    <div className="p-4 space-y-4">
      {/* content */}
    </div>
    {/* footer */}
    <div className="flex gap-2 border-t border-border/40 p-4">
      <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
      <Button className="flex-1">Confirm</Button>
    </div>
  </div>
</div>
          `} />
        </Section>

        {/* ── 6. Buttons ────────────────────────────────────────────────────── */}
        <Section title="Button Variants">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
            <p className="text-[11px] text-amber-700">
              Always use the standard <code className="font-mono">Button</code> component from
              <code className="font-mono"> @/components/ui/button</code>.
              Never invent per-feature color schemes for CTAs.
              Primary action = default variant. Secondary = outline. Tertiary = ghost.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1 text-center">
              <Button size="sm">Primary</Button>
              <p className="text-[10px] text-muted-foreground font-mono">default</p>
            </div>
            <div className="space-y-1 text-center">
              <Button size="sm" variant="outline">Secondary</Button>
              <p className="text-[10px] text-muted-foreground font-mono">outline</p>
            </div>
            <div className="space-y-1 text-center">
              <Button size="sm" variant="ghost">Ghost</Button>
              <p className="text-[10px] text-muted-foreground font-mono">ghost</p>
            </div>
            <div className="space-y-1 text-center">
              <Button size="sm" variant="destructive">Delete</Button>
              <p className="text-[10px] text-muted-foreground font-mono">destructive</p>
            </div>
            <div className="space-y-1 text-center">
              <Button size="sm" disabled>Disabled</Button>
              <p className="text-[10px] text-muted-foreground font-mono">disabled</p>
            </div>
            <div className="space-y-1 text-center">
              <Button size="sm" className="gap-1.5"><Icons.Plus className="h-3.5 w-3.5" />With icon</Button>
              <p className="text-[10px] text-muted-foreground font-mono">+ icon</p>
            </div>
          </div>
        </Section>

        {/* ── 7. Badges ─────────────────────────────────────────────────────── */}
        <Section title="Badge Patterns">
          <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-4">
            {[
              { label: 'Approved', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              { label: 'Pending', cls: 'bg-amber-50 border-amber-200 text-amber-700' },
              { label: 'Rejected', cls: 'bg-red-50 border-red-200 text-red-700' },
              { label: 'In Review', cls: 'bg-blue-50 border-blue-200 text-blue-700' },
              { label: 'Draft', cls: 'bg-slate-50 border-slate-200 text-slate-600' },
              { label: 'AI', cls: 'bg-purple-50 border-purple-200 text-purple-700' },
              { label: '3', cls: 'bg-blue-100 border-blue-200 text-blue-700' },
            ].map((b) => (
              <span key={b.label} className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium', b.cls)}>
                {b.label}
              </span>
            ))}
          </div>
          <CodeBlock code={`<span className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium bg-emerald-50 border-emerald-200 text-emerald-700">
  Approved
</span>`} />
        </Section>

        {/* ── 8. Spacing cheatsheet ─────────────────────────────────────────── */}
        <Section title="Spacing & Layout Standards">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-semibold">Common values</p>
              {[
                ['Page content padding', 'p-6'],
                ['Header horizontal', 'px-6'],
                ['Card padding', 'p-4'],
                ['Card padding (compact)', 'p-3'],
                ['Gap between cards', 'gap-3 or gap-4'],
                ['Section spacing', 'space-y-4 or space-y-6'],
                ['Header height', 'h-14'],
                ['Right sidebar width', 'w-80 (320px)'],
                ['Wide sidebar', 'w-96 (384px)'],
                ['Narrow sidebar', 'w-64 (256px)'],
                ['Tab bar padding', 'px-4 py-3'],
                ['Button size (inline)', 'size="sm" h-8'],
                ['Icon size (header)', 'h-4 w-4'],
                ['Icon size (inline)', 'h-3.5 w-3.5'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <code className="text-[10px] font-mono text-foreground">{value}</code>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <p className="text-xs font-semibold">Border radius</p>
              {[
                ['Cards, panels', 'rounded-xl'],
                ['Buttons, chips, badges', 'rounded-md or rounded-full'],
                ['Inputs', 'rounded-md'],
                ['Dropdown menus', 'rounded-lg'],
                ['Avatars', 'rounded-full'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <code className="text-[10px] font-mono text-foreground">{value}</code>
                </div>
              ))}
              <p className="text-xs font-semibold mt-4">Shadows</p>
              {[
                ['Modal / dialog', 'shadow-2xl'],
                ['Card hover', 'hover:shadow-md'],
                ['Dropdown / popover', 'shadow-lg'],
                ['Subtle card', 'shadow-sm'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <code className="text-[10px] font-mono text-foreground">{value}</code>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ── 9. Empty states ───────────────────────────────────────────────── */}
        <Section title="Empty State Pattern">
          <div className="rounded-xl border border-border bg-card p-8">
            <div className="flex flex-col items-center gap-3 py-8 text-center max-w-sm mx-auto">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Icons.Inbox className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="text-[11px] text-muted-foreground">
                Descriptive helper text explaining what this section is for and how to get started.
              </p>
              <Button size="sm" className="mt-1 gap-1.5">
                <Icons.Plus className="h-3.5 w-3.5" />
                Create first item
              </Button>
            </div>
          </div>
          <CodeBlock code={`
<div className="flex flex-col items-center gap-3 py-16 text-center">
  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
    <Icons.Inbox className="h-6 w-6 text-muted-foreground/50" />
  </div>
  <p className="text-sm font-medium">Nothing here yet</p>
  <p className="text-[11px] text-muted-foreground max-w-xs">Helper text.</p>
  <Button size="sm" className="mt-1 gap-1.5">
    <Icons.Plus className="h-3.5 w-3.5" />Create first item
  </Button>
</div>
          `} />
        </Section>

        <div className="h-16" />
      </main>
    </div>
  )
}
