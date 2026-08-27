import { describe, expect, it } from 'vitest'
import { deriveChannelRecommendation } from '@/lib/marketplaces/channelRecommendation'
import type { PublicationDecision } from '@/lib/marketplaces/publicationGate'

function decision(over: Partial<PublicationDecision> = {}): PublicationDecision {
  return {
    channel: 'shopify',
    outcome: 'auto_publish_permitted',
    requirements: [],
    reason: 'Every requirement passed.',
    requiresOwnerApproval: false,
    ...over,
  }
}

describe('deriveChannelRecommendation', () => {
  it('everything passing -> SELL, regardless of whether it needs approval or auto-publishes', () => {
    expect(deriveChannelRecommendation(decision({ outcome: 'auto_publish_permitted' })).recommendation).toBe('SELL')
    expect(deriveChannelRecommendation(decision({ outcome: 'pending_approval' })).recommendation).toBe('SELL')
  })

  it('blocked by the channel decision itself being "remove" -> REMOVE', () => {
    const result = deriveChannelRecommendation(
      decision({
        outcome: 'blocked',
        requirements: [
          { key: 'product_decision', label: 'x', satisfied: true, detail: 'ok' },
          { key: 'channel_decision', label: 'x', satisfied: false, detail: 'shopify decision is "remove" — only add/test permit proceeding.' },
        ],
      }),
    )
    expect(result.recommendation).toBe('REMOVE')
  })

  it('blocked by the channel decision being "watch" -> WATCH', () => {
    const result = deriveChannelRecommendation(
      decision({
        outcome: 'blocked',
        requirements: [{ key: 'channel_decision', label: 'x', satisfied: false, detail: 'shopify decision is "watch" — only add/test permit proceeding.' }],
      }),
    )
    expect(result.recommendation).toBe('WATCH')
  })

  it('blocked by the channel decision being "block"/"hold" -> HOLD', () => {
    const blocked = deriveChannelRecommendation(
      decision({ outcome: 'blocked', requirements: [{ key: 'channel_decision', label: 'x', satisfied: false, detail: 'decision is "block" — only add/test permit proceeding.' }] }),
    )
    const held = deriveChannelRecommendation(
      decision({ outcome: 'blocked', requirements: [{ key: 'channel_decision', label: 'x', satisfied: false, detail: 'decision is "hold" — only add/test permit proceeding.' }] }),
    )
    expect(blocked.recommendation).toBe('HOLD')
    expect(held.recommendation).toBe('HOLD')
  })

  it('blocked by the channel decision defaulting to "review" -> REVIEW', () => {
    const result = deriveChannelRecommendation(
      decision({ outcome: 'blocked', requirements: [{ key: 'channel_decision', label: 'x', satisfied: false, detail: 'decision is "review" — only add/test permit proceeding.' }] }),
    )
    expect(result.recommendation).toBe('REVIEW')
  })

  it('blocked by a fact the operator never decided (profitability, compliance, supplier, lifecycle) -> always REVIEW, never an inferred REMOVE or HOLD', () => {
    for (const key of ['profitability', 'compliance', 'supplier_status', 'lifecycle', 'identifiers']) {
      const result = deriveChannelRecommendation(
        decision({
          outcome: 'blocked',
          requirements: [
            { key: 'product_decision', label: 'x', satisfied: true, detail: 'ok' },
            { key: 'channel_decision', label: 'x', satisfied: true, detail: 'ok' },
            { key, label: 'x', satisfied: false, detail: 'Some real fact failed.' },
          ],
        }),
      )
      expect(result.recommendation).toBe('REVIEW')
    }
  })

  it('blocked by the PRODUCT-level decision (not channel) still maps by its value, since the channel gate has nothing more specific to say', () => {
    const result = deriveChannelRecommendation(
      decision({
        outcome: 'blocked',
        requirements: [{ key: 'product_decision', label: 'x', satisfied: false, detail: 'Product decision is "remove" — only add/test permit proceeding.' }],
      }),
    )
    expect(result.recommendation).toBe('REMOVE')
  })
})
