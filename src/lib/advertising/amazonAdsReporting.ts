import type { NormalizedCampaignFact } from './connectors/types'

/**
 * Pure logic behind the Amazon Ads async report pipeline (Milestone 20):
 * the state machine decision, the reporting-window calculation, and the
 * raw-row-to-`NormalizedCampaignFact` adapter. No I/O, no `server-only`
 * import — the same "pure planner, separate server-only writer" split
 * `syncPlan.ts`/`sync.ts` already use, here for the async half
 * specifically. `amazonAdsReportPipeline.ts` is the server-only
 * orchestrator that calls these functions and does the actual HTTP/DB work.
 */

export type AmazonAdsReportStatus = 'not_requested' | 'requested' | 'processing' | 'completed' | 'failed' | 'expired'

export interface ReportTrackingState {
  status: AmazonAdsReportStatus
  reportId: string | null
  requestedAt: string | null
  completedAt: string | null
  windowStart: string | null
  windowEnd: string | null
}

/**
 * Phase 5/13 — how long a report may sit `requested`/`processing` before it
 * is treated as expired rather than checked forever. Amazon Ads reports
 * documented to typically finish within minutes to a couple of hours;
 * 24 hours is deliberately generous headroom, not a guess at Amazon's own
 * SLA — the same reasoning `MAINTENANCE_LOCK_STALE_AFTER_MS` documents for
 * a different kind of staleness. Expiry never triggers an immediate
 * re-request from within the same check — the next maintenance cycle
 * (Phase 4) is what requests a fresh report, so a single pipeline
 * invocation is always O(1) HTTP calls, never a loop.
 */
export const REPORT_EXPIRY_MS = 24 * 60 * 60 * 1000

export type ReportPipelineAction =
  | { action: 'request_new' }
  | { action: 'check_status'; reportId: string }
  | { action: 'wait' }

/**
 * Phase 2/4 — exactly one action per call, never a loop. `nowIso` decides
 * expiry so this stays deterministic and testable without real timers.
 */
export function decideReportPipelineAction(state: ReportTrackingState, nowIso: string): ReportPipelineAction {
  const nowMs = Date.parse(nowIso)

  if (state.status === 'not_requested' || state.status === 'failed' || state.status === 'expired') {
    return { action: 'request_new' }
  }

  if (state.status === 'requested' || state.status === 'processing') {
    if (state.requestedAt && nowMs - Date.parse(state.requestedAt) > REPORT_EXPIRY_MS) {
      // Too old to still be worth checking — the caller marks this
      // `expired` and a fresh request happens on a later invocation, never
      // this one (Phase 13: never repeatedly attempt to retrieve an
      // expired artifact, never loop).
      return { action: 'request_new' }
    }
    if (!state.reportId) return { action: 'request_new' }
    return { action: 'check_status', reportId: state.reportId }
  }

  // 'completed' — nothing to do until the next window is due; the caller
  // (amazonAdsReportPipeline.ts) decides separately whether enough time
  // has passed since `completedAt` to request the *next* window at all,
  // using `isReadyForNextWindow` below. This function only ever describes
  // what to do with the *current* tracked report.
  return { action: 'wait' }
}

/**
 * Phase 5 — idempotency: once a window has been completed, do not request
 * a fresh one on every single maintenance cycle. `MIN_REQUEST_INTERVAL_MS`
 * paces new report requests to roughly once per maintenance interval
 * (15 minutes, `maintenanceHealth.ts`'s `MAINTENANCE_EXPECTED_INTERVAL_MS`)
 * — frequent enough that a 48h-freshness-policy campaign never goes stale
 * for want of a sync, infrequent enough that a completed report is never
 * immediately superseded by a redundant new one on the very next cycle.
 */
export const MIN_REPORT_REQUEST_INTERVAL_MS = 15 * 60_000

