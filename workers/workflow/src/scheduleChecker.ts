import { Cron } from 'croner'
import { prisma } from '@contentnode/database'
import { createQueue, QUEUE_WORKFLOW_RUNS, type WorkflowRunJobData } from './queues.js'

export async function runScheduleChecker(): Promise<void> {
  const now = new Date()

  const dueSchedules = await prisma.workflowSchedule.findMany({
    where: { status: 'active', nextRunAt: { lte: now } },
    include: { workflow: { select: { id: true, agencyId: true, status: true } } },
  })

  if (dueSchedules.length === 0) return

  console.log(`[schedule-checker] ${dueSchedules.length} schedule(s) due`)

  const runsQueue = createQueue<WorkflowRunJobData>(QUEUE_WORKFLOW_RUNS)

  for (const sched of dueSchedules) {
    if (sched.workflow.status === 'archived') {
      // Pause schedule for archived workflows
      await prisma.workflowSchedule.update({ where: { id: sched.id }, data: { status: 'paused' } })
      continue
    }

    try {
      const run = await prisma.workflowRun.create({
        data: {
          workflowId: sched.workflowId,
          agencyId: sched.agencyId,
          triggeredBy: 'system',
          triggerType: 'scheduled',
          status: 'pending',
          input: {},
          output: { nodeStatuses: {} },
        },
      })

      await runsQueue.add(
        'run-workflow',
        { workflowRunId: run.id, agencyId: sched.agencyId },
        { jobId: run.id, attempts: 2, backoff: { type: 'fixed', delay: 5000 } }
      )

      // Compute next fire time
      let nextRunAt: Date | null = null
      try {
        nextRunAt = new Cron(sched.cronExpr, { timezone: sched.timezone }).nextRun() ?? null
      } catch {
        console.warn(`[schedule-checker] invalid cron "${sched.cronExpr}" on schedule ${sched.id} — pausing`)
        await prisma.workflowSchedule.update({ where: { id: sched.id }, data: { status: 'paused' } })
        continue
      }

      await prisma.workflowSchedule.update({
        where: { id: sched.id },
        data: { lastRunAt: now, nextRunAt },
      })

      console.log(`[schedule-checker] enqueued run ${run.id} for workflow ${sched.workflowId}, next: ${nextRunAt?.toISOString()}`)
    } catch (err) {
      console.error(`[schedule-checker] failed to enqueue schedule ${sched.id}:`, err)
    }
  }
}
