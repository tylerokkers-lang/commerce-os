import { decideComplianceRecheck, type ComplianceRecheckContext } from '@/lib/orders/complianceRecheck'
import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Compliance monitoring (brief §3): reuses `decideComplianceRecheck`
 * (Milestone 5's own compliance-freshness/supplier-change decision) rather
 * than a new staleness rule, and triggers the existing
 * `product_compliance_recheck` handler (Milestone 7) — which itself calls
 * `assessCompliance` (Milestone 2) — rather than reimplementing compliance
 * logic at any layer.
 */

export interface ComplianceMonitorSubject {
  channelProductId: string
  productId: string
  channel: 'shopify' | 'amazon_uk'
  supplierId: string
  context: ComplianceRecheckContext
  complianceContext: Record<string, unknown>
}

const MONITOR_KEY = 'compliance_freshness'

export const complianceMonitor: Monitor<ComplianceMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Compliance freshness', category: 'compliance', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly ComplianceMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let eventsCreated = 0
    let eventsDeduplicated = 0

    for (const subject of subjects) {
      try {
        const decision = decideComplianceRecheck(subject.context)
        if (!decision.required) continue

        const eventType = subject.context.approvedSupplierId !== subject.context.fulfillingSupplierId ? 'COMPLIANCE_RECHECK_REQUIRED' : 'COMPLIANCE_ASSESSMENT_STALE'
        const result = await ctx.events.createEvent({
          orgId: ctx.orgId, eventType, subjectType: 'channel_product', subjectId: subject.channelProductId,
          source: 'internal', severity: 'warning', facts: { reason: decision.reason, channel: subject.channel },
          dedupeKey: `compliance:${subject.channelProductId}:${subject.channel}`,
        })

        if (!result.deduplicated) {
          eventsCreated++
          await ctx.store.enqueueJob({
            orgId: ctx.orgId, jobType: 'product_compliance_recheck',
            payload: { productId: subject.productId, channelProductId: subject.channelProductId, channel: subject.channel, supplierId: subject.supplierId, context: subject.complianceContext },
            idempotencyKey: `event:${result.id}`, correlationId: result.id,
          })
        } else {
          eventsDeduplicated++
        }
      } catch (error) {
        errors.push(`${subject.channelProductId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated: subjects.length, eventsCreated, eventsDeduplicated, errors }
  },
}
