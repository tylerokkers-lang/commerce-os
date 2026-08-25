import { describe, expect, it } from 'vitest'
import { classifyDecisionType } from '@/lib/automation/executionDispatch'
import { EXECUTABLE_ACTION_TYPES, PROPOSED_ACTION_TYPES } from '@/lib/ai/actions/types'

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

  // `automation_action_type` (migration 0008 onward) has real values this
  // dispatcher was never built to own — e.g. `pause_product`/`publish_product`,
  // which execute entirely through the older `automation_actions`-only
  // policy engine (`productHandlers.ts` et al.) and never reach `ai_decisions`
  // at all. If one somehow did reach the dispatcher, it must fail safely
  // (`unknown`/`requiresExecution: true` -> a "no handler registered" error),
  // never be guessed into pricing or advertising just because it superficially
  // resembles a product/campaign action.
  it.each(['pause_product', 'publish_product', 'switch_supplier', 'submit_supplier_order'])(
    '%s (a real but non-approval-dispatched action type) is never mistaken for pricing, advertising, or a no-op escalation',
    (type) => {
      const result = classifyDecisionType(type)
      expect(result.domain).not.toBe('pricing')
      expect(result.domain).not.toBe('advertising')
      expect(result.domain).not.toBe('escalation')
      expect(result).toEqual({ domain: 'unknown', requiresExecution: true })
    },
  )
})

describe('classifyDecisionType: review-only and informational proposals never reach the dispatcher in the first place', () => {
  // `ai/actions/propose.ts` only ever calls `proposeApproval()` (which is
  // what eventually produces a `decisionType` this dispatcher sees) when
  // `validateActionIntent` returns `outcome: 'requires_approval'` —
  // `validateActionIntent` (`ai/actions/validate.ts`) itself only reaches
  // that outcome for a type in `EXECUTABLE_ACTION_TYPES`; every other
  // `ProposedActionType` is routed to `reviewOnly()` instead, which returns
  // `outcome: 'not_executable'` and never calls `proposeApproval`. So a
  // review-only/informational proposal never gets a decision type for this
  // dispatcher to see at all — the filtering happens one layer earlier, by
  // construction, not by this dispatcher rejecting it after the fact.
  const NON_EXECUTABLE_TYPES = PROPOSED_ACTION_TYPES.filter((t) => !EXECUTABLE_ACTION_TYPES.includes(t))

  it('EXECUTABLE_ACTION_TYPES is a genuine, non-empty subset of PROPOSED_ACTION_TYPES — the two vocabularies stay in sync', () => {
    expect(EXECUTABLE_ACTION_TYPES.length).toBeGreaterThan(0)
    for (const type of EXECUTABLE_ACTION_TYPES) expect(PROPOSED_ACTION_TYPES).toContain(type)
  })

  it('review-only chat action types (PAUSE_CAMPAIGN, INCREASE_BUDGET, DECREASE_BUDGET, etc.) are excluded from EXECUTABLE_ACTION_TYPES', () => {
    expect(NON_EXECUTABLE_TYPES).toEqual(
      expect.arrayContaining(['CREATE_LISTING', 'PAUSE_LISTING', 'REVIEW_SUPPLIER', 'REVIEW_PRODUCT', 'ADJUST_INVENTORY_THRESHOLD', 'REVIEW_ADVERTISING', 'PAUSE_CAMPAIGN', 'INCREASE_BUDGET', 'DECREASE_BUDGET']),
    )
    expect(NON_EXECUTABLE_TYPES).not.toEqual(expect.arrayContaining(['UPDATE_PRICE', 'REQUEST_APPROVAL', 'REVIEW_CAMPAIGN']))
  })
})
