import 'server-only'

import { claimNextJob, completeJob, type AutomationJob } from './jobs'

/**
 * The job worker (brief §5, §30's "automation works without Claude Code
 * running").
 *
 * `/api/automation/run` calls `runWorkerBatch` on every invocation. Nothing
 * about this loop depends on who or what calls the route — a Vercel Cron
 * entry, a hosted worker, a serverless scheduled function, or a plain `curl`
 * on a timer all produce an identical claim/execute/complete cycle.
 *
 * Handlers are registered by `job_type` in a closed map rather than by
 * evaluating anything from the payload as code — the brief is explicit that
 * automation must never allow arbitrary code execution, and a fixed,
 * reviewable set of handlers is how that is enforced structurally, not just
 * by convention.
 */

export interface JobHandlerResult {
  succeeded: boolean
  error?: string
  retryable?: boolean
}

export type JobHandler = (job: AutomationJob) => Promise<JobHandlerResult>

/**
 * No live handler is registered yet for any job type — every business
 * automation this milestone built (`priceAutomation`, `inventoryAutomation`,
 * `supplierSwitching`, `publicationAutomation`, `orderAutomation`,
 * `monitoring`) is a pure, fully tested decision function, but assembling
 * the *live* inputs they need (every real product, supplier and channel row
 * from the database, correctly shaped into `CostInputs`/`ComplianceContext`)
 * is a data-plumbing task distinct from the engine itself and is honestly
 * left for a following pass rather than faked here. An unregistered job
 * type fails immediately and non-retryably, with that exact reason — never
 * silently "succeeding" having done nothing.
 */
const HANDLERS: Record<string, JobHandler> = {}

export interface WorkerBatchResult {
  claimed: number
  succeeded: number
  failed: number
  deadLettered: number
}

export async function runWorkerBatch(workerId: string, maxJobs = 10): Promise<WorkerBatchResult> {
  const result: WorkerBatchResult = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 }

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextJob(workerId)
    if (!job) break
    result.claimed++

    const handler = HANDLERS[job.job_type]
    const outcome: JobHandlerResult = handler
      ? await handler(job).catch((error) => ({
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
        }))
      : { succeeded: false, error: `No handler registered for job type "${job.job_type}".`, retryable: false }

    await completeJob(job, outcome)

    if (outcome.succeeded) result.succeeded++
    else if (job.attempts >= job.max_attempts || outcome.retryable === false) result.deadLettered++
    else result.failed++
  }

  return result
}
