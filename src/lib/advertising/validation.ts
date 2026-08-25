import { err, ok, type Result } from '@/lib/core/result'
import type { NormalizedCampaignFact } from './connectors/types'

/**
 * Phase 5 — data-quality validation (Milestone 15).
 *
 * Pure, no I/O. Sits between "whatever a connector's `fetchCampaigns()`
 * claims to have returned" and "what the sync engine (`advertising/sync.ts`)
 * is allowed to write" — deliberately re-checking every field at runtime
 * rather than trusting `NormalizedCampaignFact`'s compile-time type, because
 * the value on the other end of a real connector call came from an unsafe
 * `as T` cast of untrusted external JSON (the same risk profile every
 * connector in this codebase already has — `shopify.ts`/`amazon.ts` never
 * runtime-validate a response body either). This is the one place that gap
 * is closed for advertising specifically, per this milestone's brief:
 * "reject or quarantine invalid records rather than silently producing
 * misleading analytics."
 *
 * A record that fails validation is never written to the `advertising`
 * table at all — not written with nulls, not written with zeros. It is
 * quarantined (returned in `SyncResult.quarantined`, `advertising/sync.ts`)
 * so a previously-good row for that campaign/day is never overwritten by a
 * bad one, and so the failure is visible rather than silently dropped.
 */

const VALID_CURRENCIES = new Set(['GBP', 'EUR', 'USD', 'CAD', 'AUD'])
const VALID_STATUSES = new Set(['active', 'paused', 'archived', 'unknown'])
const VALID_PROVIDERS = new Set(['amazon_ads', 'meta_ads', 'google_ads', 'tiktok_ads'])

export interface ValidationFailure {
  field: string
  reason: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isValidPeriodDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // A campaign day cannot be in the future — a real provider never reports one, and a malformed date (e.g. a typo'd year) is exactly what this guards against.
  return parsed.getTime() <= Date.now() + 24 * 60 * 60 * 1000
}

/**
 * Validates one normalized campaign fact. Every check maps directly to
 * this milestone's brief: campaign ID, organisation ID (checked by the
 * caller, which alone knows the intended `orgId` — see `sync.ts`),
 * provider, currency, date, spend, revenue, impressions, clicks,
 * conversions.
 */
export function validateNormalizedCampaignFact(fact: NormalizedCampaignFact): Result<NormalizedCampaignFact, readonly ValidationFailure[]> {
  const failures: ValidationFailure[] = []

  if (!isNonEmptyString(fact.externalCampaignId)) failures.push({ field: 'externalCampaignId', reason: 'Missing or empty external campaign id.' })
  if (!isNonEmptyString(fact.externalAccountId)) failures.push({ field: 'externalAccountId', reason: 'Missing or empty external account id.' })
  if (!isNonEmptyString(fact.campaignName)) failures.push({ field: 'campaignName', reason: 'Missing or empty campaign name.' })
  if (!VALID_PROVIDERS.has(fact.provider)) failures.push({ field: 'provider', reason: `"${String(fact.provider)}" is not a recognised advertising platform.` })
  if (!VALID_STATUSES.has(fact.status)) failures.push({ field: 'status', reason: `"${String(fact.status)}" is not a recognised campaign status.` })
  if (!VALID_CURRENCIES.has(fact.currency)) failures.push({ field: 'currency', reason: `"${String(fact.currency)}" is not a currency this system supports.` })
  if (!isValidPeriodDate(fact.periodDate)) failures.push({ field: 'periodDate', reason: `"${String(fact.periodDate)}" is not a valid, non-future calendar date.` })

  if (!isNonNegativeInteger(fact.spendMinor)) failures.push({ field: 'spendMinor', reason: 'Spend must be a non-negative whole number of minor currency units.' })
  if (!isNonNegativeInteger(fact.revenueMinor)) failures.push({ field: 'revenueMinor', reason: 'Revenue must be a non-negative whole number of minor currency units.' })
  if (!isNonNegativeInteger(fact.impressions)) failures.push({ field: 'impressions', reason: 'Impressions must be a non-negative whole number.' })
  if (!isNonNegativeInteger(fact.clicks)) failures.push({ field: 'clicks', reason: 'Clicks must be a non-negative whole number.' })
  if (!isNonNegativeInteger(fact.conversions)) failures.push({ field: 'conversions', reason: 'Conversions must be a non-negative whole number.' })

  // Sanity checks — only meaningful once the individual fields above are
  // already known-good numbers, so these run last and only add to
  // `failures` rather than assuming their inputs are valid.
  if (isNonNegativeInteger(fact.clicks) && isNonNegativeInteger(fact.impressions) && fact.clicks > fact.impressions) {
    failures.push({ field: 'clicks', reason: `Clicks (${fact.clicks}) cannot exceed impressions (${fact.impressions}).` })
  }
  if (isNonNegativeInteger(fact.conversions) && isNonNegativeInteger(fact.clicks) && fact.conversions > fact.clicks) {
    failures.push({ field: 'conversions', reason: `Conversions (${fact.conversions}) cannot exceed clicks (${fact.clicks}).` })
  }

  if (fact.dailyBudgetMinor !== null && !isNonNegativeInteger(fact.dailyBudgetMinor)) {
    failures.push({ field: 'dailyBudgetMinor', reason: 'Daily budget, when present, must be a non-negative whole number of minor currency units.' })
  }

  return failures.length > 0 ? err(failures) : ok(fact)
}

export interface ValidationBatchResult {
  valid: readonly NormalizedCampaignFact[]
  quarantined: readonly { fact: NormalizedCampaignFact; failures: readonly ValidationFailure[] }[]
}

/** Validates a batch, splitting into what can safely be synced and what must be quarantined — never throws, never drops a record silently (a quarantined record is still reported, just not written). */
export function validateNormalizedCampaignFacts(facts: readonly NormalizedCampaignFact[]): ValidationBatchResult {
  const valid: NormalizedCampaignFact[] = []
  const quarantined: { fact: NormalizedCampaignFact; failures: readonly ValidationFailure[] }[] = []

  for (const fact of facts) {
    const result = validateNormalizedCampaignFact(fact)
    if (result.ok) valid.push(result.value)
    else quarantined.push({ fact, failures: result.error })
  }

  return { valid, quarantined }
}
