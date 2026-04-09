import { useState } from 'react'
import * as Icons from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export interface InsightData {
  id: string
  type: string
  title: string
  body: string
  confidence: number | null
  status: string
  instanceCount: number
  stakeholderIds: string[]
  isCollective: boolean
  evidenceQuotes: Array<{
    text: string
    stakeholderId: string
    stakeholderName: string
    runId: string | null
  }>
  suggestedNodeType: string | null
  suggestedConfigChange: Record<string, unknown>
  client: { id: string; name: string; slug: string }
}

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  tone:          { icon: 'MessageSquare', label: 'Tone',         color: 'text-blue-600' },
  forbidden_term:{ icon: 'Ban',           label: 'Forbidden Term',color: 'text-red-600' },
  structure:     { icon: 'LayoutList',    label: 'Structure',    color: 'text-purple-600' },
  length:        { icon: 'Ruler',         label: 'Length',       color: 'text-orange-600' },
  claims:        { icon: 'Quote',         label: 'Claims',       color: 'text-green-600' },
  theme:         { icon: 'Tag',           label: 'Theme',        color: 'text-yellow-600' },
  action_item:   { icon: 'CheckSquare',   label: 'Action Item',  color: 'text-teal-600' },
  sentiment:     { icon: 'Heart',         label: 'Sentiment',    color: 'text-pink-600' },
}

const NODE_TYPE_LABELS: Record<string, string> = {
  'logic:humanizer':       'Humanizer',
  'output:content-output': 'Content Output',
  'logic:ai-generate':     'AI Generate',
  'logic':                 'Logic',
  'output':                'Output',
}

export function InsightCard({ insight }: { insight: InsightData }) {
  const [showEvidence, setShowEvidence] = useState(false)
  const confidence = insight.confidence ?? 0
  const pct = Math.round(confidence * 100)
  const meta = TYPE_META[insight.type] ?? { icon: 'Lightbulb', label: insight.type, color: 'text-yellow-600' }
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[meta.icon] ?? Icons.Lightbulb

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/contentnode-insight', JSON.stringify({
      insightId: insight.id,
      type: insight.type,
      title: insight.title,
      confidence: insight.confidence,
      isCollective: insight.isCollective,
      suggestedNodeType: insight.suggestedNodeType,
      suggestedConfigChange: insight.suggestedConfigChange,
      body: insight.body,
    }))
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'rounded-lg border p-3 space-y-2 cursor-grab active:cursor-grabbing transition-colors hover:bg-accent/40',
        confidence > 0.6
          ? 'border-yellow-300 bg-yellow-50/60'
          : 'border-border bg-card',
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5 shrink-0', meta.color)}>
          <IconComp className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-tight">{insight.title}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 text-muted-foreground">
              {meta.label}
            </Badge>
            {insight.isCollective && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 text-blue-600 border-blue-300">
                Collective
              </Badge>
            )}
            {insight.suggestedNodeType && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 text-yellow-600 border-yellow-300">
                → {NODE_TYPE_LABELS[insight.suggestedNodeType] ?? insight.suggestedNodeType}
              </Badge>
            )}
          </div>
        </div>

        {/* Confidence badge */}
        <div className={cn(
          'shrink-0 text-xs font-medium tabular-nums ml-auto',
          confidence >= 0.6 ? 'text-yellow-600' : 'text-muted-foreground'
        )}>
          {pct}%
          {confidence > 0.6 && (
            <span className="inline-block ml-1 h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse align-middle" />
          )}
        </div>
      </div>

      {/* Instance count */}
      <p className="text-xs text-muted-foreground">
        {insight.instanceCount} instance{insight.instanceCount !== 1 ? 's' : ''} from{' '}
        {insight.stakeholderIds.length} stakeholder{insight.stakeholderIds.length !== 1 ? 's' : ''}
      </p>

      {/* Evidence quotes toggle */}
      {insight.evidenceQuotes.length > 0 && (
        <div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowEvidence((v) => !v) }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icons.ChevronRight className={cn('h-3 w-3 transition-transform', showEvidence && 'rotate-90')} />
            {showEvidence ? 'Hide' : 'Show'} evidence
          </button>

          {showEvidence && (
            <div className="mt-1.5 space-y-1.5">
              {insight.evidenceQuotes.map((q, i) => (
                <div key={i} className="rounded border border-border bg-muted/30 px-2 py-1.5">
                  <p className="text-xs text-muted-foreground italic">"{q.text}"</p>
                  <p className="text-xs text-muted-foreground mt-0.5">— {q.stakeholderName}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drag hint */}
      <p className="text-xs text-muted-foreground/60">Drag onto canvas to apply</p>
    </div>
  )
}
