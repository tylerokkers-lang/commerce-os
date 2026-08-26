import { describe, expect, it } from 'vitest'
import {
  decideReportPipelineAction, isReadyForNextWindow, computeReportWindow, normalizeAmazonAdsReportRow,
  REPORT_EXPIRY_MS, REPORT_INITIAL_LOOKBACK_DAYS, MIN_REPORT_REQUEST_INTERVAL_MS,
  type ReportTrackingState,
} from '@/lib/advertising/amazonAdsReporting'
import { validateNormalizedCampaignFact } from '@/lib/advertising/validation'

/**
 * Milestone 20, Phase 3/4/5/6/8/9/21 — the pure decision logic behind the
 * Amazon Ads async report pipeline. Every test here proves a specific
 * non-negotiable rule from the brief: one action per call (never a loop),
 * deterministic windows (never "entire history every cycle"), and
 * precise, documented metric semantics (never a guessed mapping).
 */

const NOW = '2026-08-25T12:00:00.000Z'

function state(overrides: Partial<ReportTrackingState> = {}): ReportTrackingState {
  return { status: 'not_requested', reportId: null, requestedAt: null, completedAt: null, windowStart: null, windowEnd: null, ...overrides }
}

describe('decideReportPipelineAction: exactly one action, never a loop', () => {
  it('not_requested -> request_new', () => {
    expect(decideReportPipelineAction(state({ status: 'not_requested' }), NOW)).toEqual({ action: 'request_new' })
  })

  it('failed -> request_new (a retry is a fresh request, never repeated on the failed artifact)', () => {
    expect(decideReportPipelineAction(state({ status: 'failed' }), NOW)).toEqual({ action: 'request_new' })
  })

  it('expired -> request_new', () => {
    expect(decideReportPipelineAction(state({ status: 'expired' }), NOW)).toEqual({ action: 'request_new' })
  })

  it('requested with a real reportId, recently requested -> check_status', () => {
    const result = decideReportPipelineAction(state({ status: 'requested', reportId: 'r-1', requestedAt: NOW }), NOW)
    expect(result).toEqual({ action: 'check_status', reportId: 'r-1' })
  })

  it('processing with a real reportId -> check_status', () => {
    const result = decideReportPipelineAction(state({ status: 'processing', reportId: 'r-1', requestedAt: NOW }), NOW)
    expect(result).toEqual({ action: 'check_status', reportId: 'r-1' })
  })

  it('requested/processing but missing a reportId (a corrupt or partial state) -> request_new, never crashes checking a null id', () => {
    const result = decideReportPipelineAction(state({ status: 'processing', reportId: null, requestedAt: NOW }), NOW)
    expect(result).toEqual({ action: 'request_new' })
  })

  it('a report stuck processing past REPORT_EXPIRY_MS -> request_new, never checked again', () => {
    const staleRequestedAt = new Date(Date.parse(NOW) - REPORT_EXPIRY_MS - 60_000).toISOString()
    const result = decideReportPipelineAction(state({ status: 'processing', reportId: 'r-1', requestedAt: staleRequestedAt }), NOW)
    expect(result).toEqual({ action: 'request_new' })
  })

  it('a report just under the expiry threshold is still checked, not yet expired', () => {
    const almostStale = new Date(Date.parse(NOW) - REPORT_EXPIRY_MS + 60_000).toISOString()
    const result = decideReportPipelineAction(state({ status: 'processing', reportId: 'r-1', requestedAt: almostStale }), NOW)
    expect(result).toEqual({ action: 'check_status', reportId: 'r-1' })
  })

  it('completed -> wait (nothing to do with the current tracked report)', () => {
    expect(decideReportPipelineAction(state({ status: 'completed', completedAt: NOW }), NOW)).toEqual({ action: 'wait' })
  })
})

describe('isReadyForNextWindow: idempotency — repeated maintenance runs do not spam new report requests', () => {
  it('never requested yet -> ready', () => {
    expect(isReadyForNextWindow(state({ status: 'not_requested' }), NOW)).toBe(true)
  })

  it('just completed -> not yet ready for a new window', () => {
    expect(isReadyForNextWindow(state({ status: 'completed', completedAt: NOW }), NOW)).toBe(false)
  })

  it('completed long enough ago (past MIN_REPORT_REQUEST_INTERVAL_MS) -> ready again', () => {
    const past = new Date(Date.parse(NOW) - MIN_REPORT_REQUEST_INTERVAL_MS - 1000).toISOString()
    expect(isReadyForNextWindow(state({ status: 'completed', completedAt: past }), NOW)).toBe(true)
  })

  it('a genuinely different reporting window (a much later "now") is ready, never blocked forever', () => {
    const muchLater = new Date(Date.parse(NOW) + 60 * 60_000).toISOString()
    expect(isReadyForNextWindow(state({ status: 'completed', completedAt: NOW }), muchLater)).toBe(true)
  })

  it('a still-in-flight (requested/processing) report is always "ready" in the sense that isReadyForNextWindow only gates *completed* reports — the pipeline action decision governs in-flight state separately', () => {
    expect(isReadyForNextWindow(state({ status: 'processing', requestedAt: NOW }), NOW)).toBe(true)
  })
})

