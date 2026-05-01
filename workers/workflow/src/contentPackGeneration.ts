import { prisma, withAgency, getModelForRole, defaultApiKeyRefForProvider } from '@contentnode/database'
import { callModel } from '@contentnode/ai'
import { synthesiseThoughtLeaderContext } from './clientBrainExtraction.js'
import type { Job } from 'bullmq'

// Job data type mirrors the API's ContentPackGenJobData
export interface ContentPackGenJobData {
  agencyId:         string
  clientId:         string
  runId:            string
  itemId:           string
  promptTemplateId: string
  promptName:       string
  topicId:          string
  topicTitle:       string
  topicSummary:     string
  targetType:       'member' | 'vertical' | 'company'
  targetId:         string | null
  targetName:       string | null
}

// ── Build four-context block for a leadership member assignment ───────────────

async function buildMemberFourContextBlock(
  memberId: string,
  agencyId: string,
  clientId: string,
  verticalId: string | null,
): Promise<{ systemBlock: string; fallbackVoice: string }> {
  const [memberRows, agencyRow, clientRow, verticalRow, brainRow] = await Promise.all([
    prisma.$queryRaw<Array<{
      name: string; role: string; bio: string | null; personal_tone: string | null;
      signature_topics: unknown; signature_stories: unknown; avoid_phrases: unknown;
    }>>`
      SELECT name, role, bio, personal_tone, signature_topics, signature_stories, avoid_phrases
      FROM leadership_members WHERE id = ${memberId} AND agency_id = ${agencyId} LIMIT 1`,
    prisma.$queryRaw<Array<{ brain_context: string | null }>>`
      SELECT brain_context FROM agencies WHERE id = ${agencyId} LIMIT 1`,
    prisma.$queryRaw<Array<{ brain_context: string | null }>>`
      SELECT brain_context FROM clients WHERE id = ${clientId} AND agency_id = ${agencyId} LIMIT 1`,
    verticalId
      ? prisma.$queryRaw<Array<{ brain_context: string | null }>>`
          SELECT brain_context FROM verticals WHERE id = ${verticalId} AND agency_id = ${agencyId} LIMIT 1`
      : Promise.resolve([] as Array<{ brain_context: string | null }>),
    prisma.$queryRaw<Array<{ context: string | null }>>`
      SELECT context FROM thought_leader_brains WHERE leadership_member_id = ${memberId} LIMIT 1`,
  ])

  const m = memberRows[0]
  const agencyCtx   = (agencyRow[0]?.brain_context ?? '').slice(0, 400)
  const clientCtx   = (clientRow[0]?.brain_context ?? '').slice(0, 800)
  const verticalCtx = (verticalRow[0]?.brain_context ?? '').slice(0, 800)
  const tlBrain     = brainRow[0]?.context ?? null

  // Fallback voice block (used when no thought leader brain exists yet)
  let fallbackVoice = ''
  if (m) {
    const topics  = Array.isArray(m.signature_topics)  ? (m.signature_topics  as string[]).join(', ')  : ''
    const stories = Array.isArray(m.signature_stories) ? (m.signature_stories as string[]).join(' | ') : ''
    const avoid   = Array.isArray(m.avoid_phrases)     ? (m.avoid_phrases     as string[]).join(', ')  : ''
    fallbackVoice = [
      `Writing voice: ${m.name} (${m.role})`,
      m.bio           ? `Bio: ${m.bio}` : null,
      m.personal_tone ? `Personal tone: ${m.personal_tone}` : null,
      topics          ? `Signature topics: ${topics}` : null,
      stories         ? `Signature stories/examples: ${stories}` : null,
      avoid           ? `Never say: ${avoid}` : null,
    ].filter(Boolean).join('\n')
  }

  // Build the four-context block
  const parts: string[] = []
  if (agencyCtx) {
    parts.push(`AGENCY CONTEXT (baseline):\n${agencyCtx}`)
  }
  if (clientCtx) {
    parts.push(`CLIENT / COMPANY CONTEXT:\n${clientCtx}`)
  }
  if (verticalCtx) {
    parts.push(`VERTICAL CONTEXT:\n${verticalCtx}`)
  }
  if (tlBrain) {
    parts.push(`THOUGHT LEADER VOICE PROFILE (apply with highest priority):\n${tlBrain}`)
    parts.push(`When the above contexts conflict, the Thought Leader Voice Profile takes precedence on all voice, tone, and style decisions.\nThe Vertical Context takes precedence on topic positioning and audience framing.`)
  } else if (fallbackVoice) {
    parts.push(`THOUGHT LEADER VOICE PROFILE (apply with highest priority):\n${fallbackVoice}`)
  }

  return { systemBlock: parts.join('\n\n'), fallbackVoice }
}

