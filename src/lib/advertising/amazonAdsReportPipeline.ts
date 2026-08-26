import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import {
  decideReportPipelineAction, isReadyForNextWindow, computeReportWindow, normalizeAmazonAdsReportRow,
  type ReportTrackingState, type AmazonAdsReportStatus,
} from './amazonAdsReporting'
import type { AmazonAdsConnector } from './connectors/amazonAds'
import type { NormalizedCampaignFact } from './connectors/types'

/**
 * The server-only orchestrator for the Amazon Ads async report pipeline
 * (Milestone 20, Phases 2/4/5/6/12/13). Every decision (what to do next,
 * which window to request, whether a row is well-formed enough to
 * normalize) is made by the pure functions in `amazonAdsReporting.ts`;
 * this file only performs the actual HTTP calls (via the connector's
 * `requestReport`/`checkReportStatus`/`downloadReport`) and the actual
 * `advertising_connections` reads/writes those decisions need.
 *
 * Called once per invocation, does at most ONE HTTP round trip against
 * Amazon Ads (a request, a status check, or a download — never more than
 * one), and returns immediately either way — never waits, never loops.
 * `advertising/sync.ts` calls this once per maintenance cycle for
 * `amazon_ads` specifically, in place of the generic `connector.fetchCampaigns()`
 * every other provider still uses.
 */

export interface AdvanceReportPipelineResult {
  /** True only when this call actually obtained a completed report's rows this invocation. */
  ready: boolean
  facts: readonly NormalizedCampaignFact[]
  /** Rows so malformed `normalizeAmazonAdsReportRow` could not even build a candidate fact — counted separately from rows the *existing* validator later quarantines. */
  unparseableRows: number
  status: AmazonAdsReportStatus
  detail: string
}

async function loadReportState(orgId: string): Promise<ReportTrackingState> {
  const supabase = createServiceSupabase()
  const { data } = await supabase
    .from('advertising_connections')
    .select('report_status, report_id, report_requested_at, report_completed_at, report_window_start, report_window_end')
    .eq('org_id', orgId)
    .eq('provider', 'amazon_ads')
    .maybeSingle()

  if (!data) return { status: 'not_requested', reportId: null, requestedAt: null, completedAt: null, windowStart: null, windowEnd: null }
  return {
    status: data.report_status as AmazonAdsReportStatus,
    reportId: data.report_id,
    requestedAt: data.report_requested_at,
    completedAt: data.report_completed_at,
    windowStart: data.report_window_start,
    windowEnd: data.report_window_end,
  }
}

interface ReportStatePatch {
  report_status: AmazonAdsReportStatus
  report_id?: string | null
  report_requested_at?: string | null
  report_completed_at?: string | null
  report_window_start?: string | null
  report_window_end?: string | null
  report_error?: string | null
}

async function saveReportState(orgId: string, patch: ReportStatePatch): Promise<void> {
  const supabase = createServiceSupabase()
  await supabase.from('advertising_connections').upsert({ org_id: orgId, provider: 'amazon_ads', ...patch } as never, { onConflict: 'org_id,provider' })
}

/**
 * Which window a fresh report request should cover: the *same* window as
 * a report that just failed or expired (that data was never actually
 * retrieved, so it must be tried again, never silently skipped) versus a
 * genuinely *new* window once the previous one completed successfully
 * (Phase 6 — never re-requesting the entire history, never skipping a
 * period either).
 */
function windowForFreshRequest(state: ReportTrackingState, nowIso: string): { start: string; end: string } {
  if ((state.status === 'failed' || state.status === 'expired') && state.windowStart && state.windowEnd) {
    return { start: state.windowStart, end: state.windowEnd }
  }
  return computeReportWindow(state.windowEnd, nowIso)
}

