import { evaluateSupplierSwitchAutomation } from './supplierSwitching'
import type { AutomationStore, JobRecord } from './store'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

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
 *
 * `runWorkerBatch` takes an `AutomationStore` rather than reaching for
 * Supabase directly, so the exact same orchestration code — claim, dispatch,
 * complete — runs in production (`supabaseStore.ts`) and in
 * `tests/automation-engine-e2e.test.ts` (`inMemoryStore.ts`). That test
 * drives this function directly, the same way the real HTTP route does,
 * rather than calling a business decision function on its own.
 */

export interface JobHandlerResult {
  succeeded: boolean
  error?: string
  retryable?: boolean
}

export type JobHandler = (job: JobRecord, store: AutomationStore) => Promise<JobHandlerResult>

/**
 * The payload a `supplier_availability_check` job carries — everything the
 * handler needs is passed in at enqueue time (the "facts loaded" step of
 * the brief's §1 pipeline). Assembling this payload from *live* product,
 * supplier and channel rows is the data-plumbing task Milestone 6 left
 * honestly undone (see `docs/MILESTONES.md`); a caller (a future live event
 * handler, or the demo/e2e-test harness) that already has this shape can use
 * this job type today.
 */
export interface SupplierAvailabilityCheckPayload {
  entityType: string
  entityId: string
  request: RedundancyRequest
  previousUnitCostPlusShippingMinor: number
}

function isSupplierAvailabilityCheckPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.entityId === 'string' && typeof payload.entityType === 'string' && typeof payload.request === 'object' && payload.request !== null
}

/**
 * EVENT -> JOB CREATED -> WORKER PICKS UP JOB -> FACTS LOADED (from the job
 * payload) -> PROFITABILITY CHECK + COMPLIANCE CHECK (inside
 * `evaluateSupplierRedundancy`, which this composes via
 * `evaluateSupplierSwitchAutomation`) -> AUTOMATION POLICY
 * (`policyEngine.ts`, inside the same call) -> ACTION EXECUTION -> RESULT
 * VERIFICATION -> AUDIT EVENT -> NOTIFICATION.
 *
 * "Action execution" here is honest about a real limitation, the same one
 * `approvalWorkflow.ts` documents: no live connector in this codebase yet
 * performs the external write side of switching a supplier. What genuinely
 * executes is the *decision* — the fact-first record of what the automation
 * engine determined, with its full reasoning, is written and audited for
 * real, and is exactly what a future supplier-order connector would consume
 * to perform the actual external switch.
 */