// ── Build voice/tone context from a vertical ──────────────────────────────────

async function buildVerticalContext(verticalId: string, agencyId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{
    name: string; target_audience: string | null;
    tone_descriptors: string[]; key_messages: string[]; voice_avoid_phrases: string[];
    brain_context: string | null;
  }>>`
    SELECT name, target_audience, tone_descriptors, key_messages, voice_avoid_phrases, brain_context
    FROM verticals
    WHERE id = ${verticalId} AND agency_id = ${agencyId}
    LIMIT 1
  `
  if (!rows.length) return ''
  const v = rows[0]
  return [
    `Vertical/audience: ${v.name}`,
    v.target_audience         ? `Target audience: ${v.target_audience}` : null,
    v.tone_descriptors?.length ? `Tone: ${v.tone_descriptors.join(', ')}` : null,
    v.key_messages?.length     ? `Key messages: ${v.key_messages.join(' | ')}` : null,
    v.voice_avoid_phrases?.length ? `Avoid: ${v.voice_avoid_phrases.join(', ')}` : null,
    v.brain_context            ? `Context: ${v.brain_context.slice(0, 400)}` : null,
  ].filter(Boolean).join('\n')
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function runContentPackGeneration(job: Job<ContentPackGenJobData>): Promise<void> {
  const {
    agencyId, clientId, runId, itemId,
    promptTemplateId, promptName,
    topicTitle, topicSummary,
    targetType, targetId, targetName,
  } = job.data

  const { provider: rProv, model: rModel } = await getModelForRole('generation_primary')
  const SONNET = { provider: rProv as 'anthropic' | 'openai' | 'ollama', model: rModel, api_key_ref: defaultApiKeyRefForProvider(rProv), temperature: 0.5, max_tokens: 2000 }

  await withAgency(agencyId, async () => {
    // Mark item as running
    await prisma.$executeRaw`
      UPDATE content_pack_run_items
      SET status = 'running'
      WHERE id = ${itemId}
    `

    // Mark run as running if it's still pending
    await prisma.$executeRaw`
      UPDATE content_pack_runs
      SET status = 'running', started_at = NOW()
      WHERE id = ${runId} AND status = 'pending'
    `

    try {
      // ── Fetch the prompt template body ────────────────────────────────────
      const template = await prisma.promptTemplate.findFirst({
        where: { id: promptTemplateId, agencyId },
        select: { body: true },
      })
      if (!template) throw new Error(`Prompt template ${promptTemplateId} not found`)

      // ── Fetch client + topic vertical for context ─────────────────────────
      const client = await prisma.client.findFirst({
        where: { id: clientId, agencyId },
        select: { name: true, brainContext: true },
      })

      const topicRows = await prisma.$queryRaw<Array<{ sources: unknown; vertical_id: string | null }>>`
        SELECT sources, vertical_id FROM topic_queue WHERE id = ${job.data.topicId} LIMIT 1
      `
      const topicVerticalId = topicRows[0]?.vertical_id ?? null
      const sources = Array.isArray(topicRows[0]?.sources) ? topicRows[0].sources as Array<{ title: string; url: string; publication: string }> : []
      const sourcesText = sources.slice(0, 5).map((s) => `- ${s.title} (${s.publication})`).join('\n')

      // ── Build system prompt — four-context for member, legacy for others ──
      let systemPrompt: string

      if (targetType === 'member' && targetId) {
        const { systemBlock } = await buildMemberFourContextBlock(targetId, agencyId, clientId, topicVerticalId)
        console.log(`[content-pack-gen] PATH=four-context-member memberId=${targetId} itemId=${itemId}`)
        systemPrompt = `You are a senior B2B content strategist and ghostwriter. Generate high-quality content following the prompt template exactly.

${systemBlock}

Output only the finished content — no preamble, no meta-commentary.`
      } else {
        console.log(`[content-pack-gen] PATH=standard targetType=${targetType} targetId=${targetId ?? 'none'} itemId=${itemId}`)
        let targetContext = ''
        if (targetType === 'vertical' && targetId) {
          targetContext = await buildVerticalContext(targetId, agencyId)
        } else if (targetType === 'company') {
          targetContext = `Writing for: ${targetName ?? client?.name ?? 'Company'} (company-level content)`
        }
        systemPrompt = `You are a senior B2B content strategist and ghostwriter. Generate high-quality content following the prompt template exactly.

${targetContext ? `Voice/audience context:\n${targetContext}\n` : ''}
${client?.brainContext ? `Company context:\n${client.brainContext.slice(0, 600)}\n` : ''}
Output only the finished content — no preamble, no meta-commentary.`
      }

      const userMessage = `Topic: ${topicTitle}

Topic summary: ${topicSummary}

${sourcesText ? `Research sources:\n${sourcesText}\n\n` : ''}Prompt template (follow this exactly):
${template.body}

Generate the content now.`

      const result = await callModel({ ...SONNET, system_prompt: systemPrompt }, userMessage)
      const content = result.text.trim()

      // ── Save completed item — store original_content snapshot and word count at generation time
      const wordCount = content.trim().split(/\s+/).filter(Boolean).length
      await prisma.$executeRaw`
        UPDATE content_pack_run_items
        SET status = 'completed', content = ${content}, original_content = ${content},
            word_count = ${wordCount}, completed_at = NOW()
        WHERE id = ${itemId}
      `

      // ── Check if all items in the run are done ────────────────────────────
      const pendingRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(*) AS cnt FROM content_pack_run_items
        WHERE run_id = ${runId} AND status IN ('pending', 'running')
      `
      const pending = Number(pendingRows[0]?.cnt ?? 0)

      if (pending === 0) {
        // All items complete — mark run completed
        await prisma.$executeRaw`
          UPDATE content_pack_runs
          SET status = 'completed', completed_at = NOW()
          WHERE id = ${runId}
        `

        // Write content_run brain attachment for member assignments
        if (targetType === 'member' && targetId) {
          writeMemberContentRunSignal(agencyId, clientId, targetId, runId, topicTitle, topicSummary, promptName).catch((err) => {
            console.error(`[content-pack-gen] brain signal failed for run ${runId}:`, err)
          })
        }

        // Trigger Monday + Box integrations
        await onRunComplete(agencyId, clientId, runId, targetType, targetId).catch((err) => {
          console.error(`[content-pack-gen] post-completion integration error for run ${runId}:`, err)
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[content-pack-gen] item ${itemId} failed:`, errorMessage)

      await prisma.$executeRaw`
        UPDATE content_pack_run_items
        SET status = 'failed', error_message = ${errorMessage}
        WHERE id = ${itemId}
      `

      // Mark run failed if no items still in flight
      const pendingRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(*) AS cnt FROM content_pack_run_items
        WHERE run_id = ${runId} AND status IN ('pending', 'running')
      `
      const pending = Number(pendingRows[0]?.cnt ?? 0)

      if (pending === 0) {
        const failedRows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
          SELECT COUNT(*) AS cnt FROM content_pack_run_items
          WHERE run_id = ${runId} AND status = 'failed'
        `
        const allFailed = Number(failedRows[0]?.cnt ?? 0) > 0
        if (allFailed) {
          await prisma.$executeRaw`
            UPDATE content_pack_runs
            SET status = 'failed', error_message = 'One or more pieces failed to generate', completed_at = NOW()
            WHERE id = ${runId}
          `
        }
      }
    }
  })
}

