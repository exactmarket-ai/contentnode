import { create } from 'zustand'
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow'
import type { Node, Edge, NodeChange, EdgeChange, Connection, Viewport, ReactFlowInstance } from 'reactflow'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectivityMode = 'online' | 'offline'
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_assignment' | 'waiting_review'

export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'ollama'
  model: string
  temperature?: number
  max_tokens?: number
}

export interface WorkflowMeta {
  id: string | null
  name: string
  clientId: string | null
  clientName: string | null
  /** Locked after first run — never change after that */
  connectivity_mode: ConnectivityMode
  default_model_config: ModelConfig
  /** Default assignee for runs created from this workflow */
  defaultAssigneeId?: string | null
  defaultAssigneeName?: string | null
  /** True when the workflow was auto-created by the run engine, not explicitly saved by the user */
  autoCreated?: boolean
  /** True once the graph has been explicitly saved (PUT /graph). False for brand-new unsaved workflows. */
  graphSaved?: boolean
  /** When true: nodes cannot be moved, added, deleted, or reconnected. Node configs remain editable. */
  isLocked?: boolean
  /** True when this workflow is saved as an org-level template */
  isTemplate?: boolean
  templateCategory?: string | null
  templateDescription?: string | null
  /** PM routing — Monday group this workflow's runs go into */
  mondayGroupId?: string | null
  mondayGroupName?: string | null
  /** PM routing — Monday subitem selected for this run */
  mondaySubItemId?: string | null
  mondaySubItemName?: string | null
  mondaySubItemBoardId?: string | null
  /** PM routing — Box project folder to create run subfolders inside */
  boxProjectFolderId?: string | null
  /** PM routing — Google Drive project folder to create run subfolders inside */
  googleDriveProjectFolderId?: string | null
  /** Client-level PM connections (read from client record, not editable here) */
  clientMondayBoardId?: string | null
  clientBoxFolderId?: string | null
  clientGoogleDriveFolderId?: string | null
}

export interface NodeRunStatus {
  status: 'idle' | 'running' | 'passed' | 'failed' | 'skipped'
  output?: unknown
  error?: string
  tokensUsed?: number
  modelUsed?: string
  warning?: string
  paused?: boolean
  wordsProcessed?: number
  startedAt?: string
  completedAt?: string
}

// ─── Node palette definition (used by NodePalette + node factories) ───────────

export type NodeCategory = 'source' | 'logic' | 'output' | 'media' | 'video' | 'insight' | 'canvas' | 'review'

export interface PaletteNodeDef {
  type: string         // matches executor registry key prefix
  subtype: string      // specific node variant, stored in node.data.subtype
  label: string
  description: string
  category: NodeCategory
  icon: string         // lucide icon name
  defaultConfig: Record<string, unknown>
  /**
   * When true, this node requires a human to provide data at runtime
   * (file upload, typed text, speaker assignment, stakeholder feedback, etc.).
   * "Run to here" is suppressed for these nodes.
   * New node types MUST set this explicitly if they block on human input.
   */
  requiresManualInput?: boolean
}

/**
 * Subtypes that work without any internet connection.
 * When a workflow's connectivity_mode is 'offline', only these nodes are
 * shown in the palette and droppable on the canvas.
 *
 * Rules:
 *  - ai-generate: restricted to Ollama provider (enforced in AiGenerateConfig)
 *  - detection:   restricted to local service  (enforced in DetectionConfig)
 */
export const OFFLINE_COMPATIBLE_SUBTYPES = new Set([
  // Source — DB reads or local file input
  'text-input', 'file-upload', 'workflow-output',
  'client-brain', 'gtm-framework', 'brand-context',
  // Logic — local processing or local AI
  'ai-generate', 'transform', 'condition', 'merge', 'human-review',
  'detection', 'conditional-branch',
  // Output — local rendering
  'file-export', 'display', 'content-output',
  // Canvas utility
  'group',
])

