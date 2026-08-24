import type { CEOCommandCentre } from '@/lib/ceo/types'
import type { OpportunitySummary, ProductSummary, SupplierListItem } from '@/lib/core/domain'
import type { IntelligenceSummary } from '@/lib/products/opportunities'
import type { AdvertisingIntelligence } from '@/lib/analytics/repository'
import { isKnown, type Metric } from '@/lib/analytics/types'
import { formatMoney, type Money } from '@/lib/core/money'
import type { ChatReference, FactBundle } from './types'

/**
 * The one place a `FactBundle` is assembled — pure, synchronous, and the
 * only thing between "what Milestone 6–11 already know" and what a chat
 * provider is allowed to see. Nothing here recomputes a priority, a health
 * status, a compliance verdict or a profit figure; every value is read
 * straight off `CEOCommandCentre`/`OpportunitySummary`/`SupplierListItem` —
 * the exact same objects `/` and `/opportunities`/`/suppliers` already
 * render. A metric this codebase marked `unknown`/`stale`/`unavailable`
 * (Milestone 10's `isKnown`) is never coerced into a number here — it
 * becomes an explicit caution string instead, so neither the model nor the
 * offline fallback can ever present a guess as a fact.
 */

const CHANNEL_LABELS: Record<string, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK' }

function moneyMetric(m: Metric<Money>): string {
  return isKnown(m) ? formatMoney(m.value) : `unavailable — ${m.source}`
}

function pctMetric(m: Metric<number>): string {
  return isKnown(m) ? `${m.value.toFixed(1)}%` : `unavailable — ${m.source}`
}

function countMetric(m: Metric<number>): string {
  return isKnown(m) ? String(m.value) : `unavailable — ${m.source}`
}

function ratioMetric(m: Metric<number>): string {
  return isKnown(m) ? m.value.toFixed(2) : `unavailable — ${m.source}`
}

/** Every metric this bundle chose to represent as "unavailable" rather than a number, named once here so a provider can cite the *reason* (e.g. a real mixed-currency finding) instead of silently dropping the topic. */
function collectCurrencyCautions(ceo: CEOCommandCentre): readonly string[] {
  const cautions: string[] = []
  const check = (label: string, m: Metric<unknown>) => {
    if (m.status === 'unavailable' && /currenc/i.test(m.source)) cautions.push(`${label}: ${m.source}`)
  }
  check('Overall revenue', ceo.executiveSummary.revenue)
  check('Overall net revenue', ceo.executiveSummary.netRevenue)
  for (const c of ceo.financialPerformance.channels) {
    check(`${CHANNEL_LABELS[c.channel] ?? c.channel} revenue`, c.sales.revenue)
  }
  return cautions
}

