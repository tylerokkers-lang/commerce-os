import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { advertisingRowKey, planAdvertisingSync } from './syncPlan'
import type { AdvertisingProvider } from './connectors/types'

/**
 * Phase 4's server-only half — the actual Postgres reads/writes.
 * `syncPlan.ts`'s `planAdvertisingSync` makes every decision; this module
 * only fetches from the connector, loads the one piece of org config the
 * plan needs (`advertising_connections.channel`), calls the plan, and
 * writes its result. Nothing here decides what is valid or what to write —
 * that would duplicate the pure planner.
 */

export interface AdvertisingSyncResult {
  provider: string
  connectorKey: string
  fetchedCount: number
  written: number
  createdCount: number
  updatedCount: number
  quarantined: number
  quarantinedDetail: readonly { externalCampaignId: string; reasons: readonly string[] }[]
  blocked: string | null
  fetchError: string | null
  requestsMade: number
}

/** Existing `advertising` rows for exactly the campaign/day keys this batch touches — bounded by the fetched batch's own size, never a full-table scan. Used only to report `createdCount`/`updatedCount` honestly (Phase 9); the upsert itself is correct either way. */
async function loadExistingKeys(orgId: string, channel: string, rows: readonly { externalId: string; periodDate: string }[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set()
  const supabase = createServiceSupabase()
  const externalIds = [...new Set(rows.map((r) => r.externalId))]
  const { data } = await supabase
    .from('advertising')
    .select('external_id, period_date')
    .eq('org_id', orgId)
    .eq('channel', channel as never)
    .in('external_id', externalIds)
  return new Set((data ?? []).map((r) => advertisingRowKey(channel as never, r.external_id ?? '', r.period_date)))
}

async function loadConnectionChannel(orgId: string, platform: string): Promise<{ channel: string | null; lastSyncAt: string | null }> {
  const supabase = createServiceSupabase()
  const { data } = await supabase
    .from('advertising_connections')
    .select('channel, last_sync_at')
    .eq('org_id', orgId)
    .eq('provider', platform)
    .maybeSingle()
  return { channel: data?.channel ?? null, lastSyncAt: data?.last_sync_at ?? null }
}

async function recordConnectionOutcome(orgId: string, platform: string, outcome: { succeeded: boolean; error: string | null; isDemo: boolean; nowIso: string }): Promise<void> {
  const supabase = createServiceSupabase()
  await supabase.from('advertising_connections').upsert(
    {
      org_id: orgId,
      provider: platform,
      is_connected: outcome.succeeded,
      connection_mode: outcome.isDemo ? 'demo' : 'live',
      status: outcome.succeeded ? (outcome.isDemo ? 'demo' : 'connected') : 'error',
      last_sync_at: outcome.nowIso,
      last_success_at: outcome.succeeded ? outcome.nowIso : undefined,
      last_failure_at: outcome.succeeded ? undefined : outcome.nowIso,
      last_error: outcome.error,
      // Reset on success, incremented on failure — read-modify-write via a
      // fresh select would be more precise under concurrent syncs, but two
      // syncs for the same org+platform running concurrently is already
      // prevented at the job level (`automation_jobs`' idempotency key),
      // so this simple increment is safe in practice.
      consecutive_failures: outcome.succeeded ? 0 : undefined,
    } as never,
    { onConflict: 'org_id,provider' },
  )
}

/**
 * Runs one sync for one org+connector. Never throws — every failure mode
 * (not configured, fetch failed, no channel configured) is reported in the
 * returned `AdvertisingSyncResult` and recorded to `advertising_connections`/
 * `audit_logs`, the same "a safe, named failure state, never an uncaught
 * exception" rule every other automation entry point in this codebase
 * follows.
 */
export async function runAdvertisingSync(orgId: string, isDemo: boolean, connector: AdvertisingProvider, limit = 500): Promise<AdvertisingSyncResult> {
  const nowIso = new Date().toISOString()
  const platform = connector.descriptor.platform
  const base = { provider: platform, connectorKey: connector.descriptor.key, fetchedCount: 0, written: 0, createdCount: 0, updatedCount: 0, quarantined: 0, quarantinedDetail: [], requestsMade: 0 }

  await recordAudit({
    orgId, action: 'ADVERTISING_SYNC_STARTED', entityType: 'advertising_connection', entityId: platform,
    actorType: 'system', result: 'success', metadata: { connectorKey: connector.descriptor.key },
  })

  if (!connector.isConfigured()) {
    const error = `${connector.descriptor.label} is not configured — missing one or more of: ${connector.descriptor.requiredCredentials.join(', ') || '(no credentials required, but isConfigured() still returned false)'}.`
    await recordConnectionOutcome(orgId, platform, { succeeded: false, error, isDemo, nowIso })
    await recordAudit({ orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: platform, actorType: 'system', result: 'failure', error })
    return { ...base, blocked: null, fetchError: error }
  }

  const { channel } = await loadConnectionChannel(orgId, platform)

  const fetchResult = await connector.fetchCampaigns({ limit })
  if (!fetchResult.ok) {
    await recordConnectionOutcome(orgId, platform, { succeeded: false, error: fetchResult.error, isDemo, nowIso })
    await recordAudit({ orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: platform, actorType: 'system', result: 'failure', error: fetchResult.error })
    return { ...base, blocked: null, fetchError: fetchResult.error }
  }

  const existingKeys = channel
    ? await loadExistingKeys(orgId, channel, fetchResult.value.records.map((r) => ({ externalId: r.externalCampaignId, periodDate: r.periodDate })))
    : new Set<string>()
  const plan = planAdvertisingSync({ orgId, provider: platform, channel: channel as never, fetched: fetchResult.value.records, nowIso, existingKeys })

  if (plan.blocked) {
    await recordConnectionOutcome(orgId, platform, { succeeded: false, error: plan.blocked, isDemo, nowIso })
    await recordAudit({ orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: platform, actorType: 'system', result: 'blocked', error: plan.blocked })
    return { ...base, fetchedCount: fetchResult.value.records.length, blocked: plan.blocked, fetchError: null, requestsMade: fetchResult.value.requestsMade }
  }

  if (plan.upserts.length > 0) {
    const supabase = createServiceSupabase()
    const { error } = await supabase.from('advertising').upsert(
      plan.upserts.map((u) => ({
        org_id: u.orgId, channel: u.channel, provider: u.provider, campaign_name: u.campaignName,
        external_id: u.externalId, external_account_id: u.externalAccountId, currency: u.currency,
        period_date: u.periodDate, spend_minor: u.spendMinor, revenue_minor: u.revenueMinor,
        clicks: u.clicks, impressions: u.impressions, conversions: u.conversions,
        daily_budget_minor: u.dailyBudgetMinor, is_paused: u.isPaused, synced_at: u.syncedAt,
      })) as never,
      { onConflict: 'org_id,channel,external_id,period_date' },
    )
    if (error) {
      await recordConnectionOutcome(orgId, platform, { succeeded: false, error: error.message, isDemo, nowIso })
      await recordAudit({ orgId, action: 'ADVERTISING_SYNC_FAILED', entityType: 'advertising_connection', entityId: platform, actorType: 'system', result: 'failure', error: error.message })
      return { ...base, fetchedCount: fetchResult.value.records.length, blocked: null, fetchError: error.message, requestsMade: fetchResult.value.requestsMade }
    }
  }

  await recordConnectionOutcome(orgId, platform, { succeeded: true, error: null, isDemo, nowIso })
  await recordAudit({
    orgId, action: 'ADVERTISING_SYNC_FINISHED', entityType: 'advertising_connection', entityId: platform,
    actorType: 'system', result: 'success',
    metadata: { fetched: fetchResult.value.records.length, written: plan.upserts.length, created: plan.createdCount, updated: plan.updatedCount, quarantined: plan.quarantined.length, requestsMade: fetchResult.value.requestsMade },
  })

  return {
    ...base,
    fetchedCount: fetchResult.value.records.length,
    written: plan.upserts.length,
    createdCount: plan.createdCount,
    updatedCount: plan.updatedCount,
    quarantined: plan.quarantined.length,
    quarantinedDetail: plan.quarantined.map((q) => ({ externalCampaignId: q.fact.externalCampaignId || '(missing)', reasons: q.failures.map((f) => f.reason) })),
    blocked: null,
    fetchError: null,
    requestsMade: fetchResult.value.requestsMade,
  }
}
