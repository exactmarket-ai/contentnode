/**
 * promptPropagation — copies an agency-level prompt template to every active client.
 * Called from the worker when an agency creates or re-enables a template.
 */

import { prisma, withAgency } from '@contentnode/database'
import type { PromptPropagationJobData } from './queues.js'

export async function propagateAgencyTemplate(data: PromptPropagationJobData): Promise<{ propagated: number }> {
  const { agencyId, templateId } = data

  return withAgency(agencyId, async () => {
    const template = await prisma.promptTemplate.findFirst({
      where: { id: templateId, agencyId, clientId: null, visibleToClients: true },
    })
    if (!template) return { propagated: 0 }

    const clients = await prisma.client.findMany({
      where: { agencyId, status: 'active' },
      select: { id: true },
    })

    let propagated = 0
    for (const client of clients) {
      const existing = await prisma.promptTemplate.findFirst({
        where: { agencyId, clientId: client.id, agencyTemplateId: templateId },
      })
      if (existing) {
        // If it exists but is hidden, un-hide it
        if (existing.isHidden) {
          await prisma.promptTemplate.update({
            where: { id: existing.id },
            data: { isHidden: false },
          })
        }
        continue
      }

      await prisma.promptTemplate.create({
        data: {
          agencyId,
          clientId:        client.id,
          name:            template.name,
          body:            template.body,
          category:        template.category,
          description:     template.description,
          source:          'agency',
          agencyTemplateId: templateId,
          agencyLevel:     false,
          visibleToClients: true,
          isHidden:        false,
          createdBy:       'system',
        },
      })
      propagated++
    }

    if (!template.propagatedAt) {
      await prisma.promptTemplate.update({
        where: { id: templateId },
        data: { propagatedAt: new Date() },
      })
    }

    return { propagated }
  })
}