export function buildFactBundle(input: {
  ceo: CEOCommandCentre
  orgName: string
  opportunities: readonly OpportunitySummary[]
  opportunitySummary: IntelligenceSummary | null
  suppliers: readonly SupplierListItem[]
  /** Optional so every pre-existing call site (tests, demo scenarios not focused on catalogue matching) keeps working unchanged — defaults to no known products, never a guess. */
  products?: readonly ProductSummary[]
  /** Optional for the same reason — defaults to no known campaigns, never a guess (Milestone 14). */
  advertisingIntelligence?: AdvertisingIntelligence
  now: string
}): FactBundle {
  const { ceo } = input

  // Per-channel margin/profit context, joined onto the real catalogue by
  // productId — sourced from the same highlight lists `/` already renders
  // (`topRevenueProducts`/`topProfitProducts`/`lossMakingProducts`), never
  // a second profitability read. A product not present in any of the
  // three simply has no known margin here — `null`, never zero.
  const marginByProductChannel = new Map<string, { knownNetMarginPct: number | null; netProfitMinor: number | null }>()
  for (const p of [...ceo.financialPerformance.topRevenueProducts, ...ceo.financialPerformance.topProfitProducts, ...ceo.financialPerformance.lossMakingProducts]) {
    marginByProductChannel.set(`${p.productId}:${p.channel}`, { knownNetMarginPct: p.netMarginPct, netProfitMinor: p.netProfitMinor })
  }
  const CHANNEL_KEYS = ['shopify', 'amazon_uk'] as const

  return {
    generatedAt: input.now,
    isDemo: ceo.isDemo,
    orgName: input.orgName,
    dataSourceFailures: ceo.dataSourceFailures,
    currencyCautions: collectCurrencyCautions(ceo),
    overallHealth: ceo.businessHealth.overall,
    healthAreas: ceo.businessHealth.areas.map((a) => ({ label: a.label, status: a.status, reasons: a.reasons })),
    executiveSummary: [
      { label: 'Revenue (last 30 days)', status: ceo.executiveSummary.revenue.status, value: moneyMetric(ceo.executiveSummary.revenue) },
      { label: 'Net revenue', status: ceo.executiveSummary.netRevenue.status, value: moneyMetric(ceo.executiveSummary.netRevenue) },
      { label: 'Orders', status: ceo.executiveSummary.orders.status, value: countMetric(ceo.executiveSummary.orders) },
      { label: 'Average order value', status: ceo.executiveSummary.averageOrderValue.status, value: moneyMetric(ceo.executiveSummary.averageOrderValue) },
      { label: 'Refund rate', status: ceo.executiveSummary.refundRatePct.status, value: pctMetric(ceo.executiveSummary.refundRatePct) },
      { label: 'Return rate', status: ceo.executiveSummary.returnRatePct.status, value: pctMetric(ceo.executiveSummary.returnRatePct) },
      {
        label: 'Known net margin', status: ceo.executiveSummary.profitDataComplete ? 'fact' : 'partial',
        value: ceo.executiveSummary.knownNetMarginPct === null ? 'unknown — incomplete cost/price data' : `${ceo.executiveSummary.knownNetMarginPct.toFixed(1)}%${ceo.executiveSummary.profitDataComplete ? '' : ' (based on incomplete cost/price data)'}`,
      },
    ],
    priorities: ceo.priorities.map((p) => ({
      id: p.id, severity: p.severity, category: p.category, title: p.title, detail: p.detail,
      recommendedNextStep: p.recommendedNextStep, source: p.source, actionHref: p.actionHref,
    })),
    complianceIssues: ceo.complianceIssues.map((c) => ({
      // Kept as the raw ChannelKey (never a label) — consistent with `channels[].channel`
      // below and required for `ai/actions/validate.ts` to match it against
      // `RawActionIntent.channel` (also a raw key). Labelled only at render
      // time, by `serializeFactBundle`/`offlineAnswer.ts`/the UI.
      productId: c.productId, sku: c.sku, title: c.title, channel: c.channel,
      verdict: c.verdict, blockingReasons: c.blockingReasons,
    })),
    channels: ceo.financialPerformance.channels.map((c) => ({
      channel: c.channel, label: c.label,
      revenue: moneyMetric(c.sales.revenue), netRevenue: moneyMetric(c.sales.netRevenue),
      knownNetMarginPct: isKnown(c.profit.averageNetMarginPct) ? c.profit.averageNetMarginPct.value : null,
      lossMakingProductCount: ceo.financialPerformance.lossMakingProducts.filter((p) => p.channel === c.channel).length,
    })),
    topOpportunities: [...input.opportunities]
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 8)
      .map((o) => ({
        id: o.id, title: o.title, band: o.bandLabel, headline: o.headline, score: o.opportunityScore,
        amazonCompliance: o.amazonCompliance, shopifyCompliance: o.shopifyCompliance,
      })),
    opportunitySummary: input.opportunitySummary
      ? {
          total: input.opportunitySummary.total, recommendedForTesting: input.opportunitySummary.recommendedForTesting,
          needsReview: input.opportunitySummary.needsReview, channelDivergent: input.opportunitySummary.channelDivergent,
        }
      : null,
    supplierRisk: [...input.suppliers]
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
      .map((s) => ({
        id: s.id, name: s.name, score: s.score, shopifyStatus: s.shopifyStatus, amazonStatus: s.amazonStatus,
        statusReason: s.statusReason, onTimeRatePct: s.onTimeRatePct,
      })),
    pendingApprovals: ceo.approvals.map((a) => ({
      id: a.id, title: a.title, impact: a.estimatedImpact ? formatMoney(a.estimatedImpact) : null, expiresAt: a.expiresAt,
    })),
    products: (input.products ?? []).map((p) => ({
      id: p.id, sku: p.sku, title: p.title, category: p.category, stage: p.stage,
      channels: CHANNEL_KEYS
        .filter((c) => marginByProductChannel.has(`${p.id}:${c}`))
        .map((c) => ({ channel: c, label: CHANNEL_LABELS[c] ?? c, ...marginByProductChannel.get(`${p.id}:${c}`)! })),
    })),
    advertisingCampaigns: (input.advertisingIntelligence?.campaigns ?? []).map(({ fact: c, classification }) => ({
      campaignKey: c.identity.campaignKey, campaignName: c.identity.campaignName,
      channel: c.identity.channel, isPaused: c.identity.isPaused,
      spend: moneyMetric(c.spend), attributedRevenue: moneyMetric(c.attributedRevenue),
      roas: ratioMetric(c.roas), acosPct: pctMetric(c.acosPct),
      classification: classification.classification, severity: classification.severity, reasons: classification.reasons,
    })),
    advertisingScorecard: input.advertisingIntelligence && input.advertisingIntelligence.scorecard.totalCampaigns > 0
      ? {
          overall: input.advertisingIntelligence.scorecard.overall,
          totalCampaigns: input.advertisingIntelligence.scorecard.totalCampaigns,
          totalSpend: moneyMetric(input.advertisingIntelligence.scorecard.totalSpend),
          overallRoas: ratioMetric(input.advertisingIntelligence.scorecard.overallRoas),
          tacosPct: pctMetric(input.advertisingIntelligence.scorecard.tacosPct),
        }
      : null,
  }
}