// ── Write content_run brain signal after all items complete ───────────────────

async function writeMemberContentRunSignal(
  agencyId: string,
  clientId: string,
  memberId: string,
  runId: string,
  topicTitle: string,
  topicSummary: string,
  promptName: string,
): Promise<void> {
  const runRows = await prisma.$queryRaw<Array<{
    pack_names: unknown; completed_at: Date | null; topic_title: string;
  }>>`
    SELECT pack_names, completed_at, topic_title FROM content_pack_runs WHERE id = ${runId} LIMIT 1
  `
  const run = runRows[0]
  if (!run) return

  const packNames = Array.isArray(run.pack_names) ? (run.pack_names as string[]).join(', ') : ''
  const completedAt = (run.completed_at ?? new Date()).toISOString().split('T')[0]

  const promptTypes = await prisma.$queryRaw<Array<{ prompt_name: string }>>`
    SELECT prompt_name FROM content_pack_run_items WHERE run_id = ${runId} AND status = 'completed'
  `
  const promptList = promptTypes.map((r) => r.prompt_name).join(', ')

  const content = `CONTENT RUN SIGNAL

Date: ${completedAt}
Topic: ${topicTitle}
Summary: ${topicSummary}
Prompt types generated: ${promptList || promptName}
Pack: ${packNames || 'N/A'}`

  const member = await prisma.leadershipMember.findFirst({
    where: { id: memberId, agencyId },
    select: { clientId: true },
  })
  if (!member) return

  await prisma.thoughtLeaderBrainAttachment.create({
    data: {
      agencyId,
      clientId,
      leadershipMemberId: memberId,
      source: 'content_run',
      content,
      metadata: { contentPackRunId: runId },
    },
  })

  await synthesiseThoughtLeaderContext(agencyId, clientId, memberId)
  console.log(`[content-pack-gen] brain content_run signal written for member ${memberId}`)
}

