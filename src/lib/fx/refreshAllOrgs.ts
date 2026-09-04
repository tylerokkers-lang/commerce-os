import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { getSupabaseFxStore } from './fxStore'
import { frankfurterFxProvider } from './providers/frankfurter'
import { refreshFxRates, type FxIngestOutcome } from './ingest'
import { getLiveSubjects } from '@/lib/monitoring/liveSubjects'
import type { FxPairSubject } from '@/lib/monitoring/monitors/fxMonitor'
import type { CurrencyCode } from '@/lib/core/money'

export interface OrgFxRefreshResult {
  orgId: string
  outcomes: readonly FxIngestOutcome[]
}

/**
 * Real FX rate ingestion, wired into the same scheduled maintenance
 * orchestrator every other subsystem runs through (`automation/maintenance.ts`)
 * — never a second scheduler. Mirrors `monitoring/scheduledRun.ts`'s own
 * "list every org, do the real work per org" shape exactly.
 *
 * Pairs to refresh are derived from the *existing* `fx_rates` monitor's
 * own subject discovery (`getLiveSubjects(orgId, 'fx_rates')` ->
 * `discoverFxPairs`, org's base currency against every market currency)
 * — never a second, invented "which pairs matter" list. Both directions
 * of each pair are refreshed: the discovered direction (this org's base
 * currency -> a market currency, e.g. GBP->USD) is what the existing
 * `fx_rates` monitor already watches for staleness; its inverse
 * (USD->GBP) is what Product Intelligence actually needs to convert a
 * USD-quoting supplier's cost into this org's own channel currency.
 * Fetching both from one real ingestion pass — rather than teaching
 * Product Intelligence to derive one direction from the other
 * arithmetically, which would be a second, undocumented conversion path
 * — keeps `exchange_rates` as the one real, auditable source for either
 * direction.
 */
export async function refreshFxRatesForAllOrgs(): Promise<readonly OrgFxRefreshResult[]> {
  const supabase = createServiceSupabase()
  const { data: orgs, error } = await supabase.from('organisations').select('id')
  if (error) throw new Error(`Could not list organisations for FX refresh: ${error.message}`)

  const store = getSupabaseFxStore()
  const now = new Date()
  const results: OrgFxRefreshResult[] = []

  for (const org of orgs ?? []) {
    const discovery = await getLiveSubjects(org.id, 'fx_rates')
    const discoveredPairs = discovery.subjects as readonly FxPairSubject[]

    const pairs: { base: CurrencyCode; quote: CurrencyCode }[] = []
    const seen = new Set<string>()
    for (const pair of discoveredPairs) {
      const base = pair.base as CurrencyCode
      const quote = pair.quote as CurrencyCode
      for (const [b, q] of [
        [base, quote],
        [quote, base],
      ] as const) {
        const key = `${b}:${q}`
        if (!seen.has(key)) {
          seen.add(key)
          pairs.push({ base: b, quote: q })
        }
      }
    }

    const outcomes = await refreshFxRates(org.id, pairs, store, frankfurterFxProvider, 'productEvaluation', now)
    results.push({ orgId: org.id, outcomes })
  }

  return results
}
