import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { useWorkflowStore } from '@/store/workflowStore'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { pollRunUntilTerminal } from './TopBar'

import { FieldGroup } from './config/shared'

import { DocumentSourceConfig } from './config/source/DocumentSourceConfig'
import { TextInputConfig } from './config/source/TextInputConfig'
import { ApiFetchConfig } from './config/source/ApiFetchConfig'
import { WebScrapeConfig } from './config/source/WebScrapeConfig'
import { TranscriptionConfig } from './config/source/TranscriptionConfig'
import { VideoFrameExtractorConfig } from './config/source/VideoFrameExtractorConfig'
import { VideoUploadConfig } from './config/source/VideoUploadConfig'
import { InstructionTranslatorConfig } from './config/source/InstructionTranslatorConfig'
import { WorkflowOutputConfig } from './config/source/WorkflowOutputConfig'
import { GtmFrameworkConfig } from './config/source/GtmFrameworkConfig'
import { BrandContextConfig } from './config/source/BrandContextConfig'
import { ClientBrainConfig } from './config/source/ClientBrainConfig'
import { DeepWebScrapeConfig } from './config/source/DeepWebScrapeConfig'
import { ReviewMinerConfig } from './config/source/ReviewMinerConfig'
import { SeoIntentConfig } from './config/source/SeoIntentConfig'
import { AudienceSignalConfig } from './config/source/AudienceSignalConfig'
import { WrikeSourceConfig } from './config/source/WrikeSourceConfig'
import { VideoScriptReaderConfig } from './config/source/VideoScriptReaderConfig'
import { DocxReaderConfig } from './config/source/DocxReaderConfig'

import { AiGenerateConfig } from './config/logic/AiGenerateConfig'
import { TransformConfig } from './config/logic/TransformConfig'
import { ConditionConfig } from './config/logic/ConditionConfig'
import { HumanReviewConfig } from './config/logic/HumanReviewConfig'
import { HumanizerConfig } from './config/logic/HumanizerConfig'
import { HumanizerProConfig } from './config/logic/HumanizerProConfig'
import { DetectionConfig } from './config/logic/DetectionConfig'
import { ConditionalBranchConfig } from './config/logic/ConditionalBranchConfig'
import { TranslateConfig } from './config/logic/TranslateConfig'
import { QualityReviewConfig } from './config/logic/QualityReviewConfig'
import { SeoReviewConfig } from './config/logic/SeoReviewConfig'
import { GeoReviewConfig } from './config/logic/GeoReviewConfig'
import { ImagePromptBuilderConfig } from './config/logic/ImagePromptBuilderConfig'
import { VideoPromptBuilderConfig } from './config/logic/VideoPromptBuilderConfig'
import { VideoTranscriptionConfig } from './config/logic/VideoTranscriptionConfig'
import { VideoIntelligenceConfig } from './config/logic/VideoIntelligenceConfig'
import { ImageResizeConfig } from './config/logic/ImageResizeConfig'
import { StoryboardFrameGenConfig } from './config/logic/StoryboardFrameGenConfig'

import { WebhookConfig } from './config/output/WebhookConfig'
import { EmailConfig } from './config/output/EmailConfig'
import { HtmlPageConfig } from './config/output/HtmlPageConfig'
import { FileExportConfig, FileExportOutput } from './config/output/FileExportConfig'
import { ContentOutputConfig, DisplayNodeOutput } from './config/output/ContentOutputConfig'
import { ClientFeedbackConfig } from './config/output/ClientFeedbackConfig'
import { ImageGenerationConfig } from './config/output/ImageGenerationConfig'
import { VideoGenerationConfig } from './config/output/VideoGenerationConfig'
import { MediaDownloadConfig } from './config/output/MediaDownloadConfig'

import { InsightNodeConfig } from './config/insight/InsightNodeConfig'
import { VoiceOutputConfig } from './config/output/VoiceOutputConfig'
import { MusicGenerationConfig } from './config/output/MusicGenerationConfig'
import { AudioMixConfig } from './config/output/AudioMixConfig'
import { AudioInputConfig } from './config/source/AudioInputConfig'
import { CharacterAnimationConfig } from './config/output/CharacterAnimationConfig'
import { VideoCompositionConfig } from './config/output/VideoCompositionConfig'
import { VideoTrimmerConfig } from './config/output/VideoTrimmerConfig'
import { VideoResizeConfig } from './config/output/VideoResizeConfig'
import { AudioReplaceConfig } from './config/output/AudioReplaceConfig'