export function isReadyForNextWindow(state: ReportTrackingState, nowIso: string): boolean {
  if (state.status !== 'completed' || !state.completedAt) return true
  return Date.parse(nowIso) - Date.parse(state.completedAt) >= MIN_REPORT_REQUEST_INTERVAL_MS
}

export interface ReportWindow {
  start: string
  end: string
}

/**
 * Phase 6 — deterministic reporting windows, never "request entire
 * history every cycle." `OVERLAP_DAYS` re-requests the last few days
 * every time specifically because Amazon Ads' own attributed-sales
 * figures continue to settle for a few days after a campaign day first
 * reports (a click today can convert two days later, revising that day's
 * `attributedSales14d`) — re-pulling and re-upserting those days is how
 * stale-but-already-synced metrics get corrected, never a fabrication;
 * the sync engine's own composite-key upsert (`syncPlan.ts`) already
 * turns a repeated pull into an update, never a duplicate row.
 * `INITIAL_LOOKBACK_DAYS` only applies the very first time a report is
 * ever requested for an org — every subsequent window starts from the
 * previous one's own end minus the overlap, never re-requesting the
 * entire history again.
 */
export const REPORT_OVERLAP_DAYS = 3
export const REPORT_INITIAL_LOOKBACK_DAYS = 30

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function computeReportWindow(previousWindowEnd: string | null, nowIso: string): ReportWindow {
  const now = new Date(nowIso)
  // Amazon Ads reports cannot include "today" reliably (the day is not
  // over) — the most recent reportable day is yesterday.
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() - 1)

  if (!previousWindowEnd) {
    const start = new Date(now)
    start.setUTCDate(start.getUTCDate() - REPORT_INITIAL_LOOKBACK_DAYS)
    return { start: isoDate(start), end: isoDate(end) }
  }

  const start = new Date(`${previousWindowEnd}T00:00:00.000Z`)
  start.setUTCDate(start.getUTCDate() - REPORT_OVERLAP_DAYS)
  // Never request a window that ends before it starts (a previous window
  // already right up to yesterday, checked again moments later).
  const effectiveStart = start.getTime() > end.getTime() ? end : start
  return { start: isoDate(effectiveStart), end: isoDate(end) }
}

/**
 * Phase 8/9 — the raw Amazon Ads Sponsored Products report row shape this
 * adapter expects, named exactly as Amazon's own (unverified — see
 * `amazonAds.ts`'s module comment) Reporting API field names, so the
 * mapping to `NormalizedCampaignFact` below is legible against Amazon's
 * own vocabulary rather than guessed generic names.
 */
export interface RawAmazonAdsReportRow {
  campaignId?: unknown
  campaignName?: unknown
  campaignStatus?: unknown
  date?: unknown
  impressions?: unknown
  clicks?: unknown
  cost?: unknown
  /**
   * 14-day attributed sales in major currency units — Amazon's own
   * "how much revenue this ad is credited with" figure. Mapped to
   * `revenueMinor` below. Deliberately NOT the same thing as
   * `attributedConversions14d` (order count) or
   * `attributedUnitsOrdered14d` (unit count) — see the module comment on
   * `normalizeAmazonAdsReportRow`.
   */
  attributedSales14d?: unknown
  /** Order count attributed within the 14-day window — mapped to `conversions`, never `attributedUnitsOrdered14d` (units can exceed orders on a multi-unit basket). */
  attributedConversions14d?: unknown
}

const STATUS_MAP: Record<string, NormalizedCampaignFact['status']> = {
  ENABLED: 'active', PAUSED: 'paused', ARCHIVED: 'archived',
}

