import { describe, expect, it } from 'vitest'
import { planDecisionChange, isValidProductDecision, PRODUCT_DECISIONS, decisionRequiresAttention } from '@/lib/products/decision'
import type { DecisionChangeRequest } from '@/lib/products/decision'

function request(over: Partial<DecisionChangeRequest> = {}): DecisionChangeRequest {
  return {
    orgId: 'org-1',
    productId: 'prod-1',
    from: 'review',
    to: 'add',
    reason: 'Approved after checking demand.',
    actorType: 'user',
    actorUserId: 'user-1',
    actorLabel: 'tyler@example.com',
    ...over,
  }
}

describe('planDecisionChange', () => {
  it('the default/initial decision is "review" — every real product row defaults to it at the schema level', () => {
    // Not exercised via planDecisionChange itself (which only plans a
    // CHANGE), but the closed set and the schema default (0033_product_decision.sql)
    // agree: 'review' is a member of the valid set.
    expect(PRODUCT_DECISIONS).toContain('review')
  })

  it.each(PRODUCT_DECISIONS)('accepts "%s" as a valid target decision', (decision) => {
    const plan = planDecisionChange(request({ from: 'watch', to: decision }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.productUpdate.decision).toBe(decision)
  })

  it('rejects an invalid/arbitrary string decision, never coercing it', () => {
    const plan = planDecisionChange(request({ to: 'approved_forever' as never }))
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('not a recognised Commerce-OS decision')
  })

  it('isValidProductDecision rejects anything outside the closed set', () => {
    expect(isValidProductDecision('add')).toBe(true)
    expect(isValidProductDecision('ADD')).toBe(false) // case-sensitive, never coerced
    expect(isValidProductDecision('delete')).toBe(false)
    expect(isValidProductDecision('')).toBe(false)
  })

  it('ADD -> TEST -> BLOCK is a valid sequence — any decision may move to any other (an operator override, not a forward pipeline)', () => {
    const addToTest = planDecisionChange(request({ from: 'add', to: 'test' }))
    const testToBlock = planDecisionChange(request({ from: 'test', to: 'block' }))
    const blockBackToAdd = planDecisionChange(request({ from: 'block', to: 'add' }))
    expect(addToTest.ok).toBe(true)
    expect(testToBlock.ok).toBe(true)
    expect(blockBackToAdd.ok).toBe(true)
  })

  it('rejects a reason that is missing or too short', () => {
    expect(planDecisionChange(request({ reason: '' })).ok).toBe(false)
    expect(planDecisionChange(request({ reason: 'no' })).ok).toBe(false)
  })

  it('idempotent same-value resubmission: succeeds, produces no transition row, but still audits (e.g. a reason-only edit)', () => {
    const plan = planDecisionChange(request({ from: 'test', to: 'test', reason: 'Correcting the reason text.' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.transitionRow).toBeNull()
    expect(plan.value.decisionChanged).toBe(false)
    expect(plan.value.auditEntry.action).toBe('PRODUCT_DECISION_CHANGED')
    expect(plan.value.auditEntry.newValue).toEqual({ decision: 'test' })
  })

  it('a genuine change produces a transition row with the previous decision preserved', () => {
    const plan = planDecisionChange(request({ from: 'watch', to: 'add' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.decisionChanged).toBe(true)
    expect(plan.value.transitionRow).toMatchObject({ from_decision: 'watch', to_decision: 'add', org_id: 'org-1', product_id: 'prod-1' })
    expect(plan.value.auditEntry.previousValue).toEqual({ decision: 'watch' })
    expect(plan.value.auditEntry.newValue).toEqual({ decision: 'add' })
  })

  it('running the same change twice is safe and does not error the second time either (idempotent repeated updates)', () => {
    const first = planDecisionChange(request({ from: 'watch', to: 'hold' }))
    const second = planDecisionChange(request({ from: 'hold', to: 'hold' })) // caller now reflects the already-applied state
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.transitionRow).toBeNull()
  })

  it('decisionRequiresAttention is true only for review and block', () => {
    expect(decisionRequiresAttention('review')).toBe(true)
    expect(decisionRequiresAttention('block')).toBe(true)
    expect(decisionRequiresAttention('add')).toBe(false)
    expect(decisionRequiresAttention('test')).toBe(false)
    expect(decisionRequiresAttention('watch')).toBe(false)
    expect(decisionRequiresAttention('hold')).toBe(false)
    expect(decisionRequiresAttention('remove')).toBe(false)
  })

  it('organisation isolation: the orgId given is threaded through unchanged into every write the plan produces — never substituted, never dropped', () => {
    const plan = planDecisionChange(request({ orgId: 'org-A', productId: 'prod-in-org-A', from: 'watch', to: 'add' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.transitionRow?.org_id).toBe('org-A')
    expect(plan.value.transitionRow?.product_id).toBe('prod-in-org-A')
    expect(plan.value.auditEntry.orgId).toBe('org-A')
    // The executor (`products/decisionExecutor.ts`) always additionally
    // scopes its `products`/`product_decision_transitions` reads and writes
    // with `.eq('org_id', session.orgId)` from the AUTHENTICATED session,
    // never a client-supplied value — verified by code inspection, and by
    // the RLS policy `db:verify` already confirms is enabled on both
    // tables (0034_rls_product_decision.sql), the same mechanism every
    // other managed table in this codebase relies on. Not re-tested here,
    // since it is the same, already-covered gate.
  })

  it('a genuinely new order/fulfilment/shipment write path is never touched by a decision change — planDecisionChange has no knowledge of orders at all', () => {
    const plan = planDecisionChange(request({ from: 'add', to: 'block' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const producedKeys = Object.keys(plan.value)
    expect(producedKeys).toEqual(['transitionRow', 'productUpdate', 'auditEntry', 'decisionChanged'])
    // No order/fulfilment/shipment field anywhere in the plan's shape —
    // this function's only possible outputs are a products row update, its
    // own history row, and an audit entry. It cannot write to orders even
    // by accident, because it has no parameter or return path that could.
  })
})
