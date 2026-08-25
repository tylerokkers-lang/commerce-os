import type { CampaignClassification } from '@/lib/analytics/advertisingAnalytics'
import type { CampaignActionType } from '@/lib/automation/advertisingAutomation'

/**
 * Phase 5/6 — the automatic monitor's pure decision logic (Milestone 16):
 * given a real, already-computed classification, which campaign action (if
 * any) is worth recommending. Deliberately conservative and deliberately
 * pure — no I/O, so it is directly testable, and it never itself decides
 * whether the recommendation is *safe* to execute (that is entirely
 * `advertisingAutomation.ts`'s `assessCampaignActionPolicy`'s job, run
 * fresh by `proposeCampaignAction` for every recommendation this produces
 * — this function only decides what to *suggest*).
 *
 * `scale_opportunity` is deliberately excluded, for the same reason
 * `ai/actions/recommend.ts`'s `campaignRecommendations` already excludes
 * it from chat: recommending a budget increase safely requires the
 * compliance-block override `ceo/priorities.ts` applies (never scale a
 * campaign for a product that is compliance-BLOCKED on that channel) — the
 * monitor's own data *does* carry `identity.productId` unlike the chat
 * `FactBundle`, so this exclusion could be lifted by threading a real
 * compliance check through the monitor first (a reasonable next step, not
 * done this pass, see `HANDOVER.md`).
 */
export function recommendedActionForClassification(classification: CampaignClassification): CampaignActionType | null {
  switch (classification) {
    case 'wasted_spend':
    case 'poor_profitability':
    case 'high_acos_low_roas':
      return 'pause_campaign'
    case 'declining_performance':
      // A trend worth a human's attention, not conclusively "pause now" —
      // deliberately no automatic recommendation yet. A `review_campaign`
      // escalation would be the right fit (the same pure-escalation
      // decision type chat's `REVIEW_CAMPAIGN` already uses), but that
      // path lives in `ai/actions/` (chat-specific), not
      // `automation/advertisingExecution.ts` — wiring the monitor into it
      // is a reasonable next step, not done this pass (see `HANDOVER.md`).
      return null
    case 'scale_opportunity':
    case 'healthy':
    case 'insufficient_data':
      return null
    default:
      return null
  }
}