// ── Post-completion: Monday + Box ─────────────────────────────────────────────

async function onRunComplete(
  agencyId: string,
  clientId: string,
  runId: string,
  targetType: string,
  targetId: string | null,
) {
  // Get run details
  const runRows = await prisma.$queryRaw<Array<{
    id: string; topic_title: string; target_name: string; pack_names: unknown;
    monday_board_id: string | null; box_run_folder_id: string | null;
  }>>`
    SELECT id, topic_title, target_name, pack_names, monday_board_id, box_run_folder_id
    FROM content_pack_runs WHERE id = ${runId} LIMIT 1
  `
  const run = runRows[0]
  if (!run) return

  // Get completed items
  const items = await prisma.$queryRaw<Array<{
    id: string; prompt_name: string; content: string | null;
  }>>`
    SELECT id, prompt_name, content FROM content_pack_run_items
    WHERE run_id = ${runId} AND status = 'completed'
  `

  // Resolve target monday/box config
  let mondayBoardId: string | null = null
  let mondayColumnMapping: Record<string, string> | null = null
  let boxFolderId: string | null = null

  if (targetType === 'member' && targetId) {
    const rows = await prisma.$queryRaw<Array<{
      monday_board_id: string | null; monday_column_mapping: unknown; box_folder_id: string | null;
    }>>`
      SELECT monday_board_id, monday_column_mapping, box_folder_id
      FROM leadership_members WHERE id = ${targetId} AND agency_id = ${agencyId} LIMIT 1
    `
    if (rows[0]) {
      mondayBoardId = rows[0].monday_board_id
      mondayColumnMapping = rows[0].monday_column_mapping as Record<string, string> | null
      boxFolderId = rows[0].box_folder_id
    }
  } else if (targetType === 'vertical' && targetId) {
    const rows = await prisma.$queryRaw<Array<{
      monday_board_id: string | null; monday_column_mapping: unknown; box_folder_id: string | null;
    }>>`
      SELECT monday_board_id, monday_column_mapping, box_folder_id
      FROM verticals WHERE id = ${targetId} AND agency_id = ${agencyId} LIMIT 1
    `
    if (rows[0]) {
      mondayBoardId = rows[0].monday_board_id
      mondayColumnMapping = rows[0].monday_column_mapping as Record<string, string> | null
      boxFolderId = rows[0].box_folder_id
    }
  } else if (targetType === 'company') {
    const rows = await prisma.$queryRaw<Array<{
      content_monday_board_id: string | null; content_monday_column_mapping: unknown; content_box_folder_id: string | null;
    }>>`
      SELECT content_monday_board_id, content_monday_column_mapping, content_box_folder_id
      FROM clients WHERE id = ${clientId} AND agency_id = ${agencyId} LIMIT 1
    `
    if (rows[0]) {
      mondayBoardId = rows[0].content_monday_board_id
      mondayColumnMapping = rows[0].content_monday_column_mapping as Record<string, string> | null
      boxFolderId = rows[0].content_box_folder_id
    }
  }

  // ── Monday integration ────────────────────────────────────────────────────
  if (mondayBoardId) {
    await syncToMonday(agencyId, runId, mondayBoardId, mondayColumnMapping, run, items).catch((err) => {
      console.warn(`[content-pack-gen] monday sync failed for run ${runId}:`, err)
    })
  }

  // ── Box integration ───────────────────────────────────────────────────────
  if (boxFolderId) {
    await exportToBox(agencyId, runId, boxFolderId, run, items).catch((err) => {
      console.warn(`[content-pack-gen] box export failed for run ${runId}:`, err)
    })
  }
}

