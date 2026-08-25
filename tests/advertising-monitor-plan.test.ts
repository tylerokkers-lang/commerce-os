import { describe, expect, it } from 'vitest'
import { recommendedActionForClassification } from '@/lib/advertising/monitorPlan'
import type { CampaignClassification } from '@/lib/analytics/advertisingAnalytics'

/**
 * Phase 5/6 — the automatic monitor's pure decision logic (Milestone 16):
 * given a real classification, what (if anything) is worth recommending.
 * Never decides whether it is *safe* — that is entirely
 * `assessCampaignActionPolicy`'s job, run fresh for every recommendation
 * this produces via `proposeCampaignAction`.
 */

describe('recommendedActionForClassification: money-losing classifications recommend pausing', () => {
  it.each<CampaignClassification>(['wasted_spend', 'poor_profitability', 'high_acos_low_roas'])('%s recommends pause_campaign', (classification) => {
    expect(recommendedActionForClassification(classification)).toBe('pause_campaign')
  })
})

describe('recommendedActionForClassification: everything else produces no automatic recommendation', () => {
  it.each<CampaignClassification>(['healthy', 'insufficient_data', 'scale_opportunity', 'declining_performance'])('%s produces no recommendation', (classification) => {
    expect(recommendedActionForClassification(classification)).toBeNull()
  })

  it('a healthy campaign never produces a destructive action — the core "poor ROAS must never directly change a campaign" proof at the recommendation-mapping layer', () => {
    expect(recommendedActionForClassification('healthy')).toBeNull()
  })

  it('scale_opportunity is deliberately excluded — recommending a budget increase safely needs the compliance-block override this function does not have access to', () => {
    expect(recommendedActionForClassification('scale_opportunity')).toBeNull()
  })
})