/** Turns a `FactBundle` into the plain-text context every provider (real model or offline) reads — one function, so the model and the offline fallback are never fed subtly different views of the same facts. */
export function serializeFactBundle(bundle: FactBundle): string {
  const lines: string[] = []
  lines.push(`Organisation: ${bundle.orgName}${bundle.isDemo ? ' (DEMO MODE — no live database; figures below are honest zeros/unknowns or a simulated business, never real trading data)' : ''}`)
  lines.push(`Facts generated at: ${bundle.generatedAt}`)
  if (bundle.dataSourceFailures.length > 0) lines.push(`WARNING — these data sources failed to load this turn and fell back to a safe empty value: ${bundle.dataSourceFailures.join(', ')}.`)
  if (bundle.currencyCautions.length > 0) {
    lines.push('CURRENCY SAFETY — the following figures are unavailable because they would require mixing incompatible currencies without a safe conversion; do not estimate or infer them:')
    for (const c of bundle.currencyCautions) lines.push(`  - ${c}`)
  }

  lines.push('', `Overall business health: ${bundle.overallHealth.toUpperCase()}`)
  for (const a of bundle.healthAreas) lines.push(`  - ${a.label}: ${a.status.toUpperCase()}${a.reasons.length ? ` — ${a.reasons.join('; ')}` : ''}`)

  lines.push('', 'Executive summary (last 30 days vs previous period):')
  for (const m of bundle.executiveSummary) lines.push(`  - ${m.label}: ${m.value} [${m.status}]`)

  lines.push('', bundle.priorities.length > 0 ? `Priority queue (${bundle.priorities.length} open item(s), most critical first):` : 'Priority queue: empty — nothing currently needs attention.')
  for (const p of bundle.priorities) lines.push(`  - [${p.severity.toUpperCase()}] (${p.category}) ${p.title} — ${p.detail} Next step: ${p.recommendedNextStep} (source: ${p.source}, id: ${p.id})`)

  lines.push('', bundle.complianceIssues.length > 0 ? `Compliance issues (${bundle.complianceIssues.length}):` : 'Compliance issues: none currently blocked or under review.')
  for (const c of bundle.complianceIssues) lines.push(`  - ${c.title} (${c.sku}) on ${CHANNEL_LABELS[c.channel] ?? c.channel}: ${c.verdict === 'fail' ? 'BLOCKED' : 'REVIEW REQUIRED'} — ${c.blockingReasons.join('; ') || 'no reasons recorded'}`)

  lines.push('', 'Channel performance (never blended — each channel is its own figure):')
  for (const c of bundle.channels) lines.push(`  - ${c.label}: revenue ${c.revenue}, net revenue ${c.netRevenue}, known net margin ${c.knownNetMarginPct === null ? 'unknown' : `${c.knownNetMarginPct.toFixed(1)}%`}, ${c.lossMakingProductCount} loss-making product(s)`)

  if (bundle.opportunitySummary) {
    lines.push('', `Opportunity intelligence: ${bundle.opportunitySummary.total} candidate(s) evaluated, ${bundle.opportunitySummary.recommendedForTesting} recommended for testing, ${bundle.opportunitySummary.needsReview} needing review, ${bundle.opportunitySummary.channelDivergent} viable on one channel only.`)
  }
  if (bundle.topOpportunities.length > 0) {
    lines.push('Top opportunities by score:')
    for (const o of bundle.topOpportunities) lines.push(`  - ${o.title} (score ${o.score}, ${o.band}): ${o.headline} [Amazon: ${o.amazonCompliance}, Shopify: ${o.shopifyCompliance}]`)
  }

  if (bundle.supplierRisk.length > 0) {
    lines.push('', 'Suppliers, lowest score (highest risk) first:')
    for (const s of bundle.supplierRisk) lines.push(`  - ${s.name}: score ${s.score}, Shopify ${s.shopifyStatus}, Amazon UK ${s.amazonStatus}${s.statusReason ? ` (${s.statusReason})` : ''}, on-time ${s.onTimeRatePct === null ? 'unknown' : `${s.onTimeRatePct.toFixed(1)}%`}`)
  }

  lines.push('', bundle.pendingApprovals.length > 0 ? `Pending approvals (${bundle.pendingApprovals.length}):` : 'Pending approvals: none.')
  for (const a of bundle.pendingApprovals) lines.push(`  - ${a.title}${a.impact ? ` (${a.impact})` : ''}${a.expiresAt ? ` — expires ${a.expiresAt}` : ''}`)

  const withKnownMargin = bundle.products.filter((p) => p.channels.length > 0).slice(0, 15)
  if (withKnownMargin.length > 0) {
    lines.push('', 'Catalogue products with known per-channel margin (never blended across channels):')
    for (const p of withKnownMargin) {
      for (const c of p.channels) {
        lines.push(`  - ${p.title} (${p.sku}) on ${c.label}: net margin ${c.knownNetMarginPct === null ? 'unknown' : `${c.knownNetMarginPct.toFixed(1)}%`}`)
      }
    }
  }

  if (bundle.advertisingScorecard) {
    lines.push('', `Advertising overall: ${bundle.advertisingScorecard.overall.toUpperCase()} across ${bundle.advertisingScorecard.totalCampaigns} campaign(s) — total spend ${bundle.advertisingScorecard.totalSpend}, overall ROAS ${bundle.advertisingScorecard.overallRoas}, TACOS ${bundle.advertisingScorecard.tacosPct}.`)
  }
  if (bundle.advertisingCampaigns.length > 0) {
    lines.push('Advertising campaigns (never blended across channels; a classification is a deterministic rule outcome, never an AI judgement):')
    for (const c of bundle.advertisingCampaigns) {
      lines.push(`  - ${c.campaignName} on ${CHANNEL_LABELS[c.channel] ?? c.channel}${c.isPaused ? ' [PAUSED]' : ''}: spend ${c.spend}, revenue ${c.attributedRevenue}, ROAS ${c.roas}, ACOS ${c.acosPct} — ${c.classification.toUpperCase()} (${c.severity})${c.reasons.length ? `: ${c.reasons.join(' ')}` : ''}`)
    }
  }

  return lines.join('\n')
}