export async function advanceAmazonAdsReportPipeline(orgId: string, connector: AmazonAdsConnector): Promise<AdvanceReportPipelineResult> {
  const nowIso = new Date().toISOString()
  const state = await loadReportState(orgId)
  const action = decideReportPipelineAction(state, nowIso)

  if (action.action === 'wait') {
    if (!isReadyForNextWindow(state, nowIso)) {
      return { ready: false, facts: [], unparseableRows: 0, status: state.status, detail: 'The current report is complete; not yet time to request the next reporting window.' }
    }
    // Ready to move on to a fresh window — falls through to the same
    // request logic `request_new` uses, just with a *new* window rather
    // than a retried one.
    const window = windowForFreshRequest(state, nowIso)
    return requestFreshReport(orgId, connector, window)
  }

  if (action.action === 'request_new') {
    const window = windowForFreshRequest(state, nowIso)
    return requestFreshReport(orgId, connector, window)
  }

  // action.action === 'check_status'
  const statusResult = await connector.checkReportStatus(action.reportId)
  if (!statusResult.ok) {
    await saveReportState(orgId, { report_status: 'failed', report_error: statusResult.error })
    await recordAudit({
      orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: 'amazon_ads',
      actorType: 'system', result: 'failure', error: statusResult.error, reason: 'Amazon Ads report status check failed.',
    })
    return { ready: false, facts: [], unparseableRows: 0, status: 'failed', detail: statusResult.error }
  }

  if (statusResult.value.status === 'PENDING' || statusResult.value.status === 'PROCESSING') {
    await saveReportState(orgId, { report_status: 'processing' })
    return { ready: false, facts: [], unparseableRows: 0, status: 'processing', detail: `Amazon Ads report ${action.reportId} is still ${statusResult.value.status.toLowerCase()}.` }
  }

  if (statusResult.value.status === 'FAILURE') {
    const detail = statusResult.value.failureReason ?? 'Amazon Ads reported the report as failed, with no further detail.'
    await saveReportState(orgId, { report_status: 'failed', report_error: detail })
    await recordAudit({
      orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: 'amazon_ads',
      actorType: 'system', result: 'failure', error: detail, reason: 'Amazon Ads reported a failed report.',
    })
    return { ready: false, facts: [], unparseableRows: 0, status: 'failed', detail }
  }

  // COMPLETED — download, parse, normalize. A completed report with no
  // download URL is treated the same as a failure: an honest state this
  // codebase cannot act on, never silently ignored.
  if (!statusResult.value.downloadUrl) {
    const detail = 'Amazon Ads reported the report as completed, but returned no download URL.'
    await saveReportState(orgId, { report_status: 'failed', report_error: detail })
    return { ready: false, facts: [], unparseableRows: 0, status: 'failed', detail }
  }

  const downloadResult = await connector.downloadReport(statusResult.value.downloadUrl)
  if (!downloadResult.ok) {
    await saveReportState(orgId, { report_status: 'failed', report_error: downloadResult.error })
    await recordAudit({
      orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: 'amazon_ads',
      actorType: 'system', result: 'failure', error: downloadResult.error, reason: 'Amazon Ads report download/parse failed.',
    })
    return { ready: false, facts: [], unparseableRows: 0, status: 'failed', detail: downloadResult.error }
  }

  const facts: NormalizedCampaignFact[] = []
  let unparseableRows = 0
  const context = { externalAccountId: connector.getProfileId() ?? 'unknown-profile', currency: 'GBP', reportedAt: nowIso }
  for (const row of downloadResult.value) {
    const fact = normalizeAmazonAdsReportRow(row, context)
    if (fact) facts.push(fact)
    else unparseableRows++
  }

  await saveReportState(orgId, { report_status: 'completed', report_completed_at: nowIso, report_error: null })
  await recordAudit({
    orgId, action: 'ADVERTISING_SYNC_FINISHED', entityType: 'advertising_connection', entityId: 'amazon_ads',
    actorType: 'system', result: 'success', reason: 'Amazon Ads report retrieved and parsed.',
    metadata: { rowsReturned: downloadResult.value.length, rowsNormalized: facts.length, unparseableRows },
  })

  return { ready: true, facts, unparseableRows, status: 'completed', detail: `Retrieved ${downloadResult.value.length} report row(s), normalized ${facts.length}.` }
}

async function requestFreshReport(orgId: string, connector: AmazonAdsConnector, window: { start: string; end: string }): Promise<AdvanceReportPipelineResult> {
  const requestResult = await connector.requestReport(window.start, window.end)
  if (!requestResult.ok) {
    await saveReportState(orgId, { report_status: 'failed', report_error: requestResult.error, report_window_start: window.start, report_window_end: window.end })
    await recordAudit({
      orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: 'amazon_ads',
      actorType: 'system', result: 'failure', error: requestResult.error, reason: 'Amazon Ads report request failed.',
    })
    return { ready: false, facts: [], unparseableRows: 0, status: 'failed', detail: requestResult.error }
  }

  await saveReportState(orgId, {
    report_status: 'requested', report_id: requestResult.value.reportId, report_requested_at: new Date().toISOString(),
    report_window_start: window.start, report_window_end: window.end, report_completed_at: null, report_error: null,
  })
  return { ready: false, facts: [], unparseableRows: 0, status: 'requested', detail: `Requested an Amazon Ads report for ${window.start} to ${window.end}.` }
}

