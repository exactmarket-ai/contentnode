import { Node, Edge } from 'reactflow'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'blog' | 'social' | 'email' | 'seo' | 'general'
  icon: string
  nodes: Node[]
  edges: Edge[]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
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
              model: 'claude-sonnet-4-5',
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
]
