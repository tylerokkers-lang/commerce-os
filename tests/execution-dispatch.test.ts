import { describe, expect, it } from 'vitest'
import { classifyDecisionType } from '@/lib/automation/executionDispatch'

/**
 * Phase 2 — the approval execution dispatcher's routing table (Milestone
 * 16). The actual domain executors
 * (`priceApprovalExecutor.ts`/`advertisingApprovalExecutor.ts`) are
 * `server-only` and cannot be imported into Vitest at all in this project
 * (the same established limitation `approvalWorkflow.ts` itself has always
 * had) — this file proves the one part of the dispatcher that is pure:
 * given a decision type, which domain owns it, and does it need an
 * executor at all.
 */

describe('classifyDecisionType: routes known types to the correct domain', () => {
  it('update_price routes to pricing and requires execution', () => {
    expect(classifyDecisionType('update_price')).toEqual({ domain: 'pricing', requiresExecution: true })
  })

  it.each(['pause_campaign', 'increase_ad_budget', 'decrease_ad_budget'])('%s routes to advertising and requires execution', (type) => {
    expect(classifyDecisionType(type)).toEqual({ domain: 'advertising', requiresExecution: true })
  })

  it.each(['request_approval', 'review_campaign'])('%s is a pure escalation — routes to escalation and requires no execution', (type) => {
    expect(classifyDecisionType(type)).toEqual({ domain: 'escalation', requiresExecution: false })
  })
})

describe('classifyDecisionType: an unknown type fails safely, never silently treated as either domain or a no-op escalation', () => {
  it('an unrecognised decision type is "unknown", but still reports requiresExecution: true — so it is treated as a missing-handler failure, never silently skipped', () => {
    expect(classifyDecisionType('some_future_domain_action')).toEqual({ domain: 'unknown', requiresExecution: true })
  })

  it('an empty string is also unknown, never mistaken for a real type', () => {
    expect(classifyDecisionType('')).toEqual({ domain: 'unknown', requiresExecution: true })
  })

  it('does not throw on garbage input', () => {
    expect(() => classifyDecisionType('<script>alert(1)</script>')).not.toThrow()
  })
})