// ── Monday.com sync ───────────────────────────────────────────────────────────

async function syncToMonday(
  agencyId: string,
  runId: string,
  boardId: string,
  columnMapping: Record<string, string> | null,
  run: { topic_title: string; target_name: string; pack_names: unknown },
  items: Array<{ id: string; prompt_name: string; content: string | null }>,
) {
  const { getMondayToken, mondayGql } = await import('./mondayWriteback.js')
  const token = await getMondayToken(agencyId)
  if (!token) return

  // Create parent item
  const packNamesStr = Array.isArray(run.pack_names) ? (run.pack_names as string[]).join(', ') : ''
  const itemName = run.topic_title.slice(0, 120)

  const createItemMutation = `
    mutation {
      create_item(board_id: ${boardId}, item_name: ${JSON.stringify(itemName)}) {
        id
      }
    }
  `
  const createResult = await mondayGql(token, createItemMutation) as { create_item?: { id?: string } }
  const mondayItemId = createResult?.create_item?.id
  if (!mondayItemId) return

  // Store monday item ID
  await prisma.$executeRaw`
    UPDATE content_pack_runs
    SET monday_item_id = ${mondayItemId}, monday_board_id = ${boardId}
    WHERE id = ${runId}
  `

  // Create sub-items for each piece
  for (const item of items) {
    const subItemName = item.prompt_name.slice(0, 120)
    const createSubItemMutation = `
      mutation {
        create_subitem(parent_item_id: ${mondayItemId}, item_name: ${JSON.stringify(subItemName)}) {
          id
        }
      }
    `
    const subResult = await mondayGql(token, createSubItemMutation) as { create_subitem?: { id?: string } }
    const subItemId = subResult?.create_subitem?.id
    if (subItemId) {
      await prisma.$executeRaw`
        UPDATE content_pack_run_items SET monday_sub_item_id = ${subItemId} WHERE id = ${item.id}
      `
    }
  }
}

// ── Box.com export ────────────────────────────────────────────────────────────

async function exportToBox(
  agencyId: string,
  runId: string,
  parentFolderId: string,
  run: { topic_title: string; target_name: string },
  items: Array<{ id: string; prompt_name: string; content: string | null }>,
) {
  const { getBoxToken, ensureBoxSubfolder, textToDocxBuffer } = await import('./boxDelivery.js')
  const token = await getBoxToken(agencyId)
  if (!token) return

  const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const slug = run.topic_title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
  const runFolderName = `${dateStr}_${slug}`

  // Create run subfolder — returns the folder ID string
  const runFolderId = await ensureBoxSubfolder(agencyId, parentFolderId, runFolderName)
  if (!runFolderId) return

  await prisma.$executeRaw`
    UPDATE content_pack_runs SET box_run_folder_id = ${runFolderId} WHERE id = ${runId}
  `

  // Upload each piece
  for (const item of items) {
    if (!item.content) continue
    const fileSlug = item.prompt_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    const filename = `${slug}_${fileSlug}_${dateStr}.docx`

    try {
      const docxBuffer = await textToDocxBuffer(item.content)
      const FormData = (await import('form-data')).default
      const form = new FormData()
      form.append('attributes', JSON.stringify({ name: filename, parent: { id: runFolderId } }))
      form.append('file', docxBuffer, { filename, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

      const uploadRes = await fetch('https://upload.box.com/api/2.0/files/content', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: form as any,
      })

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json() as { entries?: Array<{ id: string }> }
        const boxFileId = uploadData?.entries?.[0]?.id
        if (boxFileId) {
          await prisma.$executeRaw`
            UPDATE content_pack_run_items SET box_file_id = ${boxFileId} WHERE id = ${item.id}
          `
        }
      }
    } catch (err) {
      console.warn(`[content-pack-gen] box upload failed for item ${item.id}:`, err)
    }
  }
}
