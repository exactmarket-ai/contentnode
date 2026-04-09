import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/store/workflowStore'
import { FieldGroup } from '../shared'

const FEEDBACK_SOURCE_TYPES = [
  { value: 'portal',        label: 'Client Portal' },
  { value: 'manual',        label: 'Manual Entry' },
  { value: 'transcription', label: 'Transcription' },
]

const FEEDBACK_SENTIMENTS = [
  { value: 'approved',              label: 'Approved' },
  { value: 'approved_with_changes', label: 'Approved with changes' },
  { value: 'needs_revision',        label: 'Needs revision' },
  { value: 'rejected',              label: 'Rejected' },
]

const TONE_OPTIONS = [
  { value: 'too_formal',  label: 'Too formal' },
  { value: 'too_casual',  label: 'Too casual' },
  { value: 'just_right',  label: 'Just right' },
  { value: 'too_generic', label: 'Too generic' },
]

const CONTENT_TAG_OPTIONS = [
  { value: 'too_long',       label: 'Too long' },
  { value: 'too_short',      label: 'Too short' },
  { value: 'missing_points', label: 'Missing points' },
  { value: 'off_brief',      label: 'Off brief' },
  { value: 'good',           label: 'Good' },
]

interface ReentryRule {
  sentiment: string
  reentry_node_id: string
}

interface ManualFeedback {
  decision: string
  star_rating: number
  tone_feedback: string
  content_tags: string[]
  comment: string
}