/**
 * Phase 9 — precise metric semantics, documented once here rather than
 * guessed at the call site:
 *
 *   spendMinor    <- `cost` (major units -> minor, rounded to the nearest
 *                    minor unit — Amazon reports cost with two decimal
 *                    places, matching every other money figure in this
 *                    codebase).
 *   revenueMinor  <- `attributedSales14d` — 14-day-attributed sales, NOT
 *                    "conversion value" or "purchases" (Amazon's Reporting
 *                    API exposes several attribution windows; this
 *                    codebase picks 14-day consistently, recorded in
 *                    `attributionModel` below so it is never silently
 *                    assumed by a later reader).
 *   conversions   <- `attributedConversions14d` — attributed *orders*,
 *                    never `attributedUnitsOrdered14d` (units), which can
 *                    legitimately exceed the order count on a multi-unit
 *                    basket and would silently inflate a conversion-rate
 *                    calculation downstream.
 *   dailyBudgetMinor <- always `null`. A campaign report row does not
 *                    carry the campaign's *current* budget (that is a
 *                    separate, not-yet-implemented campaign-list call) —
 *                    never fabricated from a spend figure.
 *   attributionModel <- the literal string `'14-day click'`, stated
 *                    explicitly rather than left for a reader to assume.
 *   currency      <- the org's base currency. Amazon Ads' Sponsored
 *                    Products report rows for the EU marketplace this
 *                    connector targets (`ADS_API_HOST`, `amazonAds.ts`)
 *                    do not carry a currency field at all — cost and
 *                    sales are already denominated in the marketplace's
 *                    own currency, which for the EU/UK Sponsored Products
 *                    endpoint this connector calls is GBP, the same
 *                    documented assumption `liveAdvertisingFacts.ts`/
 *                    `advertisingAnalytics.ts` already make for
 *                    currency-less rows elsewhere in this codebase — not a
 *                    new, conflicting policy.
 *
 * Returns `null` for a row too malformed to even attempt — missing
 * campaign id or an unparseable date — which the pipeline counts
 * separately from a `NormalizedCampaignFact` that reaches the *existing*
 * `validateNormalizedCampaignFact` and fails there (e.g. a syntactically
 * present but negative `cost`). Never a second validation system: this
 * function only decides whether a row can be turned into a candidate fact
 * at all; whether that candidate fact is actually good enough to sync is
 * `validation.ts`'s call alone.
 */
export function normalizeAmazonAdsReportRow(row: RawAmazonAdsReportRow, context: { externalAccountId: string; currency: string; reportedAt: string }): NormalizedCampaignFact | null {
  const campaignId = row.campaignId !== undefined && row.campaignId !== null ? String(row.campaignId).trim() : ''
  if (campaignId.length === 0) return null

  const date = typeof row.date === 'string' ? row.date : null
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

  const status = typeof row.campaignStatus === 'string' ? (STATUS_MAP[row.campaignStatus] ?? 'unknown') : 'unknown'
  const campaignName = typeof row.campaignName === 'string' && row.campaignName.trim().length > 0 ? row.campaignName : `Campaign ${campaignId}`

  const cost = typeof row.cost === 'number' ? row.cost : Number(row.cost)
  const sales = typeof row.attributedSales14d === 'number' ? row.attributedSales14d : Number(row.attributedSales14d)
  const conversions = typeof row.attributedConversions14d === 'number' ? row.attributedConversions14d : Number(row.attributedConversions14d)
  const impressions = typeof row.impressions === 'number' ? row.impressions : Number(row.impressions)
  const clicks = typeof row.clicks === 'number' ? row.clicks : Number(row.clicks)

  return {
    provider: 'amazon_ads',
    externalAccountId: context.externalAccountId,
    externalCampaignId: campaignId,
    campaignName,
    status,
    periodDate: date,
    impressions: Number.isFinite(impressions) ? Math.round(impressions) : Number.NaN,
    clicks: Number.isFinite(clicks) ? Math.round(clicks) : Number.NaN,
    conversions: Number.isFinite(conversions) ? Math.round(conversions) : Number.NaN,
    spendMinor: Number.isFinite(cost) ? Math.round(cost * 100) : Number.NaN,
    revenueMinor: Number.isFinite(sales) ? Math.round(sales * 100) : Number.NaN,
    currency: context.currency as never,
    dailyBudgetMinor: null,
    attributionModel: '14-day click',
    reportedAt: context.reportedAt,
  }
}
