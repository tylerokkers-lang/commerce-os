import type { ChannelKey } from '@/lib/core/domain'
import type { AdvertisingPlatform } from '@/lib/analytics/advertisingAnalytics'
import { validateNormalizedCampaignFacts, type ValidationFailure } from './validation'
import type { NormalizedCampaignFact } from './connectors/types'

/**
 * Phase 4 — the sync engine's decision logic (Milestone 15). Pure, no I/O,
 * so it can be driven directly by tests without a database — the same
 * "pure planner, separate server-only writer" split every other
 * database-touching module in this codebase already follows
 * (`advertisingAnalytics.ts`/`liveAdvertisingFacts.ts` being the most
 * direct precedent). `advertising/sync.ts` is the thin, server-only wrapper
 * that calls this, then performs the actual upsert.
 */

/** One row this plan wants written to the `advertising` table — matches every not-null column that table actually has. */
export interface AdvertisingRowUpsert {
  orgId: string
  channel: ChannelKey
  provider: AdvertisingPlatform
  campaignName: string
  externalId: string
  externalAccountId: string
  currency: string
  periodDate: string
  spendMinor: number
  revenueMinor: number
  clicks: number
  impressions: number
  conversions: number
  dailyBudgetMinor: number | null
  isPaused: boolean
  syncedAt: string
}

export interface SyncPlanInput {
  orgId: string
  provider: AdvertisingPlatform
  /** From `advertising_connections.channel` — null when the connection has never had a sales channel configured for it. */
  channel: ChannelKey | null
  fetched: readonly NormalizedCampaignFact[]
  nowIso: string
  /**
   * `channel:externalId:periodDate` keys already present in the
   * `advertising` table for this org, so the plan can honestly report
   * which upserts are genuinely new rows versus updates to ones already
   * synced — never guessed, and entirely optional: an empty set (the
   * default) simply reports every upsert as `created`, which is still
   * true on the very first sync and merely less precise on a repeat one.
   */
  existingKeys?: ReadonlySet<string>
}

/** The exact composite key `advertising`'s own unique constraint uses — the one place this string is built, shared by the planner and `sync.ts`'s existing-row lookup, so the two can never drift apart. */
export function advertisingRowKey(channel: ChannelKey, externalId: string, periodDate: string): string {
  return `${channel}:${externalId}:${periodDate}`
}

export interface SyncPlan {
  upserts: readonly AdvertisingRowUpsert[]
  quarantined: readonly { fact: NormalizedCampaignFact; failures: readonly ValidationFailure[] }[]
  /** Non-null only when the plan could not proceed at all — `upserts` is always empty in that case. A missing-configuration safety gate (Phase 9), not a guess. */
  blocked: string | null
  /** Of `upserts`: how many are genuinely new rows vs. updates to a row already synced — see `existingKeys` above. */
  createdCount: number
  updatedCount: number
}

/**
 * Never overwrites a previously-good row with a worse one: a record that
 * fails validation is quarantined, not written — the row already in the
 * `advertising` table for that campaign/day (if any) is simply left alone,
 * since this plan never produces an upsert entry for it at all. Idempotent
 * by construction: re-running with the exact same `fetched` input produces
 * the exact same `upserts` list, which the caller writes via a
 * composite-key upsert (`org_id, channel, external_id, period_date`) — a
 * repeat sync updates in place, never duplicates.
 */
export function planAdvertisingSync(input: SyncPlanInput): SyncPlan {
  if (!input.channel) {
    return {
      upserts: [],
      quarantined: [],
      blocked: `No sales channel is configured for this ${input.provider} connection — set one on /advertising before syncing.`,
      createdCount: 0,
      updatedCount: 0,
    }
  }

  const channel = input.channel
  const existingKeys = input.existingKeys ?? new Set<string>()
  const { valid, quarantined } = validateNormalizedCampaignFacts(input.fetched)

  const upserts: AdvertisingRowUpsert[] = valid.map((fact) => ({
    orgId: input.orgId,
    channel,
    provider: fact.provider,
    campaignName: fact.campaignName,
    externalId: fact.externalCampaignId,
    externalAccountId: fact.externalAccountId,
    currency: fact.currency,
    periodDate: fact.periodDate,
    spendMinor: fact.spendMinor,
    revenueMinor: fact.revenueMinor,
    clicks: fact.clicks,
    impressions: fact.impressions,
    conversions: fact.conversions,
    dailyBudgetMinor: fact.dailyBudgetMinor,
    isPaused: fact.status === 'paused',
    syncedAt: input.nowIso,
  }))

  const updatedCount = upserts.filter((u) => existingKeys.has(advertisingRowKey(u.channel, u.externalId, u.periodDate))).length

  return { upserts, quarantined, blocked: null, createdCount: upserts.length - updatedCount, updatedCount }
}
