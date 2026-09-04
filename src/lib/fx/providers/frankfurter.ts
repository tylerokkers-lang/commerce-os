import { err, ok, type Result } from '@/lib/core/result'
import type { CurrencyCode } from '@/lib/core/money'
import type { ExchangeRateFact } from '../types'

/**
 * Frankfurter (Milestone: FX rate ingestion) — the real, live FX provider
 * chosen for this integration. Verified directly (not assumed) before
 * writing any code: a genuinely free, no-API-key, no-signup public API
 * (`GET /v1/latest?from=X&to=Y`) publishing European Central Bank
 * reference rates, actively maintained, open source
 * (github.com/lineofflight/frankfurter). No cost, no credential to
 * manage or leak, no rate-limit budget to track for this org's own
 * low-volume daily refresh — the appropriate choice for a
 * budget-conscious internal system, not a paid commercial FX API this
 * milestone was never asked to justify spending on.
 *
 * `https://api.frankfurter.app` (the documented entry point) 301-redirects
 * to `https://api.frankfurter.dev/v1` — confirmed live before writing
 * this file; the `.dev` host is used directly so production code never
 * depends on following a redirect.
 */

const FRANKFURTER_BASE_URL = 'https://api.frankfurter.dev/v1'
const REQUEST_TIMEOUT_MS = 10_000

/** Not a secret — a plain, human-readable attribution string stored alongside every rate this provider supplies, so `exchange_rates.source` always answers "where did this come from." */
export const FRANKFURTER_SOURCE_LABEL = 'frankfurter.dev (ECB reference rates)'

export type FxProviderError =
  | { reason: 'network_error'; detail: string }
  | { reason: 'http_error'; detail: string }
  | { reason: 'invalid_response'; detail: string }
  | { reason: 'wrong_pair'; detail: string }
  | { reason: 'invalid_rate'; detail: string }

export interface FxProvider {
  fetchRate(base: CurrencyCode, quote: CurrencyCode): Promise<Result<ExchangeRateFact, FxProviderError>>
}

interface FrankfurterResponse {
  amount?: number
  base?: string
  date?: string
  rates?: Record<string, number>
}

/**
 * Fetches one currency pair's latest rate. Every failure mode returns a
 * typed `err(...)` — never throws, never returns a plausible-looking
 * fallback. Validates the response shape, that the returned base matches
 * what was requested (a provider bug or a misconfigured request must
 * never be silently accepted), that the requested quote is actually
 * present, and that the rate itself is a finite positive number — the
 * same discipline `cjdropshipping.ts`'s `cjRequest` already established
 * for this codebase's other external HTTP integrations.
 */
export const frankfurterFxProvider: FxProvider = {
  async fetchRate(base: CurrencyCode, quote: CurrencyCode): Promise<Result<ExchangeRateFact, FxProviderError>> {
    const url = `${FRANKFURTER_BASE_URL}/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } catch (error) {
      return err({ reason: 'network_error', detail: error instanceof Error ? error.message : String(error) })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      return err({ reason: 'http_error', detail: `Frankfurter request to ${url} failed: HTTP ${response.status} ${response.statusText}.` })
    }

    const body = (await response.json().catch(() => null)) as FrankfurterResponse | null
    if (!body || typeof body.base !== 'string' || typeof body.date !== 'string' || typeof body.rates !== 'object' || body.rates === null) {
      return err({ reason: 'invalid_response', detail: 'Frankfurter response was not structurally valid (missing base/date/rates).' })
    }
    if (body.base !== base) {
      return err({ reason: 'wrong_pair', detail: `Requested base ${base} but the response's own base was "${body.base}".` })
    }
    const rate = body.rates[quote]
    if (rate === undefined) {
      return err({ reason: 'wrong_pair', detail: `Response did not include a rate for quote currency ${quote}.` })
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return err({ reason: 'invalid_rate', detail: `Rate ${rate} is not a usable positive finite number.` })
    }

    return ok({
      base,
      quote,
      rate,
      source: FRANKFURTER_SOURCE_LABEL,
      // Frankfurter's "date" is the ECB reference date (a calendar day,
      // not a timestamp) — midnight UTC on that date is the real, honest
      // observation time; never substituted with "now", which would
      // overstate freshness for a rate that may be a day or more old
      // (ECB does not publish on weekends/holidays).
      observedAt: `${body.date}T00:00:00.000Z`,
      retrievedAt: new Date().toISOString(),
    })
  },
}