// ─── Config dispatcher ────────────────────────────────────────────────────────

function NodeConfigForm({
  nodeType,
  subtype,
  config,
  onChange,
  workflowModel,
  nodeRunStatus,
  nodeId,
  nodeLabel,
}: {
  nodeType: string
  subtype: string
  config: Record<string, unknown>
  onChange: (k: string, v: unknown) => void
  workflowModel: { provider: string; model: string; temperature?: number }
  nodeRunStatus?: { status?: string; output?: unknown; warning?: string; paused?: boolean; wordsProcessed?: number; startedAt?: string; error?: string }
  nodeId: string
  nodeLabel: string
}) {
  switch (nodeType) {
    case 'gtm_framework':
      return <GtmFrameworkConfig config={config} onChange={onChange} />
    case 'brand_context':
      return <BrandContextConfig config={config} onChange={onChange} />
    case 'client_brain':
      return <ClientBrainConfig config={config} onChange={onChange} />
    case 'wrike_source':
      return <WrikeSourceConfig config={config} onChange={onChange} />
    case 'deep_web_scrape':
      return <DeepWebScrapeConfig config={config} onChange={onChange} />
    case 'review_miner':
      return <ReviewMinerConfig config={config} onChange={onChange} />
    case 'seo_intent':
      return <SeoIntentConfig config={config} onChange={onChange} />
    case 'audience_signal':
      return <AudienceSignalConfig config={config} onChange={onChange} />
    case 'source':
      if (subtype === 'transcription')
        return <TranscriptionConfig config={config} onChange={onChange} />
      if (subtype === 'video-frame-extractor')
        return <VideoFrameExtractorConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'video-upload')
        return <VideoUploadConfig config={config} onChange={onChange} />
      if (subtype === 'text-input')
        return <TextInputConfig config={config} onChange={onChange} />
      if (subtype === 'docx-reader')
        return <DocxReaderConfig config={config} onChange={onChange} />
      if (subtype === 'video-script-reader')
        return <VideoScriptReaderConfig config={config} onChange={onChange} />
      if (subtype === 'api-fetch')
        return <ApiFetchConfig config={config} onChange={onChange} />
      if (subtype === 'web-scrape')
        return <WebScrapeConfig config={config} onChange={onChange} />
      if (subtype === 'instruction-translator')
        return <InstructionTranslatorConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} nodeId={nodeId} />
      if (subtype === 'workflow-output')
        return <WorkflowOutputConfig config={config} onChange={onChange} />
      return <DocumentSourceConfig config={config} onChange={onChange} />
    case 'logic':
      if (subtype === 'humanizer-pro')
        return <HumanizerProConfig config={config} onChange={onChange} />
      if (subtype === 'humanizer')
        return <HumanizerConfig config={config} onChange={onChange} workflowModel={workflowModel} />
      if (subtype === 'detection')
        return <DetectionConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'conditional-branch')
        return <ConditionalBranchConfig config={config} onChange={onChange} />
      if (subtype === 'human-review')
        return <HumanReviewConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'translate')
        return <TranslateConfig config={config} onChange={onChange} />
      if (subtype === 'quality-review')
        return <QualityReviewConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'seo-review')
        return <SeoReviewConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'geo-review')
        return <GeoReviewConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'image-prompt-builder')
        return <ImagePromptBuilderConfig config={config} onChange={onChange} />
      if (subtype === 'video-prompt-builder')
        return <VideoPromptBuilderConfig config={config} onChange={onChange} />
      if (subtype === 'video-frame-extractor')
        return <VideoFrameExtractorConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'video-transcription')
        return <VideoTranscriptionConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'video-intelligence')
        return <VideoIntelligenceConfig config={config} onChange={onChange} />
      if (subtype === 'image-resize')
        return <ImageResizeConfig config={config} onChange={onChange} />
      if (subtype === 'storyboard-frame-gen')
        return <StoryboardFrameGenConfig config={config} onChange={onChange} />
      if (subtype === 'video-trimmer')
        return <VideoTrimmerConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'video-resize')
        return <VideoResizeConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'transform')
        return <TransformConfig config={config} onChange={onChange} />
      if (subtype === 'condition')
        return <ConditionConfig config={config} onChange={onChange} />
      return <AiGenerateConfig config={config} onChange={onChange} workflowModel={workflowModel} nodeRunStatus={nodeRunStatus} />
    case 'output':
      if (subtype === 'media-download')
        return <MediaDownloadConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
      if (subtype === 'image-generation')
        return <ImageGenerationConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} nodeLabel={nodeLabel} />
      if (subtype === 'video-generation')
        return <VideoGenerationConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} nodeLabel={nodeLabel} />
      if (subtype === 'html-page')
        return <HtmlPageConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} nodeId={nodeId} />
      if (subtype === 'client-feedback')
        return <ClientFeedbackConfig config={config} onChange={onChange} />
      if (subtype === 'email')
        return <EmailConfig config={config} onChange={onChange} />
      if (subtype === 'webhook')
        return <WebhookConfig config={config} onChange={onChange} />
      if (subtype === 'display')
        return (
          <>
            <DisplayNodeOutput nodeRunStatus={nodeRunStatus} />
            <Separator />
            <ContentOutputConfig config={config} onChange={onChange} />
          </>
        )
      if (subtype === 'file-export')
        return (
          <>
            <FileExportOutput nodeRunStatus={nodeRunStatus} config={config} />
            <Separator />
            <FileExportConfig config={config} onChange={onChange} />
          </>
        )
      // content-output also shows run output (same as display)
      return (
        <>
          <DisplayNodeOutput nodeRunStatus={nodeRunStatus} />
          <Separator />
          <ContentOutputConfig config={config} onChange={onChange} />
        </>
      )
    case 'insight':
      return <InsightNodeConfig config={config} />
    case 'voice_output':
      return <VoiceOutputConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
    case 'music_generation':
      return <MusicGenerationConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
    case 'audio_mix':
      return <AudioMixConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
    case 'audio_input':
      return <AudioInputConfig config={config} onChange={onChange} />
    case 'audio_replace':
      return <AudioReplaceConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
    case 'character_animation':
      return <CharacterAnimationConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
    case 'video_composition':
      return <VideoCompositionConfig config={config} onChange={onChange} nodeRunStatus={nodeRunStatus} />
    default:
      return <p className="text-xs text-muted-foreground">No configuration for this node type.</p>
  }
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ConfigPanel() {
  const { selectedNodeId, nodes, updateNodeData, workflow, nodeRunStatuses, runStatus, activeRunId } = useWorkflowStore()
  const node = nodes.find((n) => n.id === selectedNodeId)
  const [rerunning, setRerunning] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const [localLabel, setLocalLabel] = useState('')

  useEffect(() => {
    if (node) setLocalLabel(node.data.label as string)
  }, [node?.id])

  if (!node) {
    return (
      <div className="relative flex h-full w-[320px] shrink-0 flex-col overflow-hidden border-l border-border bg-card" onWheel={(e) => e.stopPropagation()}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border">
            <Icons.MousePointerClick className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">No node selected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click a node on the canvas to configure it
            </p>
          </div>
        </div>
      </div>
    )
  }

  const nodeType = node.type ?? ''
  const subtype = node.data.subtype as string
  const config = (node.data.config as Record<string, unknown>) ?? {}

  const onConfigChange = (key: string, value: unknown) => {
    const currentConfig = (useWorkflowStore.getState().nodes.find(n => n.id === node.id)?.data?.config as Record<string, unknown>) ?? {}
    updateNodeData(node.id, { config: { ...currentConfig, [key]: value } })
    // Persist file bindings to client-scoped store when files change
    if (key === 'uploaded_files' || key === 'audio_files') {
      const { workflow } = useWorkflowStore.getState()
      if (workflow.id) {
        apiFetch(`/api/v1/workflows/${workflow.id}/files/${node.id}`, {
          method: 'PUT',
          body: JSON.stringify({ clientId: workflow.clientId ?? '', files: { [key]: value } }),
        }).catch(() => {})
      }
    }
  }

  const CATEGORY_COLOR: Record<string, string> = {
    source: 'text-emerald-400',
    logic: 'text-blue-400',
    review: 'text-cyan-500',
    output: 'text-purple-400',
    insight: 'text-yellow-400',
    gtm_framework:    'text-blue-500',
    client_brain:     'text-orange-500',
    deep_web_scrape:  'text-cyan-400',
    review_miner:     'text-rose-400',
    seo_intent:       'text-violet-400',
    audience_signal:  'text-teal-400',
    wrike_source:     'text-blue-500',
  }
  const colorClass = CATEGORY_COLOR[nodeType] ?? 'text-foreground'

  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-card transition-[width] duration-200"
      style={{ width: expanded ? 600 : 320 }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Left-edge expand/collapse handle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="absolute left-0 top-[40%] z-10 -translate-y-1/2 flex h-12 w-3 items-center justify-center rounded-r-sm border border-l-0 border-border bg-card hover:bg-muted transition-colors"
        title={expanded ? 'Collapse panel' : 'Expand panel'}
      >
        {expanded
          ? <Icons.ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
          : <Icons.ChevronLeft className="h-2.5 w-2.5 text-muted-foreground" />}
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Icons.Settings2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Node Config</span>
        <button
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={() => useWorkflowStore.getState().setSelectedNodeId(null)}
        >
          <Icons.X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="w-full min-w-0 space-y-4 px-3 py-3">
          {/* Node identity */}
          <div className="space-y-3">
            <FieldGroup label="Node Label">
              <Input
                className="text-xs"
                value={localLabel}
                onChange={(e) => setLocalLabel(e.target.value)}
                onBlur={() => updateNodeData(node.id, { label: localLabel })}
              />
            </FieldGroup>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Type:</span>
              <span className={cn('text-xs font-medium capitalize', colorClass)}>
                {node.type} / {subtype}
              </span>
            </div>
          </div>

          <Separator />

          {/* Type-specific config */}
          <NodeConfigForm
            nodeType={nodeType}
            subtype={subtype}
            config={config}
            onChange={onConfigChange}
            workflowModel={workflow.default_model_config}
            nodeRunStatus={nodeRunStatuses[node.id]}
            nodeId={node.id}
            nodeLabel={node.data.label as string}
          />
        </div>
      </ScrollArea>

      {/* Node error banner */}
      {nodeRunStatuses[node.id]?.status === 'failed' && nodeRunStatuses[node.id]?.error && (
        <div className="mx-3 mb-1 rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[11px] font-medium text-red-700 mb-1 flex items-center gap-1">
            <Icons.XCircle className="h-3.5 w-3.5 shrink-0" />
            Node failed
          </p>
          <p className="text-[11px] text-red-800 font-mono break-words whitespace-pre-wrap leading-relaxed">
            {nodeRunStatuses[node.id]?.error as string}
          </p>
        </div>
      )}

      {/* Footer: re-run from here + delete */}
      <div className="border-t border-border px-3 py-2 space-y-1.5">
        {/* Re-run from here — only when run is done and this node passed */}
        {(runStatus === 'completed' || runStatus === 'failed') &&
          (nodeRunStatuses[node.id]?.status === 'passed' || nodeRunStatuses[node.id]?.status === 'failed') &&
          activeRunId && (
            <Button
              variant="outline"
              size="sm"
              disabled={rerunning}
              className="w-full text-xs text-blue-700 border-blue-300 hover:bg-blue-50 hover:text-blue-800"
              onClick={async () => {
                const store = useWorkflowStore.getState()
                setRerunning(true)
                setRerunError(null)
                try {
                  const res = await apiFetch(`/api/v1/runs/${activeRunId}/rerun-from/${node.id}`, {
                    method: 'POST',
                    body: JSON.stringify({}),
                  })
                  if (!res.ok) {
                    const text = await res.text()
                    setRerunError(`${res.status}: ${text}`)
                    return
                  }
                  const body = await res.json() as { runId?: string }
                  if (!body.runId) {
                    setRerunError('No runId in response')
                    return
                  }
                  store.setActiveRunId(body.runId)
                  store.setRunStatus('running')
                  store.setNodeRunStatuses(
                    Object.fromEntries(
                      Object.entries(store.nodeRunStatuses).map(([k, v]) =>
                        k === node.id || !v.status || v.status === 'idle' ? [k, { ...v, status: 'idle' as const }] : [k, v]
                      )
                    )
                  )
                  await pollRunUntilTerminal(body.runId)
                } catch (err) {
                  setRerunError(err instanceof Error ? err.message : String(err))
                } finally {
                  setRerunning(false)
                }
              }}
            >
              {rerunning
                ? <><Icons.Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Starting…</>
                : nodeRunStatuses[node.id]?.status === 'failed'
                  ? <><Icons.RotateCcw className="mr-2 h-3.5 w-3.5" />Retry from here</>
                  : <><Icons.RotateCcw className="mr-2 h-3.5 w-3.5" />Re-run from here</>
              }
            </Button>
          )}
          {rerunError && (
            <p className="text-[10px] text-red-400 break-words">{rerunError}</p>
          )}

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            useWorkflowStore.getState().onNodesChange([{ type: 'remove', id: node.id }])
            useWorkflowStore.getState().setSelectedNodeId(null)
          }}
        >
          <Icons.Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete Node
        </Button>
      </div>
    </div>
  )
}