export function ClientFeedbackConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
}) {
  const sourceType       = (config.source_type as string) ?? 'portal'
  const triggerMode      = (config.trigger_mode as string) ?? 'auto'
  const autoTriggerOn    = (config.auto_trigger_on as string[]) ?? ['needs_revision', 'rejected']
  const reentryNodeId    = (config.default_reentry_node_id as string) ?? ''
  const reentryRules     = (config.reentry_rules as ReentryRule[]) ?? []
  const maxAutoRetries   = (config.max_auto_retries as number) ?? 3
  const stakeholderIds   = (config.stakeholder_ids as string[]) ?? []
  const manualFeedback   = (config.manual_feedback as ManualFeedback) ?? {
    decision: 'needs_revision', star_rating: 3, tone_feedback: '', content_tags: [], comment: '',
  }

  const nodes = useWorkflowStore((s) => s.nodes)
  // All non-feedback nodes that could be re-entry points
  const reentryNodes = nodes.filter((n) => n.data?.subtype !== 'client-feedback')

  const toggleAutoTrigger = (sentiment: string) => {
    const next = autoTriggerOn.includes(sentiment)
      ? autoTriggerOn.filter((s) => s !== sentiment)
      : [...autoTriggerOn, sentiment]
    onChange('auto_trigger_on', next)
  }

  const updateReentryRule = (sentiment: string, nodeId: string) => {
    const existing = reentryRules.filter((r) => r.sentiment !== sentiment)
    if (nodeId) existing.push({ sentiment, reentry_node_id: nodeId })
    onChange('reentry_rules', existing)
  }

  const getReentryRule = (sentiment: string) =>
    reentryRules.find((r) => r.sentiment === sentiment)?.reentry_node_id ?? ''

  const toggleContentTag = (tag: string) => {
    const tags = manualFeedback.content_tags ?? []
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    onChange('manual_feedback', { ...manualFeedback, content_tags: next })
  }

  return (
    <>
      {/* Source type */}
      <FieldGroup label="Source Type">
        <Select value={sourceType} onValueChange={(v) => onChange('source_type', v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FEEDBACK_SOURCE_TYPES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>

      {/* Trigger mode */}
      <FieldGroup label="Trigger Mode">
        <div className="grid grid-cols-2 gap-1.5">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onChange('trigger_mode', m)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                triggerMode === m
                  ? 'border-purple-400 bg-purple-50 text-purple-700'
                  : 'border-border text-muted-foreground hover:bg-accent/40',
              )}
            >
              {m === 'auto' ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {triggerMode === 'auto'
            ? 'Automatically re-triggers the workflow when sentiment matches.'
            : 'Pauses the workflow — resume manually after entering feedback.'}
        </p>
      </FieldGroup>

      {/* Stakeholder IDs (portal mode) */}
      {sourceType === 'portal' && (
        <FieldGroup label="Stakeholder IDs">
          <Textarea
            className="min-h-[60px] font-mono text-xs"
            placeholder="One stakeholder ID per line"
            value={stakeholderIds.join('\n')}
            onChange={(e) =>
              onChange('stakeholder_ids', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Paste stakeholder IDs from the Clients section. Magic links are generated automatically.
          </p>
        </FieldGroup>
      )}

      {/* Auto mode settings */}
      {triggerMode === 'auto' && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auto-trigger on Sentiments</Label>
            {FEEDBACK_SENTIMENTS.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoTriggerOn.includes(value)}
                  onChange={() => toggleAutoTrigger(value)}
                  className="accent-purple-500"
                />
                <span className="text-xs">{label}</span>
              </label>
            ))}
          </div>

          {/* Default re-entry node */}
          <FieldGroup label="Default Re-entry Node">
            <Select
              value={reentryNodeId || '__none__'}
              onValueChange={(v) => onChange('default_reentry_node_id', v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">
                  Start from beginning
                </SelectItem>
                {reentryNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id} className="text-xs">
                    {(n.data?.label as string) || n.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Node to restart from when feedback triggers a re-run. Overridable per sentiment below.
            </p>
          </FieldGroup>

          {/* Per-sentiment re-entry rules */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Conditional Re-entry Rules</Label>
            {FEEDBACK_SENTIMENTS.filter(({ value }) => autoTriggerOn.includes(value)).map(({ value, label }) => (
              <div key={value} className="rounded-md border border-border p-2.5 space-y-1">
                <p className="text-xs font-medium">{label}</p>
                <Select
                  value={getReentryRule(value) || '__default__'}
                  onValueChange={(v) => updateReentryRule(value, v === '__default__' ? '' : v)}
                >
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__" className="text-xs text-muted-foreground">
                      Use default re-entry node
                    </SelectItem>
                    {reentryNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id} className="text-xs">
                        {(n.data?.label as string) || n.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {autoTriggerOn.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic">
                Select sentiments above to configure per-sentiment rules.
              </p>
            )}
          </div>

          {/* Max auto-retries */}
          <FieldGroup label="Max Auto-retries">
            <Input
              type="number"
              min={1}
              max={20}
              className="h-8 text-xs"
              value={maxAutoRetries}
              onChange={(e) => onChange('max_auto_retries', parseInt(e.target.value) || 3)}
            />
            <p className="text-[11px] text-muted-foreground">
              After this many re-runs the workflow escalates to human review.
            </p>
          </FieldGroup>
        </>
      )}

      {/* Manual entry form */}
      {triggerMode === 'manual' && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Manual feedback to inject when this node is reached during a run.
          </p>

          {/* Sentiment */}
          <FieldGroup label="Sentiment">
            <Select
              value={manualFeedback.decision}
              onValueChange={(v) => onChange('manual_feedback', { ...manualFeedback, decision: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEEDBACK_SENTIMENTS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>

          {/* Star rating */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Star Rating</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => onChange('manual_feedback', { ...manualFeedback, star_rating: star })}
                  className={cn(
                    'text-lg transition-colors',
                    star <= manualFeedback.star_rating ? 'text-amber-400' : 'text-muted-foreground/30',
                  )}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {/* Tone */}
          <FieldGroup label="Tone">
            <Select
              value={manualFeedback.tone_feedback || '__none__'}
              onValueChange={(v) =>
                onChange('manual_feedback', { ...manualFeedback, tone_feedback: v === '__none__' ? '' : v })
              }
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs text-muted-foreground">Not specified</SelectItem>
                {TONE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>

          {/* Content tags */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Content Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TAG_OPTIONS.map(({ value, label }) => {
                const active = (manualFeedback.content_tags ?? []).includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleContentTag(value)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      active
                        ? 'border-purple-400 bg-purple-50 text-purple-700'
                        : 'border-border text-muted-foreground hover:bg-accent/40',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Comment */}
          <FieldGroup label="Comment">
            <Textarea
              className="min-h-[80px] text-xs"
              placeholder="Optional feedback comment…"
              value={manualFeedback.comment}
              onChange={(e) => onChange('manual_feedback', { ...manualFeedback, comment: e.target.value })}
            />
          </FieldGroup>
        </>
      )}
    </>
  )
}