export const PALETTE_NODES: PaletteNodeDef[] = [
  // Source
  {
    type: 'source', subtype: 'text-input',
    label: 'Text Input', description: 'Static text or template literal',
    category: 'source', icon: 'Type',
    defaultConfig: { text: '' },
    requiresManualInput: true,
  },
  {
    type: 'source', subtype: 'file-upload',
    label: 'File Upload', description: 'Upload a document or image',
    category: 'source', icon: 'Upload',
    defaultConfig: { accept: '*', maxSizeMb: 10 },
    requiresManualInput: true,
  },
  {
    type: 'source', subtype: 'api-fetch',
    label: 'API Fetch', description: 'Fetch data from an HTTP endpoint',
    category: 'source', icon: 'Globe',
    defaultConfig: { url: '', method: 'GET', headers: {} },
  },
  {
    type: 'source', subtype: 'web-scrape',
    label: 'Web Scrape', description: 'Scrape content from a webpage',
    category: 'source', icon: 'Scan',
    defaultConfig: { url: '', selector: '' },
  },
  {
    type: 'source', subtype: 'instruction-translator',
    label: 'Instruction Translator', description: 'Parse a brief or notes into a structured instruction object',
    category: 'source', icon: 'FileSearch',
    defaultConfig: { subtype: 'instruction-translator', raw_text: '', parsed: null },
  },
  {
    type: 'source', subtype: 'workflow-output',
    label: 'Workflow Output', description: 'Reference output from a previous workflow run',
    category: 'source', icon: 'GitBranch',
    defaultConfig: { subtype: 'workflow-output', fallbackToLatest: true },
  },
  {
    type: 'client_brain', subtype: 'client-brain',
    label: 'Client Brain', description: 'Pull any combination of GTM, Demand Gen, and Brand sections into a workflow — the foundational context node',
    category: 'source', icon: 'Brain',
    defaultConfig: { subtype: 'client-brain', verticalId: '', verticalName: '', clientName: '', gtmSections: ['02','08'], dgBaseSections: ['B1','B2'], dgVertSections: ['S2','S3'], includeBrand: true },
  },
  {
    type: 'gtm_framework', subtype: 'gtm-framework',
    label: 'GTM Framework', description: 'Inject selected GTM framework sections as workflow context',
    category: 'source', icon: 'Target',
    defaultConfig: { subtype: 'gtm-framework', verticalId: '', verticalName: '', sections: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18'] },
  },
  {
    type: 'brand_context', subtype: 'brand-context',
    label: 'Brand Context', description: 'Inject client brand profile and voice guidelines into downstream nodes',
    category: 'source', icon: 'Fingerprint',
    defaultConfig: { subtype: 'brand-context', clientId: '', clientName: '', verticalId: '', verticalName: '', dataSource: 'both' },
  },
  // Phase 3 — Intelligence Tools
  {
    type: 'deep_web_scrape', subtype: 'deep-web-scrape',
    label: 'Deep Web Scrape', description: 'Multi-page web crawler — follows links, synthesizes content into structured intelligence',
    category: 'source', icon: 'SearchCode',
    defaultConfig: { subtype: 'deep-web-scrape', seedUrls: '', maxPages: 10, linkPattern: '', stayOnDomain: true, synthesisTarget: 'summary', synthesisInstructions: '' },
  },
  {
    type: 'review_miner', subtype: 'review-miner',
    label: 'Review Miner', description: 'Scrape Trustpilot, G2, and Capterra — extract themes, objections, and battlecard data from reviews',
    category: 'source', icon: 'MessageSquareQuote',
    defaultConfig: { subtype: 'review-miner', companyName: '', companySlug: '', platforms: ['trustpilot'], competitors: '', maxReviewsPerSource: 20, synthesisType: 'themes' },
  },
  {
    type: 'seo_intent', subtype: 'seo-intent',
    label: 'SEO Intent Tool', description: 'Expand keywords and classify by search intent — map to funnel stages for content planning',
    category: 'source', icon: 'TrendingUp',
    defaultConfig: { subtype: 'seo-intent', topic: '', seedKeywords: '', expandCount: 30, dataSource: 'claude', apiKeyRef: '', funnelMapping: true },
  },
  {
    type: 'audience_signal', subtype: 'audience-signal',
    label: 'Audience Signal Scraper', description: 'Mine Reddit for real audience language — pain points, vocabulary, objections, and questions',
    category: 'source', icon: 'Users',
    defaultConfig: { subtype: 'audience-signal', searchTerms: '', subreddits: '', maxPosts: 25, minUpvotes: 5, synthesisGoal: 'all' },
  },
  {
    type: 'wrike_source', subtype: 'wrike-source',
    label: 'Wrike Tasks', description: 'Pull recently completed Wrike tasks and synthesize into campaign-ready content',
    category: 'source', icon: 'CheckSquare',
    defaultConfig: { subtype: 'wrike-source', days_back: 14, synthesis: 'summary' },
  },
  {
    type: 'keyword_research', subtype: 'keyword-research',
    label: 'Keyword Research', description: 'Generate a keyword map from a topic or seed keyword',
    category: 'source', icon: 'TrendingUp',
    defaultConfig: { subtype: 'keyword-research', seedTopic: '', targetAudience: '', funnelStages: ['all'], outputVolume: 'focused', includeIntentLabels: true },
  },
  // Video Storyboard pipeline
  {
    type: 'source', subtype: 'docx-reader',
    label: 'DOCX Reader', description: 'Upload a .docx or .txt file and extract its plain text for downstream processing',
    category: 'source', icon: 'FileText',
    defaultConfig: { subtype: 'docx-reader', storageKey: '' },
  },
  {
    type: 'logic', subtype: 'storyboard-scene-parser',
    label: 'Scene Parser (AI)', description: 'Use Claude to extract structured scenes from any plain-text video script',
    category: 'media', icon: 'ListOrdered',
    defaultConfig: { subtype: 'storyboard-scene-parser' },
  },
  {
    type: 'logic', subtype: 'storyboard-image-prompt-builder',
    label: 'Image Prompt Builder', description: 'Generate per-scene image generation prompts tailored to your brand',
    category: 'media', icon: 'Wand2',
    defaultConfig: { subtype: 'storyboard-image-prompt-builder', clientName: '', verticalName: '', brandStyle: '' },
  },
  {
    type: 'source', subtype: 'video-script-reader',
    label: 'Video Script Reader', description: 'Load a video script from a GTM Kit session or upstream text input',
    category: 'source', icon: 'FileVideo',
    defaultConfig: { subtype: 'video-script-reader', source: 'passthrough', kitSessionId: '', assetIndex: 5 },
  },
  {
    type: 'logic', subtype: 'scene-parser',
    label: 'Scene Parser', description: 'Parse a video script markdown table into structured scene objects',
    category: 'media', icon: 'ListOrdered',
    defaultConfig: { subtype: 'scene-parser' },
  },
  {
    type: 'logic', subtype: 'storyboard-frame-gen',
    label: 'Frame Generator', description: 'Generate AI images for every scene using GPT Image 2 (1–4 frames per scene)',
    category: 'media', icon: 'Image',
    defaultConfig: { subtype: 'storyboard-frame-gen', framesPerScene: 1, clientName: '', verticalName: '' },
  },
  {
    type: 'output', subtype: 'storyboard-pdf-builder',
    label: 'Storyboard PDF', description: 'Render all scenes to a branded PDF storyboard and upload to storage',
    category: 'output', icon: 'BookMarked',
    defaultConfig: { subtype: 'storyboard-pdf-builder', clientName: '', verticalName: '', version: 'v1', filename: '' },
  },
  {
    type: 'logic', subtype: 'frames-config',
    label: 'Frames Config', description: 'Set how many storyboard frames to generate per scene (1–4) — legacy node',
    category: 'media', icon: 'LayoutGrid',
    defaultConfig: { subtype: 'frames-config', framesPerScene: 1 },
  },
  {
    type: 'logic', subtype: 'storyboard-composer',
    label: 'Storyboard Composer', description: 'Render a single storyboard page to PDF — use Storyboard PDF for full pipelines',
    category: 'media', icon: 'PanelLeft',
    defaultConfig: { subtype: 'storyboard-composer', clientName: '', verticalName: '' },
  },
  {
    type: 'output', subtype: 'pdf-assembler',
    label: 'PDF Assembler', description: 'Combine individual PDF page buffers into one file — use Storyboard PDF for full pipelines',
    category: 'media', icon: 'FileText',
    defaultConfig: { subtype: 'pdf-assembler', filename: '' },
  },
  {
    type: 'audio_input', subtype: 'audio-input',
    label: 'Audio Input', description: 'Upload an existing audio file to use as a source in your workflow',
    category: 'source', icon: 'FileAudio',
    defaultConfig: { subtype: 'audio-input' },
  },
  // Logic
  {
    type: 'logic', subtype: 'ai-generate',
    label: 'AI Generate', description: 'Generate content with an AI model',
    category: 'logic', icon: 'Sparkles',
    defaultConfig: { prompt: '', model_config: null },
  },
  {
    type: 'logic', subtype: 'transform',
    label: 'Transform', description: 'Reshape or extract data with JavaScript',
    category: 'logic', icon: 'Wand2',
    defaultConfig: { expression: 'return input' },
  },
  {
    type: 'logic', subtype: 'condition',
    label: 'Condition', description: 'Branch on a boolean expression',
    category: 'logic', icon: 'GitBranch',
    defaultConfig: { expression: 'return true' },
  },
  {
    type: 'logic', subtype: 'merge',
    label: 'Merge', description: 'Combine multiple inputs into one',
    category: 'logic', icon: 'Merge',
    defaultConfig: { strategy: 'concat' },
  },
  {
    type: 'logic', subtype: 'human-review',
    label: 'Human Review', description: 'Pause for human approval before continuing',
    category: 'logic', icon: 'UserCheck',
    defaultConfig: { subtype: 'human-review', instructions: '', assignee_email: '' },
    requiresManualInput: true,
  },
  {
    type: 'logic', subtype: 'translate',
    label: 'Translate', description: 'Translate content to another language',
    category: 'logic', icon: 'Languages',
    defaultConfig: {
      subtype: 'translate',
      target_language: 'ES',
      source_language: 'auto',
      provider: 'deepl',
      formality: 'default',
      preserve_formatting: true,
    },
  },
  {
    type: 'logic', subtype: 'video-intelligence',
    label: 'Video Intelligence', description: 'Watch a video with Gemini AI — understand visuals, on-screen text, topics and tone',
    category: 'media', icon: 'Eye',
    defaultConfig: { subtype: 'video-intelligence', model: 'gemini-2.5-flash', prompt: '' },
  },
  {
    type: 'logic', subtype: 'video-prompt-builder',
    label: 'Video Prompt Builder', description: 'Translate a creative brief or image into a structured video generation prompt',
    category: 'media', icon: 'Video',
    defaultConfig: {
      subtype: 'video-prompt-builder',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      duration_hint: undefined,
      camera_motion_hint: '',
      style_hint: '',
    },
  },
  {
    type: 'logic', subtype: 'image-resize',
    label: 'Image Resize', description: 'Resize an image to a social, web, or custom size',
    category: 'media', icon: 'Maximize2',
    defaultConfig: { subtype: 'image-resize', preset: 'instagram-square', fit: 'cover', format: 'same', quality: 85 },
  },
  {
    type: 'logic', subtype: 'image-prompt-builder',
    label: 'Image Prompt Builder', description: 'Translate a creative brief into a structured image generation prompt',
    category: 'media', icon: 'ImageIcon',
    defaultConfig: {
      subtype: 'image-prompt-builder',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      aspect_ratio_override: '',
      style_hint: '',
    },
  },
  {
    type: 'logic', subtype: 'quality-review',
    label: 'Quality Reviewer', description: 'Rate output and suggest prompt/content improvements',
    category: 'review', icon: 'BadgeCheck',
    defaultConfig: {
      subtype: 'quality-review',
      goal: 'Evaluate this content for a marketing director audience. It should be engaging, persuasive, and drive the reader toward a clear call-to-action. Avoid academic or overly technical language. Score based on clarity, audience fit, tone, and whether it ends with a compelling CTA.',
      rubric: '',
      insight_threshold: 7,
      auto_create_insight: true,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    },
  },
  // Detection-Humanization loop
  {
    type: 'logic', subtype: 'humanizer-pro',
    label: 'Humanizer', description: 'Rewrite content using professional humanization services',
    category: 'logic', icon: 'PenLine',
    defaultConfig: {
      subtype: 'humanizer-pro',
      humanizer_service: 'auto',
    },
  },
  {
    type: 'logic', subtype: 'schema-markup',
    label: 'Schema Markup', description: 'Generate JSON-LD schema markup for your content',
    category: 'logic', icon: 'Code2',
    defaultConfig: { subtype: 'schema-markup', schemaType: 'auto', outputFormat: 'json-ld-only', includeOptional: false },
  },
  {
    type: 'logic', subtype: 'repurpose',
    label: 'Repurpose', description: 'Transform one piece of content into multiple formats',
    category: 'logic', icon: 'RefreshCw',
    defaultConfig: { subtype: 'repurpose', targetFormats: ['linkedin_post'], preserveBrandVoice: true, outputAs: 'combined' },
  },
  {
    type: 'logic', subtype: 'fact-checker',
    label: 'Fact Checker', description: 'Verify claims and statistics in your content',
    category: 'logic', icon: 'ShieldCheck',
    defaultConfig: { subtype: 'fact-checker', checkMode: 'claims_statistics', action: 'annotate', sensitivity: 'medium' },
  },
  {
    type: 'logic', subtype: 'internal-link-suggester',
    label: 'Internal Link Suggester', description: 'Identify anchor text opportunities for internal linking',
    category: 'logic', icon: 'Link',
    defaultConfig: { subtype: 'internal-link-suggester', maxSuggestions: 5, style: 'anchor-text-only', pageTypes: ['blog', 'product', 'landing'] },
  },
  {
    type: 'logic', subtype: 'detection',
    label: 'Detection', description: 'Score content for AI detection likelihood',
    category: 'review', icon: 'ScanSearch',
    defaultConfig: {
      subtype: 'detection',
      service: 'gptzero',
      threshold: 20,
      max_retries: 3,
      api_key_ref: '',
    },
  },
  {
    type: 'logic', subtype: 'conditional-branch',
    label: 'Conditional Branch', description: 'Route based on detection score, word count, or retry count',
    category: 'logic', icon: 'GitFork',
    defaultConfig: {
      subtype: 'conditional-branch',
      condition_type: 'detection_score',
      operator: 'above',
      value: 20,
      pass_label: 'pass',
      fail_label: 'fail',
      fallback_humanizer_id: '',
    },
  },
  // SEO / GEO Review gates
  {
    type: 'logic', subtype: 'seo-review',
    label: 'SEO Review', description: 'Score content for SEO quality — injects requirements into generation when Optimize is on',
    category: 'review', icon: 'SearchCheck',
    defaultConfig: {
      subtype: 'seo-review',
      mode: 'optimize',
      threshold: 70,
      below_threshold_action: 'flag',
      show_breakdown: true,
      target_keyword: '',
    },
  },
  {
    type: 'logic', subtype: 'geo-review',
    label: 'GEO Review', description: 'Score content for AI search optimization — injects GEO requirements into generation when Optimize is on',
    category: 'review', icon: 'Bot',
    defaultConfig: {
      subtype: 'geo-review',
      mode: 'optimize',
      threshold: 70,
      below_threshold_action: 'flag',
      show_breakdown: true,
    },
  },
  // Video Upload (source type — uploads a video file and passes the reference downstream)
  {
    type: 'source', subtype: 'video-upload',
    label: 'Video Upload', description: 'Upload a video file — connect to Transcription and/or Video Frame Extractor',
    category: 'source', icon: 'Film',
    defaultConfig: {
      subtype: 'video-upload',
      video_files: [],
    },
    requiresManualInput: true,
  },
  // Video Frame Extractor (logic type — receives video from upstream, extracts thumbnail JPEG)
  {
    type: 'logic', subtype: 'video-frame-extractor',
    label: 'Video Frame Extractor', description: 'Extract a thumbnail frame from an upstream video',
    category: 'media', icon: 'Camera',
    defaultConfig: {
      subtype: 'video-frame-extractor',
      timestamp_mode: 'percent',
      timestamp_value: 50,
    },
  },
  // Transcription (source type — transcribes audio/video; accepts upstream input or direct file upload)
  {
    type: 'source', subtype: 'transcription',
    label: 'Transcription', description: 'Transcribe audio/video — connect from upstream or upload directly. Supports speaker diarization.',
    category: 'source', icon: 'Mic',
    defaultConfig: {
      subtype: 'transcription',
      provider: 'assemblyai',
      enable_diarization: true,
      max_speakers: null,
      target_node_ids: [],
      stakeholder_id: null,
      api_key_ref: 'ASSEMBLYAI_API_KEY',
      audio_files: [],
    },
    requiresManualInput: true, // requires audio upload + speaker assignment during run
  },
  {
    type: 'output', subtype: 'html-page',
    label: 'HTML Page', description: 'Render content as a styled HTML page using client brand colours',
    category: 'output', icon: 'Globe',
    defaultConfig: { subtype: 'html-page', pageType: 'landing-page', styleDirection: '', useBrandColors: true },
  },
  {
    type: 'output', subtype: 'webhook',
    label: 'Webhook', description: 'POST result to an external URL',
    category: 'output', icon: 'Send',
    defaultConfig: { subtype: 'webhook', url: '', method: 'POST', content_type: 'application/json', auth_type: 'none', auth_value_ref: '', secret_ref: '', custom_headers: '' },
  },
  {
    type: 'output', subtype: 'email',
    label: 'Email', description: 'Send result via email',
    category: 'output', icon: 'Mail',
    defaultConfig: { subtype: 'email', provider: 'sendgrid', api_key_ref: 'SENDGRID_API_KEY', from_email: '', from_name: '', to: '', subject: 'Your content is ready' },
  },
  {
    type: 'output', subtype: 'file-export',
    label: 'File Export', description: 'Export result as a downloadable file',
    category: 'output', icon: 'Download',
    defaultConfig: { format: 'txt', filename: 'output' },
  },
  {
    type: 'output', subtype: 'media-download',
    label: 'Media Download', description: 'Preview and download an image or video from an upstream node',
    category: 'output', icon: 'ImageDown',
    defaultConfig: { subtype: 'media-download' },
  },
  {
    type: 'output', subtype: 'display',
    label: 'Display', description: 'Show result in the run panel',
    category: 'output', icon: 'Monitor',
    defaultConfig: {},
  },
  {
    type: 'output', subtype: 'content-output',
    label: 'Content Output', description: 'Format and deliver generated content',
    category: 'output', icon: 'FileText',
    defaultConfig: { output_type: 'blog-post', min_words: 800, max_words: 1200, format_options: {} },
  },
  {
    type: 'output', subtype: 'video-generation',
    label: 'Video Generation', description: 'Generate video clips using Runway, Kling, Luma, Pika, or local models',
    category: 'media', icon: 'Film',
    defaultConfig: {
      subtype: 'video-generation',
      provider: 'runway',
      duration_seconds: 5,
      resolution: '720p',
      fps: 24,
      camera_motion: 'static',
      motion_intensity: 'medium',
      seed: null,
      start_frame: '',
      end_frame: '',
    },
  },
  {
    type: 'output', subtype: 'image-generation',
    label: 'Image Generation', description: 'Generate images from a prompt using GPT Image 2, DALL-E 3, or Fal.ai',
    category: 'media', icon: 'Image',
    defaultConfig: {
      subtype: 'image-generation',
      provider: 'gptimage2',
      aspect_ratio: '1:1',
      quality: 'standard',
      num_outputs: 1,
      cfg_scale: 7,
      seed: null,
      negative_prompt: '',
      reference_image: '',
    },
  },
  {
    type: 'output', subtype: 'client-feedback',
    label: 'Client Feedback', description: 'Request stakeholder feedback via secure portal or manual entry',
    category: 'output', icon: 'MessageSquare',
    requiresManualInput: true, // pauses run waiting for stakeholder response
    defaultConfig: {
      subtype: 'client-feedback',
      source_type: 'portal',
      trigger_mode: 'auto',
      auto_trigger_on: ['needs_revision', 'rejected'],
      default_reentry_node_id: '',
      reentry_rules: [],
      max_auto_retries: 3,
      stakeholder_ids: [],
      manual_feedback: {
        decision: 'needs_revision',
        star_rating: 3,
        tone_feedback: '',
        content_tags: [],
        comment: '',
      },
    },
  },
  // Voice Output
  {
    type: 'voice_output', subtype: 'voice-output',
    label: 'Voice Output', description: 'Convert text to speech — OpenAI TTS, ElevenLabs, or local kokoro',
    category: 'media', icon: 'AudioWaveform',
    defaultConfig: {
      subtype:           'voice-output',
      provider:          'openai',
      voice:             'echo',
      model:             'tts-1',
      speed:             1.0,
      format:            'mp3',
      direction:         '',
      merge_mode:        'concatenate',
      enable_ssml:       false,
      elevenlabs_model:  'eleven_turbo_v2_5',
      stability:         0.5,
      similarity_boost:  0.75,
      style_exaggeration: 0.0,
    },
  },
  // Music Generation
  {
    type: 'music_generation', subtype: 'music-generation',
    label: 'Music Generation', description: 'Generate ambient music or sound effects via ElevenLabs',
    category: 'media', icon: 'Music',
    defaultConfig: {
      subtype:            'music-generation',
      service:            'music',
      prompt:             '',
      duration_seconds:   30,
      force_instrumental: true,
      prompt_influence:   0.3,
    },
  },
  // Audio Mix
  {
    type: 'audio_mix', subtype: 'audio-mix',
    label: 'Audio Mix', description: 'Mix voice and music tracks — sidechain ducking, fade in/out',
    category: 'media', icon: 'Layers',
    defaultConfig: {
      subtype:          'audio-mix',
      voice_volume:        1.0,
      music_volume:        0.25,
      duck_enabled:        true,
      fade_in_seconds:     1.0,
      fade_out_seconds:    2.0,
      voice_delay_seconds: 0,
      music_delay_seconds: 0,
    },
  },
  // Character Animation
  {
    type: 'character_animation', subtype: 'character-animation',
    label: 'Character Animation', description: 'Animate a photo into a talking presenter video — D-ID, HeyGen, or local SadTalker',
    category: 'media', icon: 'UserRound',
    defaultConfig: {
      subtype:             'character-animation',
      provider:            'did',
      character_image:     '',
      heygen_avatar_id:    '',
      sadtalker_base_url:  'http://localhost:7860',
      expression_scale:    1.0,
      still_mode:          false,
      locked:              false,
    },
  },
  {
    type: 'video_composition', subtype: 'video-composition',
    label: 'Video Composition', description: 'Compose a video from a background image, text overlay, and optional audio — local ffmpeg or Shotstack cloud',
    category: 'media', icon: 'Film',
    defaultConfig: {
      subtype:       'video-composition',
      render_mode:   'local',
      output_format: 'video',
      overlay_style: 'lower_third',
      brand_color:   '#1a73e8',
      font_size:     28,
      duration:      10,
      background_url: '',
      text:          '',
    },
  },
  {
    type: 'logic', subtype: 'video-trimmer',
    label: 'Video Trimmer', description: 'Extract a time range from a video — set start and duration or end time',
    category: 'media', icon: 'Scissors',
    defaultConfig: {
      subtype:    'video-trimmer',
      trim_mode:  'duration',
      start_time: 0,
      duration:   10,
      end_time:   10,
    },
  },
  {
    type: 'logic', subtype: 'video-resize',
    label: 'Social Video Resizer', description: 'Crop and scale a video to platform aspect ratios — 9:16, 1:1, 4:5, 16:9',
    category: 'media', icon: 'Maximize2',
    defaultConfig: {
      subtype: 'video-resize',
      preset:  'reels',
      crf:     23,
      encode_preset: 'fast',
    },
  },
  // Audio Replace — mix or replace a video's audio track
  {
    type: 'audio_replace', subtype: 'audio-replace',
    label: 'Audio Replace', description: 'Swap or blend a video\'s audio track — add background music to Character Animation or any video',
    category: 'media', icon: 'ListMusic',
    defaultConfig: {
      subtype:            'audio-replace',
      mode:               'replace',
      music_volume:       0.3,
      video_volume:       1.0,
      loop_audio:         true,
      fade_in_seconds:    1.0,
      fade_out_seconds:   2.0,
    },
  },
  // Canvas utilities
  {
    type: 'group', subtype: 'group',
    label: 'Group Frame', description: 'Organize nodes into a labeled group',
    category: 'canvas', icon: 'RectangleHorizontal',
    defaultConfig: { subtype: 'group' },
  },
]

// ─── nodePILOT types ──────────────────────────────────────────────────────────

export interface PilotSuggestionNode {
  id:       string
  subtype:  string
  label:    string
  position: { x: number; y: number }
  config:   Record<string, unknown>
}

export interface PilotSuggestionEdge {
  source: string
  target: string
  label?: string
}

export interface PilotSuggestion {
  id:          string
  title:       string
  description: string
  nodes:       PilotSuggestionNode[]
  edges:       PilotSuggestionEdge[]
}

export interface PilotMessage {
  role:          'user' | 'assistant'
  content:       string
  suggestions?:  PilotSuggestion[]
  imagePreview?: string  // data URL shown as thumbnail in user messages
}

// ─── Insight state for confirmation banner ────────────────────────────────────

export interface InsightConfirmation {
  insightId: string
  connectedNodeId: string
  patternDescription: string
  stakeholderName: string
  appliedRunCount: number
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface WorkflowState {
  // Graph
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport

  // Metadata
  workflow: WorkflowMeta

  // UI
  selectedNodeId: string | null
  runStatus: RunStatus
  runError: string | null
  nodeRunStatuses: Record<string, NodeRunStatus>
  finalOutput: unknown
  /** True once the workflow has been run at least once — locks connectivity_mode */
  hasBeenRun: boolean
  /** Set when a transcription node pauses the run awaiting speaker assignment */
  pendingTranscriptionSessionId: string | null
  /** The currently active run ID — used to resume polling after pauses */
  activeRunId: string | null
  /** Set when a human review node pauses the run */
  pendingReviewRunId: string | null
  pendingReviewContent: string | null
  /** Active confirmation prompts for applied insights that have 3+ post-apply runs */
  insightConfirmations: InsightConfirmation[]
  /** True when the graph has unsaved changes (nodes/edges modified since last save or load) */
  graphDirty: boolean
  /** Score history per detection node — maps nodeId → [initial, retry1, retry2, ...] */
  detectionScoreHistory: Record<string, number[]>
  /** Active canvas tool — select (default) or hand/pan */
  canvasTool: 'select' | 'hand'
  /** ReactFlow instance — stored so palette/context menu can convert screen → flow coords */
  rfInstance: ReactFlowInstance | null

  // Actions — graph
  onNodesChange: (changes: NodeChange[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  setViewport: (viewport: Viewport) => void
  addNode: (node: Node) => void
  loadTemplate: (nodes: Node[], edges: Edge[]) => void
  updateNodeData: (id: string, data: Partial<Record<string, unknown>>) => void
  setNodeParent: (nodeId: string, parentId: string | null, position: { x: number; y: number }) => void
  groupSelectedNodes: () => void
  ungroupNode: (groupId: string) => void
  duplicateNodes: (nodeIds: string[]) => void

  // Actions — UI
  setSelectedNodeId: (id: string | null) => void
  setRunStatus: (status: RunStatus) => void
  setRunError: (error: string | null) => void
  setNodeRunStatuses: (statuses: Record<string, NodeRunStatus>) => void
  setDetectionScoreHistory: (history: Record<string, number[]>) => void
  setFinalOutput: (output: unknown) => void

  // Actions — metadata
  setWorkflowName: (name: string) => void
  setWorkflow: (meta: Partial<WorkflowMeta>) => void

  // Actions — transcription
  setPendingTranscriptionSessionId: (id: string | null) => void

  setActiveRunId: (id: string | null) => void

  // Actions — human review
  setPendingReview: (runId: string | null, content: string | null) => void

  // Actions — insights
  addInsightConfirmation: (confirmation: InsightConfirmation) => void
  dismissInsightConfirmation: (insightId: string) => void

  // Actions — canvas
  setRfInstance: (instance: ReactFlowInstance | null) => void
  setCanvasTool: (tool: 'select' | 'hand') => void
  addNodeBySubtype: (subtype: string, screenPosition?: { x: number; y: number }) => void

  // Pending navigation action — set when user clicks away with unsaved changes.
  // Can be any action: navigate to a route, sign out, etc.
  pendingNavAction: (() => void) | null
  setPendingNavAction: (action: (() => void) | null) => void

  // ── nodePILOT ─────────────────────────────────────────────────────────────
  pilotOpen:        boolean
  pilotMessages:    PilotMessage[]
  pilotSuggestions: PilotSuggestion[]
  pilotLoading:     boolean

  setPilotOpen:        (open: boolean) => void
  addPilotMessage:     (msg: PilotMessage) => void
  setPilotSuggestions: (suggestions: PilotSuggestion[]) => void
  setPilotLoading:     (loading: boolean) => void
  clearPilot:          () => void
  applyPilotSuggestion:(suggestion: PilotSuggestion) => void
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },

  workflow: {
    id: null,
    name: 'Untitled Workflow',
    clientId: null,
    clientName: null,
    connectivity_mode: 'online',
    default_model_config: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0.7,
    },
  },

  selectedNodeId: null,
  runStatus: 'idle',
  runError: null,
  nodeRunStatuses: {},
  detectionScoreHistory: {},
  finalOutput: null,
  hasBeenRun: false,
  pendingTranscriptionSessionId: null,
  activeRunId: null,
  pendingReviewRunId: null,
  pendingReviewContent: null,
  insightConfirmations: [],
  graphDirty: false,
  canvasTool: 'select',
  rfInstance: null,
  pendingNavAction: null,

  // nodePILOT — starts expanded
  pilotOpen:        true,
  pilotMessages:    [],
  pilotSuggestions: [],
  pilotLoading:     false,

  // Graph actions — each mutation marks the graph dirty
  onNodesChange: (changes) => {
    // Only flag dirty for structural changes, not selection/dimension updates
    const meaningful = changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')
    set({ nodes: applyNodeChanges(changes, get().nodes), ...(meaningful ? { graphDirty: true } : {}) })
  },

  onEdgesChange: (changes) => {
    // Only flag dirty for structural changes (add/remove), not selection updates
    const meaningful = changes.some((c) => c.type !== 'select')
    set({ edges: applyEdgeChanges(changes, get().edges), ...(meaningful ? { graphDirty: true } : {}) })
  },

  onConnect: (connection) =>
    set({
      edges: addEdge(
        {
          ...connection,
          animated: false,
          // Preserve sourceHandle as label so the runner can do port-based
          // routing (e.g. 'pass' / 'fail'). sourceHandle and targetHandle are
          // also kept as native React Flow fields so they survive serialization
          // and are restored correctly on canvas reload.
          label: connection.sourceHandle ?? undefined,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
        },
        get().edges,
      ),
      graphDirty: true,
    }),

  setViewport: (viewport) => set({ viewport }),

  addNode: (node) => {
    // Group frames go at the front so they render below regular nodes
    if (node.type === 'group') {
      set({ nodes: [node, ...get().nodes], graphDirty: true })
    } else {
      set({ nodes: [...get().nodes, node], graphDirty: true })
    }
  },
  loadTemplate: (nodes, edges) => {
    // Remap template node IDs to fresh UUIDs — template nodes have hardcoded IDs
    // ('vid-frame', 'src-brief', etc.) that collide when multiple workflows use
    // the same template. Edges reference nodes by ID so they must be remapped too.
    const idMap = new Map(nodes.map((n) => [n.id, crypto.randomUUID()]))
    const remappedNodes = nodes.map((n) => ({ ...n, id: idMap.get(n.id)! }))
    const remappedEdges = edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }))
    set({ nodes: remappedNodes, edges: remappedEdges, graphDirty: false })
  },

  updateNodeData: (id, data) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      ),
      graphDirty: true,
    }),

  setNodeParent: (nodeId, parentId, position) =>
    set({
      nodes: get().nodes.map((n) => {
        if (n.id !== nodeId) return n
        if (parentId === null) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { parentNode: _p, extent: _e, ...rest } = n as Node & { parentNode?: string; extent?: string }
          return { ...rest, position }
        }
        return { ...n, parentNode: parentId, position }
      }),
      graphDirty: true,
    }),

  groupSelectedNodes: () => {
    const { nodes } = get()
    const selected = nodes.filter((n) => n.selected && n.type !== 'group')
    if (selected.length < 2) return

    // Resolve absolute canvas position for each node (handles already-parented nodes)
    const absPos = (n: Node) => {
      const typed = n as Node & { parentNode?: string }
      if (!typed.parentNode) return n.position
      const parent = nodes.find((p) => p.id === typed.parentNode)
      return parent
        ? { x: parent.position.x + n.position.x, y: parent.position.y + n.position.y }
        : n.position
    }

    const PAD_TOP = 40  // room for the label bar
    const PAD     = 40  // padding on all sides (handles extend ~8px beyond node body)

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of selected) {
      const p = absPos(n)
      // Fall back to generous defaults — handles extend ~8px past node body
      // and some nodes haven't been measured by React Flow yet
      const nw = n.width  ? n.width  + 16 : 240  // +16 for left+right handles
      const nh = n.height ? n.height + 8  : 100  // +8 for top+bottom handles
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x + nw)
      maxY = Math.max(maxY, p.y + nh)
    }

    const gx = minX - PAD
    const gy = minY - PAD_TOP
    const gw = maxX - minX + PAD * 2
    const gh = maxY - minY + PAD_TOP + PAD

    const groupId = `node_${Date.now()}_grp`
    const groupNode: Node = {
      id: groupId,
      type: 'group',
      position: { x: gx, y: gy },
      style:    { width: gw, height: gh },
      zIndex:   -1,
      selected: false,
      data: { label: 'Group', subtype: 'group', config: { subtype: 'group' } },
    }

    const updated = nodes.map((n) => {
      if (!n.selected || n.type === 'group') return { ...n, selected: false }
      const p = absPos(n)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { parentNode: _pn, ...rest } = n as Node & { parentNode?: string }
      return { ...rest, parentNode: groupId, position: { x: p.x - gx, y: p.y - gy }, selected: false }
    })

    set({ nodes: [groupNode, ...updated], graphDirty: true, selectedNodeId: null })
  },

  ungroupNode: (groupId) => {
    const { nodes } = get()
    const group = nodes.find((n) => n.id === groupId)
    if (!group) return

    const updated = nodes
      .filter((n) => n.id !== groupId)
      .map((n) => {
        const typed = n as Node & { parentNode?: string }
        if (typed.parentNode !== groupId) return n
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { parentNode: _pn, ...rest } = typed
        return {
          ...rest,
          position: { x: group.position.x + n.position.x, y: group.position.y + n.position.y },
        }
      })

    set({ nodes: updated, graphDirty: true, selectedNodeId: null })
  },

  duplicateNodes: (nodeIds) => {
    const { nodes, edges } = get()
    const allNodes = nodes as (Node & { parentNode?: string })[]

    // Collect group IDs so we can include their children
    const groupIds = new Set(
      nodeIds.filter((id) => allNodes.find((x) => x.id === id)?.type === 'group')
    )

    // Include child nodes of any selected groups
    const childIds = allNodes
      .filter((n) => n.parentNode && groupIds.has(n.parentNode))
      .map((n) => n.id)
    const allIds = [...new Set([...nodeIds, ...childIds])]

    // Build ID map: original id → new id
    const idMap = new Map(
      allIds.map((id) => [`${id}`, `node_${Date.now()}_${Math.random().toString(36).slice(2)}`])
    )

    const OFFSET = 40
    const duplicated = allIds.map((id) => {
      const orig = allNodes.find((n) => n.id === id)!
      const { parentNode, ...rest } = orig as Node & { parentNode?: string }
      return {
        ...rest,
        id: idMap.get(id)!,
        position: { x: orig.position.x + OFFSET, y: orig.position.y + OFFSET },
        selected: true,
        ...(parentNode ? { parentNode: idMap.get(parentNode) ?? parentNode } : {}),
        data: { ...orig.data },
      }
    })

    // Duplicate edges where both endpoints are in the selection
    const idSet = new Set(allIds)
    const dupEdges = edges
      .filter((e) => idSet.has(e.source) && idSet.has(e.target))
      .map((e) => ({
        ...e,
        id: crypto.randomUUID(),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
      }))

    // Groups at front, regular nodes after; deselect originals
    const deselected = nodes.map((n) => ({ ...n, selected: false }))
    const groups = duplicated.filter((n) => n.type === 'group')
    const nonGroups = duplicated.filter((n) => n.type !== 'group')

    set({
      nodes: [...groups, ...deselected, ...nonGroups],
      edges: [...edges, ...dupEdges],
      graphDirty: true,
    })
  },

  // UI actions
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  setRunStatus: (status) =>
    set((state) => ({
      runStatus: status,
      runError: status !== 'failed' ? null : state.runError,
      hasBeenRun: status === 'running' ? true : state.hasBeenRun,
    })),

  setRunError: (error) => set({ runError: error }),

  setNodeRunStatuses: (statuses) => set((state) => ({ nodeRunStatuses: { ...state.nodeRunStatuses, ...statuses } })),
  setDetectionScoreHistory: (history) => set((state) => ({
    detectionScoreHistory: { ...state.detectionScoreHistory, ...history },
  })),
  setFinalOutput: (output) => set({ finalOutput: output }),

  // Metadata actions
  setWorkflowName: (name) =>
    set({ workflow: { ...get().workflow, name } }),

  setWorkflow: (meta) =>
    set({ workflow: { ...get().workflow, ...meta } }),

  // Transcription actions
  setPendingTranscriptionSessionId: (id) =>
    set({ pendingTranscriptionSessionId: id }),

  setActiveRunId: (id) => set({ activeRunId: id }),

  // Human review actions
  setPendingReview: (runId, content) =>
    set({ pendingReviewRunId: runId, pendingReviewContent: content }),

  // Insight confirmation actions
  addInsightConfirmation: (confirmation) =>
    set((state) => ({
      insightConfirmations: [
        ...state.insightConfirmations.filter((c) => c.insightId !== confirmation.insightId),
        confirmation,
      ],
    })),

  dismissInsightConfirmation: (insightId) =>
    set((state) => ({
      insightConfirmations: state.insightConfirmations.filter((c) => c.insightId !== insightId),
    })),

  setRfInstance: (instance) => set({ rfInstance: instance }),
  setCanvasTool: (tool) => set({ canvasTool: tool }),
  setPendingNavAction: (action) => set({ pendingNavAction: action }),

  // ── nodePILOT actions ─────────────────────────────────────────────────────
  setPilotOpen: (open) => set({ pilotOpen: open }),
  addPilotMessage: (msg) =>
    set((state) => ({ pilotMessages: [...state.pilotMessages, msg] })),
  setPilotSuggestions: (suggestions) => set({ pilotSuggestions: suggestions }),
  setPilotLoading: (loading) => set({ pilotLoading: loading }),
  clearPilot: () => set({ pilotMessages: [], pilotSuggestions: [], pilotLoading: false }),

  applyPilotSuggestion: (suggestion) => {
    const { nodes: existingNodes, edges: existingEdges, rfInstance } = get()

    // Calculate Y offset so new nodes appear below existing ones
    let maxY = 0
    for (const n of existingNodes) {
      const bottom = n.position.y + (n.height ?? 80) + 40
      if (bottom > maxY) maxY = bottom
    }
    const yOffset = existingNodes.length > 0 ? maxY + 60 : 0

    // Remap suggestion node IDs to fresh UUIDs
    const idMap = new Map(suggestion.nodes.map((n) => [n.id, `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${n.id}`]))

    // Build React Flow nodes, merging PALETTE_NODES defaultConfig
    const newRfNodes: Node[] = suggestion.nodes.map((sn) => {
      const def = PALETTE_NODES.find((p) => p.subtype === sn.subtype)
      const mergedConfig = { ...(def?.defaultConfig ?? {}), ...sn.config, subtype: sn.subtype }
      return {
        id:       idMap.get(sn.id)!,
        type:     def?.type ?? 'logic',
        position: { x: sn.position.x, y: sn.position.y + yOffset },
        data: {
          label:       sn.label,
          description: def?.description ?? '',
          icon:        def?.icon ?? 'Box',
          config:      mergedConfig,
          ...mergedConfig,  // includes subtype from mergedConfig
        },
      }
    })

    // Build React Flow edges with remapped IDs
    const newRfEdges: Edge[] = suggestion.edges.map((se) => ({
      id:     `edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      source: idMap.get(se.source) ?? se.source,
      target: idMap.get(se.target) ?? se.target,
      label:  se.label,
      animated: false,
    }))

    // If we have rfInstance, center viewport on the new nodes
    if (rfInstance && newRfNodes.length > 0) {
      const xs = newRfNodes.map((n) => n.position.x)
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
      const centerY = newRfNodes[0].position.y
      setTimeout(() => {
        rfInstance.setCenter(centerX, centerY + 200, { zoom: 0.8, duration: 600 })
      }, 100)
    }

    set({
      nodes:      [...existingNodes, ...newRfNodes],
      edges:      [...existingEdges, ...newRfEdges],
      graphDirty: true,
    })
  },

  addNodeBySubtype: (subtype, screenPosition) => {
    const { rfInstance, addNode, setSelectedNodeId } = get()
    const def = PALETTE_NODES.find((n) => n.subtype === subtype)
    if (!def) return

    let position: { x: number; y: number }
    if (screenPosition && rfInstance) {
      position = rfInstance.screenToFlowPosition(screenPosition)
    } else if (rfInstance) {
      // Default: center of the visible canvas area
      const canvas = document.querySelector('.react-flow')
      const rect = canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: 800, height: 600 }
      position = rfInstance.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    } else {
      position = { x: 200, y: 200 }
    }

    const newId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const isGroup = def.type === 'group'
    addNode({
      id: newId,
      type: def.type,
      position,
      // Group frames get a large default size and render behind other nodes
      ...(isGroup ? { style: { width: 400, height: 280 }, zIndex: -1 } : {}),
      data: {
        label: def.label,
        description: def.description,
        icon: def.icon,
        subtype: def.subtype,
        config: { ...def.defaultConfig },
      },
    })
    setSelectedNodeId(newId)
  },
}))