/**
 * Which facts count as "referenced" this turn — decided entirely by code
 * from the same bundle just built, never parsed out of what the model
 * said. This is what keeps the UI's reference chips 100% grounded: a
 * hallucinated entity in the model's prose simply has no chip, and every
 * chip on screen names a real id this bundle actually contains.
 */
export function deriveReferences(bundle: FactBundle): readonly ChatReference[] {
  const refs: ChatReference[] = []
  for (const p of bundle.priorities.slice(0, 5)) {
    refs.push({ type: 'priority', id: p.id, label: p.title, href: p.actionHref })
  }
  for (const c of bundle.complianceIssues.slice(0, 5)) {
    refs.push({ type: 'compliance', id: c.productId, label: `${c.title} (${CHANNEL_LABELS[c.channel] ?? c.channel})`, href: '/compliance' })
  }
  for (const o of bundle.topOpportunities.slice(0, 3)) {
    refs.push({ type: 'opportunity', id: o.id, label: o.title, href: `/opportunities/${o.id}` })
  }
  for (const s of bundle.supplierRisk.slice(0, 3)) {
    refs.push({ type: 'supplier', id: s.id, label: s.name, href: `/suppliers/${s.id}` })
  }
  for (const c of bundle.channels) {
    refs.push({ type: 'channel', id: c.channel, label: c.label, href: '/marketplaces' })
  }
  for (const a of bundle.pendingApprovals.slice(0, 5)) {
    refs.push({ type: 'approval', id: a.id, label: a.title, href: '/approvals' })
  }
  for (const c of bundle.advertisingCampaigns.filter((c) => c.classification !== 'healthy').slice(0, 5)) {
    refs.push({ type: 'advertising_campaign', id: c.campaignKey, label: `${c.campaignName} (${CHANNEL_LABELS[c.channel] ?? c.channel})`, href: '/advertising' })
  }
  return refs
}