async function handleSupplierAvailabilityCheck(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isSupplierAvailabilityCheckPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for supplier_availability_check.', retryable: false }
  }
  const payload = job.payload as unknown as SupplierAvailabilityCheckPayload

  // Execution-time kill-switch/limit check — deliberately re-read here, not
  // trusted from enqueue time, so a pause applied while this job was queued
  // still takes effect.
  const settings = await store.getAutomationSettings(job.orgId)

  const result = evaluateSupplierSwitchAutomation({
    request: payload.request,
    previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor,
    settings,
  })

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    correlationId: job.correlationId,
    // One action per job execution, even across a retry — a re-run of the
    // same job must never record (or notify) the decision twice.
    idempotencyKey: `job:${job.id}`,
    actionType: 'switch_supplier',
    entityType: payload.entityType,
    entityId: payload.entityId,
    // The policy's own reason, not the domain's — the domain reason
    // ("switched to X") would be misleading if a cross-cutting concern the
    // domain engine cannot see (the kill switch, a spending limit) is what
    // actually decided the outcome. `policyEngine.ts` already passes the
    // domain reason through untouched whenever it is itself the deciding
    // factor, so this is never a loss of information.
    reason: result.policy.reason,
    inputFacts: { request: payload.request as unknown as Record<string, unknown>, previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor },
    decision: { redundancy: result.redundancy as unknown as Record<string, unknown> },
    policy: result.policy,
    automationLevel: payload.request.automationLevel,
    actorType: 'system',
    jobId: job.id,
  })

  if (created.alreadyExisted) return { succeeded: true } // Idempotent re-run: already recorded and notified once.

  const notifyBase = { orgId: job.orgId, entityType: payload.entityType, entityId: payload.entityId, dedupeKey: `action:${created.id}` }

  // Branches on `created.status` — the store's own authoritative record of
  // what actually happened — rather than re-deriving from `result.policy`.
  // The store can still override the policy's own verdict (the
  // runaway-automation safeguard in `store.ts` forces `blocked` even when
  // the policy said `allow_automatic`), and this must never disagree with
  // what gets executed next.
  if (created.status === 'executing') {
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: payload.entityType, entityId: payload.entityId })
    await store.notify({ ...notifyBase, severity: 'success', category: 'supplier', title: `Supplier switched automatically for ${payload.entityId}`, body: result.redundancy.reason })
  } else if (created.status === 'requires_approval') {
    // Bridges the decision onto the owner-facing Approvals queue — an
    // `automation_actions` row alone never appeared there (brief §11).
    await store.proposeApproval({
      orgId: job.orgId,
      decisionType: 'switch_supplier',
      entityType: payload.entityType,
      entityId: payload.entityId,
      title: `Switch supplier for ${payload.entityId}`,
      detail: result.redundancy.recommended ? `Recommend switching to ${result.redundancy.recommended.candidate.name}.` : 'No recommended alternative could be selected automatically.',
      reasoning: result.policy.reason,
      confidence: null, // A deterministic policy decision, not a probabilistic estimate — no confidence figure to report (docs/PRINCIPLES.md §1).
      estimatedImpactMinor: result.redundancy.recommended ? result.redundancy.recommended.candidate.signals.unitCost.minor + result.redundancy.recommended.candidate.signals.shippingCost.minor : null,
      automationLevelRequired: payload.request.automationLevel,
      riskLevel: result.policy.riskLevel,
      inputs: { request: payload.request as unknown as Record<string, unknown>, previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor },
      actionPayload: { actionType: 'switch_supplier', entityType: payload.entityType, entityId: payload.entityId, reason: result.redundancy.reason, inputFacts: { request: payload.request as unknown as Record<string, unknown> } },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'supplier', title: `Approval needed: supplier switch for ${payload.entityId}`, body: result.policy.reason, actionUrl: '/approvals' })
  } else {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'supplier', title: `Supplier switch blocked for ${payload.entityId}`, body: result.policy.reason })
  }

  return { succeeded: true }
}

/**
 * No further live handler is registered yet for any other job type — every
 * other business automation this milestone built (`priceAutomation`,
 * `inventoryAutomation`, `publicationAutomation`, `orderAutomation`,
 * `monitoring`) is a pure, fully tested decision function, but assembling
 * the *live* inputs each needs (every real product, supplier and channel
 * row from the database) is a data-plumbing task distinct from the engine
 * itself and is honestly left for a following pass rather than faked here.
 * An unregistered job type fails immediately and non-retryably, with that
 * exact reason — never silently "succeeding" having done nothing.
 */
const HANDLERS: Record<string, JobHandler> = {
  supplier_availability_check: handleSupplierAvailabilityCheck,
}

export interface WorkerBatchResult {
  claimed: number
  succeeded: number
  failed: number
  deadLettered: number
}

export async function runWorkerBatch(store: AutomationStore, workerId: string, maxJobs = 10): Promise<WorkerBatchResult> {
  const result: WorkerBatchResult = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 }

  for (let i = 0; i < maxJobs; i++) {
    const job = await store.claimNextJob(workerId)
    if (!job) break
    result.claimed++

    const handler = HANDLERS[job.jobType]
    const outcome: JobHandlerResult = handler
      ? await handler(job, store).catch((error) => ({
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
        }))
      : { succeeded: false, error: `No handler registered for job type "${job.jobType}".`, retryable: false }

    await store.completeJob(job, outcome)

    if (outcome.succeeded) result.succeeded++
    else if (job.attempts >= job.maxAttempts || outcome.retryable === false) result.deadLettered++
    else result.failed++
  }

  return result
}
