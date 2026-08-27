import { describe, expect, it } from 'vitest'
import { planChannelDecisionChange, channelDecisionBlockReason, channelDecisionBlocksExecution } from '@/lib/products/channelDecision'
import { PRODUCT_DECISIONS } from '@/lib/products/decision'
import type { ChannelDecisionChangeRequest } from '@/lib/products/channelDecision'

/**
 * Mirrors `tests/product-decision.test.ts` exactly, at channel granularity
 * (Milestone: channel-level decisions, HANDOVER.md §53).
 */

function request(over: Partial<ChannelDecisionChangeRequest> = {}): ChannelDecisionChangeRequest {
  return {
    orgId: 'org-1',
    productId: 'prod-1',
    channel: 'shopify',
    from: 'review',
    to: 'add',
    reason: 'Approved after checking demand on this channel specifically.',
    actorType: 'user',
    actorUserId: 'user-1',
    actorLabel: 'tyler@example.com',
    ...over,
  }
}

describe('planChannelDecisionChange', () => {
  it.each(PRODUCT_DECISIONS)('accepts "%s" as a valid target decision', (decision) => {
    const plan = planChannelDecisionChange(request({ from: 'watch', to: decision }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.upsert.decision).toBe(decision)
    expect(plan.value.upsert.channel).toBe('shopify')
  })

  it('rejects an invalid/arbitrary string decision, never coercing it', () => {
    const plan = planChannelDecisionChange(request({ to: 'approved_forever' as never }))
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.error).toContain('not a recognised Commerce-OS decision')
  })

  it('rejects a reason that is missing or too short', () => {
    expect(planChannelDecisionChange(request({ reason: '' })).ok).toBe(false)
    expect(planChannelDecisionChange(request({ reason: 'no' })).ok).toBe(false)
  })

  it('a product can be ADD overall while independently BLOCK on one channel — the whole point of this feature', () => {
    // planChannelDecisionChange has no knowledge of the product-level
    // decision at all — it is a wholly independent plan, which is exactly
    // what allows the two to genuinely disagree.
    const channelPlan = planChannelDecisionChange(request({ channel: 'amazon_uk', from: 'add', to: 'block', reason: 'Amazon referral fee makes this unprofitable.' }))
    expect(channelPlan.ok).toBe(true)
    if (!channelPlan.ok) return
    expect(channelPlan.value.upsert.channel).toBe('amazon_uk')
    expect(channelPlan.value.upsert.decision).toBe('block')
    expect(Object.keys(channelPlan.value.upsert)).not.toContain('productDecision')
  })

  it('idempotent same-value resubmission: succeeds, produces no transition row, but still audits', () => {
    const plan = planChannelDecisionChange(request({ from: 'test', to: 'test', reason: 'Correcting the reason text.' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.transitionRow).toBeNull()
    expect(plan.value.decisionChanged).toBe(false)
    expect(plan.value.auditEntry.action).toBe('CHANNEL_DECISION_CHANGED')
  })

  it('a genuine change produces a transition row keyed on the specific channel, with the previous decision preserved', () => {
    const plan = planChannelDecisionChange(request({ channel: 'ebay', from: 'watch', to: 'add' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.decisionChanged).toBe(true)
    expect(plan.value.transitionRow).toMatchObject({ channel: 'ebay', from_decision: 'watch', to_decision: 'add', org_id: 'org-1', product_id: 'prod-1' })
    expect(plan.value.auditEntry.previousValue).toEqual({ channel: 'ebay', decision: 'watch' })
    expect(plan.value.auditEntry.newValue).toEqual({ channel: 'ebay', decision: 'add' })
  })

  it('organisation isolation: orgId/productId/channel are threaded through unchanged into every write the plan produces', () => {
    const plan = planChannelDecisionChange(request({ orgId: 'org-A', productId: 'prod-in-org-A', channel: 'amazon_uk', from: 'watch', to: 'add' }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.transitionRow?.org_id).toBe('org-A')
    expect(plan.value.transitionRow?.product_id).toBe('prod-in-org-A')
    expect(plan.value.transitionRow?.channel).toBe('amazon_uk')
    expect(plan.value.auditEntry.orgId).toBe('org-A')
  })
})

describe('channel decision gate reuse — no second, parallel gate invented', () => {
  it('only add/test permit execution, exactly as at product level', () => {
    expect(channelDecisionBlocksExecution('add')).toBe(false)
    expect(channelDecisionBlocksExecution('test')).toBe(false)
    expect(channelDecisionBlocksExecution('watch')).toBe(true)
    expect(channelDecisionBlocksExecution('hold')).toBe(true)
    expect(channelDecisionBlocksExecution('block')).toBe(true)
    expect(channelDecisionBlocksExecution('remove')).toBe(true)
    expect(channelDecisionBlocksExecution('review')).toBe(true)
  })

  it('channelDecisionBlockReason names the specific channel, not a generic message', () => {
    const reason = channelDecisionBlockReason('block', 'amazon_uk')
    expect(reason).toContain('amazon_uk')
    expect(reason).toContain('block')
  })
})
