import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { InsightCard, type InsightData } from './InsightCard'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export function InsightsSidebar() {
  const [insights, setInsights] = useState<InsightData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/v1/insights?status=pending`)
      if (res.ok) {
        const json = await res.json()
        setInsights(json.data ?? [])
      } else {
        setInsights([])
      }
    } catch {
      setError('Could not load insights')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  // Group by client
  const byClient = new Map<string, InsightData[]>()
  for (const insight of insights) {
    const list = byClient.get(insight.client.id) ?? []
    list.push(insight)
    byClient.set(insight.client.id, list)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-medium flex-1">Pending Insights</span>
        {insights.length > 0 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500/20 text-xs font-medium text-yellow-400">
            {insights.length}
          </span>
        )}
        <button
          onClick={() => void load()}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh insights"
        >
          <Icons.RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-3 py-3 space-y-4">
          {loading && insights.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Icons.Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400 text-center py-4">{error}</p>
          )}

          {!loading && !error && insights.length === 0 && (
            <div className="py-8 text-center space-y-2">
              <Icons.Lightbulb className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No pending insights yet.</p>
              <p className="text-xs text-muted-foreground/60">
                Insights appear after stakeholders submit feedback.
              </p>
            </div>
          )}

          {[...byClient.entries()].map(([, clientInsights]) => {
            const client = clientInsights[0].client
            return (
              <div key={client.id}>
                <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {client.name}
                </p>
                <div className="space-y-2">
                  {clientInsights.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <div className="border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">Drag insights onto the canvas</p>
      </div>
    </div>
  )
}