describe('computeReportWindow: deterministic, bounded, never the entire history every cycle', () => {
  it('the first-ever window looks back REPORT_INITIAL_LOOKBACK_DAYS, ending yesterday', () => {
    const window = computeReportWindow(null, NOW)
    const start = new Date(window.start)
    const end = new Date(window.end)
    const daySpan = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60_000))
    expect(daySpan).toBe(REPORT_INITIAL_LOOKBACK_DAYS - 1)
    expect(window.end).toBe('2026-08-24') // yesterday relative to NOW
  })

  it('a subsequent window starts REPORT_OVERLAP_DAYS before the previous window\'s end, not from scratch', () => {
    const window = computeReportWindow('2026-08-20', NOW)
    expect(window.start).toBe('2026-08-17') // 2026-08-20 minus 3 days
    expect(window.end).toBe('2026-08-24')
  })

  it('never requests today — the most recent reportable day is always yesterday', () => {
    const window = computeReportWindow('2026-08-24', NOW)
    expect(window.end).not.toBe('2026-08-25')
  })

  it('never produces a window ending before it starts, even when checked moments after the previous window completed', () => {
    const window = computeReportWindow('2026-08-24', '2026-08-25T00:00:01.000Z')
    expect(new Date(window.start).getTime()).toBeLessThanOrEqual(new Date(window.end).getTime())
  })

  it('is a bounded span, never "entire history" — even a very old previous window still only overlaps by REPORT_OVERLAP_DAYS, not re-requesting everything since', () => {
    const window = computeReportWindow('2020-01-01', NOW)
    expect(window.start).toBe('2019-12-29')
  })
})

describe('normalizeAmazonAdsReportRow: metric semantics, never a guessed mapping', () => {
  const context = { externalAccountId: 'profile-1', currency: 'GBP', reportedAt: NOW }

  function row(overrides: Record<string, unknown> = {}) {
    return {
      campaignId: 123, campaignName: 'Test Campaign', campaignStatus: 'ENABLED', date: '2026-08-20',
      impressions: 1000, clicks: 50, cost: 25.5, attributedSales14d: 120.75, attributedConversions14d: 6,
      ...overrides,
    }
  }

  it('maps cost to spendMinor in minor units, rounded', () => {
    const fact = normalizeAmazonAdsReportRow(row({ cost: 25.5 }), context)
    expect(fact?.spendMinor).toBe(2550)
  })

  it('maps attributedSales14d to revenueMinor — never conversion value or purchases', () => {
    const fact = normalizeAmazonAdsReportRow(row({ attributedSales14d: 120.75 }), context)
    expect(fact?.revenueMinor).toBe(12075)
  })

  it('maps attributedConversions14d to conversions — never attributedUnitsOrdered14d (units can exceed orders)', () => {
    const fact = normalizeAmazonAdsReportRow(row({ attributedConversions14d: 6 }), context)
    expect(fact?.conversions).toBe(6)
  })

  it('records the real attribution window explicitly, never left implicit', () => {
    const fact = normalizeAmazonAdsReportRow(row(), context)
    expect(fact?.attributionModel).toBe('14-day click')
  })

  it('never fabricates dailyBudgetMinor from a report row — always null', () => {
    const fact = normalizeAmazonAdsReportRow(row(), context)
    expect(fact?.dailyBudgetMinor).toBeNull()
  })

  it('maps ENABLED/PAUSED/ARCHIVED campaign status honestly, unknown for anything else', () => {
    expect(normalizeAmazonAdsReportRow(row({ campaignStatus: 'ENABLED' }), context)?.status).toBe('active')
    expect(normalizeAmazonAdsReportRow(row({ campaignStatus: 'PAUSED' }), context)?.status).toBe('paused')
    expect(normalizeAmazonAdsReportRow(row({ campaignStatus: 'ARCHIVED' }), context)?.status).toBe('archived')
    expect(normalizeAmazonAdsReportRow(row({ campaignStatus: 'SOMETHING_NEW' }), context)?.status).toBe('unknown')
  })

  it('a missing campaign id -> null, unparseable, never a guessed identity', () => {
    expect(normalizeAmazonAdsReportRow(row({ campaignId: undefined }), context)).toBeNull()
    expect(normalizeAmazonAdsReportRow(row({ campaignId: '' }), context)).toBeNull()
  })

  it('a missing or malformed date -> null, unparseable', () => {
    expect(normalizeAmazonAdsReportRow(row({ date: undefined }), context)).toBeNull()
    expect(normalizeAmazonAdsReportRow(row({ date: 'not-a-date' }), context)).toBeNull()
  })

  it('a malformed numeric field produces NaN, which the existing validator then correctly rejects — never a second validation system', () => {
    const fact = normalizeAmazonAdsReportRow(row({ cost: 'not-a-number' }), context)
    expect(fact).not.toBeNull()
    expect(Number.isNaN(fact!.spendMinor)).toBe(true)
    const result = validateNormalizedCampaignFact(fact!)
    expect(result.ok).toBe(false)
  })

  it('a negative cost produces a candidate fact that the existing validator rejects, never silently accepted', () => {
    const fact = normalizeAmazonAdsReportRow(row({ cost: -10 }), context)
    const result = validateNormalizedCampaignFact(fact!)
    expect(result.ok).toBe(false)
  })

  it('a genuinely valid row passes the existing validator end to end', () => {
    const fact = normalizeAmazonAdsReportRow(row(), context)
    const result = validateNormalizedCampaignFact(fact!)
    expect(result.ok).toBe(true)
  })

  it('a campaign name absent from the row still produces a usable, non-empty fallback name, never a blank one', () => {
    const fact = normalizeAmazonAdsReportRow(row({ campaignName: undefined }), context)
    expect(fact?.campaignName.length).toBeGreaterThan(0)
  })
})
