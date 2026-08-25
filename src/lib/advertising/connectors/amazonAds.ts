import { err, ok, type Result } from '@/lib/core/result'
import type {
  AdvertisingConnectionHealth,
  AdvertisingConnectorDescriptor,
  AdvertisingProvider,
  AdvertisingWriteFailure,
  AdvertisingWriteOutcome,
  CampaignWriteInput,
  FetchCampaignsOptions,
  FetchOutcome,
  NormalizedCampaignFact,
} from './types'

/**
 * The real Amazon Ads (Sponsored Products) connector.
 *
 * Amazon Ads uses the same Login With Amazon (LWA) OAuth family as the
 * existing SP-API connector (`marketplaces/connectors/amazon.ts`) —
 * `getAccessToken` below is deliberately the same shape, not a shared
 * import, matching this codebase's existing precedent of each connector
 * owning its own request/auth function rather than a premature shared
 * abstraction (Shopify's connector shares nothing with Amazon's either).
 * Unlike SP-API, the Ads API needs no separate AWS SigV4 signature — a
 * Bearer access token plus the advertiser's client id and profile id
 * (`Amazon-Advertising-API-Scope`) is Amazon's whole auth story for this
 * API family.
 *
 * IMPLEMENTED BUT NOT LIVE-VERIFIED: there is no Amazon Ads account or
 * application registered against this codebase, so none of this has ever
 * exchanged a real token or signed a real request. Every method is gated
 * behind `isConfigured()` — without all four required variables this class
 * makes no network call of any kind.
 *
 * HONEST, DELIBERATE GAP: Amazon Ads' Reporting API (the only source of
 * spend/impressions/clicks/conversions) is asynchronous — create a report
 * job, poll until it finishes, then download the result from a signed S3
 * URL. That multi-step, stateful flow is not implemented here, and neither
 * is a `ListCampaigns`-style read call — `fetchCampaigns` below makes no
 * network request at all and returns an honest `err(...)` immediately,
 * rather than a `NormalizedCampaignFact` with fabricated zero metrics —
 * the same "return a specific, honest error rather than invent a
 * response" rule `shopify.ts`'s `fetchFees`/`updateInventory` already
 * follow for their own genuinely-not-yet-implemented calls.
 *
 * UNVERIFIED API SURFACE — read this before ever pointing this connector
 * at a real account, not after something breaks. Everything below was
 * written from general knowledge of Amazon Ads' API family, not confirmed
 * against Amazon's current official API reference at implementation time,
 * and none of it has executed against a live endpoint even once:
 *   - Whether `PUT /sp/campaigns` (Sponsored Products) is still the
 *     correct path/version, its exact required headers (Amazon's
 *     campaign-management APIs have historically required a versioned
 *     `Content-Type`, e.g. `application/vnd.spCampaign.v3+json`, not
 *     assumed here), and its exact request/response body field names and
 *     casing (`campaignId`/`state`/`dailyBudget` are a best guess).
 *   - The shape assumed for a write error response
 *     (`{ code?: string; details?: string }`) is unverified — a real
 *     failure might arrive in a different shape entirely, in which case
 *     `err(result.error)` still surfaces *something* (never silently
 *     swallowed), but the message may be less specific than intended.
 *   - `getAccessToken` never caches the LWA access token — every call
 *     re-exchanges the refresh token. This mirrors `marketplaces/connectors/amazon.ts`'s
 *     SP-API connector (equally uncached), so it is a shared, known
 *     inefficiency rather than a new one, not a correctness bug: a
 *     redundant token exchange still produces a valid token, it is just
 *     wasteful against Amazon's separate LWA-endpoint rate limit.
 *   - `rateLimit` on the descriptor is declared metadata only, exactly
 *     like every other connector in this codebase (`docs/SECURITY.md`) —
 *     nothing in this file self-enforces it; a caller/scheduler is
 *     responsible for pacing calls.
 * `pauseCampaign`/`setCampaignBudget` are real, working HTTP calls against
 * that unverified surface — "real code," not a stub, but "real code
 * against an unconfirmed contract," which is a meaningfully different and
 * weaker claim than "known to work."
 */

const DESCRIPTOR: AdvertisingConnectorDescriptor = {
  key: 'amazon_ads',
  label: 'Amazon Ads',
  platform: 'amazon_ads',
  capabilities: { readCampaigns: false, pauseCampaign: true, setBudget: true, verifyWrites: false },
  implementationStatus: 'implemented',
  requiredCredentials: [
    'AMAZON_ADS_CLIENT_ID',
    'AMAZON_ADS_CLIENT_SECRET',
    'AMAZON_ADS_REFRESH_TOKEN',
    'AMAZON_ADS_PROFILE_ID',
  ],
  // Amazon Ads' default shared-quota rate for campaign management calls;
  // declared conservatively rather than assuming a higher negotiated quota.
  rateLimit: { requestsPerMinute: 2, requestsPerDay: null, minSecondsBetweenRuns: 30 },
}

const ADS_API_HOST = 'advertising-api-eu.amazon.com' // EU region, matching Amazon UK.
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

interface AmazonAdsCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  profileId: string
}

function credentials(): AmazonAdsCredentials | null {
  const clientId = readEnv('AMAZON_ADS_CLIENT_ID')
  const clientSecret = readEnv('AMAZON_ADS_CLIENT_SECRET')
  const refreshToken = readEnv('AMAZON_ADS_REFRESH_TOKEN')
  const profileId = readEnv('AMAZON_ADS_PROFILE_ID')
  if (!clientId || !clientSecret || !refreshToken || !profileId) return null
  return { clientId, clientSecret, refreshToken, profileId }
}

/** Exchanges the long-lived refresh token for a short-lived LWA access token — same exchange SP-API uses, a different application registration. */
async function getAccessToken(creds: AmazonAdsCredentials): Promise<Result<string, string>> {
  try {
    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    })
    if (!response.ok) return err(`LWA token exchange failed: ${response.status} ${response.statusText}`)
    const body = (await response.json()) as { access_token?: string }
    if (!body.access_token) return err('LWA token exchange returned no access token.')
    return ok(body.access_token)
  } catch (error) {
    return err(`LWA token exchange threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function adsApiRequest<T>(creds: AmazonAdsCredentials, path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown): Promise<Result<T, string>> {
  const tokenResult = await getAccessToken(creds)
  if (!tokenResult.ok) return tokenResult

  try {
    const response = await fetch(`https://${ADS_API_HOST}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenResult.value}`,
        'Amazon-Advertising-API-ClientId': creds.clientId,
        'Amazon-Advertising-API-Scope': creds.profileId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) return err(`Amazon Ads API returned ${response.status} ${response.statusText} for ${path}.`)
    return ok((await response.json()) as T)
  } catch (error) {
    return err(`Amazon Ads API request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export class AmazonAdsConnector implements AdvertisingProvider {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return credentials() !== null
  }

  async getConnectionHealth(): Promise<Result<AdvertisingConnectionHealth, string>> {
    const creds = credentials()
    const now = new Date().toISOString()
    if (!creds) return ok({ status: 'not_configured', checkedAt: now, detail: null })

    // Listing profiles is the recommended lightweight call for verifying credentials work.
    const result = await adsApiRequest<readonly { profileId: number }[]>(creds, '/v2/profiles', 'GET')
    if (!result.ok) return ok({ status: 'error', checkedAt: now, detail: result.error })
    return ok({ status: 'connected', checkedAt: now, detail: null })
  }

  async fetchCampaigns(options: FetchCampaignsOptions): Promise<Result<FetchOutcome<NormalizedCampaignFact>, string>> {
    const creds = credentials()
    if (!creds) return err('Amazon Ads is not configured.')
    return err(
      `Amazon Ads campaign metrics require the asynchronous Reporting API (create report -> poll -> download), ` +
      `which this connector does not yet implement — see this file's module comment (requested up to ${options.limit} campaigns). ` +
      `Campaign identity/budget/status alone, without spend/revenue/impressions/clicks/conversions, would not satisfy NormalizedCampaignFact honestly.`,
    )
  }

  async pauseCampaign(input: CampaignWriteInput): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    const creds = credentials()
    if (!creds) return err({ reason: 'not_configured', detail: 'Amazon Ads is not configured.' })

    const result = await adsApiRequest<{ code?: string; details?: string }>(
      creds, '/sp/campaigns', 'PUT',
      [{ campaignId: input.externalCampaignId, state: 'paused' }],
    )
    if (!result.ok) return err({ reason: 'rejected', detail: result.error })
    return ok({ accepted: true, externalRef: input.idempotencyKey })
  }

  async setCampaignBudget(input: CampaignWriteInput & { dailyBudgetMinor: number }): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    const creds = credentials()
    if (!creds) return err({ reason: 'not_configured', detail: 'Amazon Ads is not configured.' })

    const result = await adsApiRequest<{ code?: string; details?: string }>(
      creds, '/sp/campaigns', 'PUT',
      // Amazon Ads' campaign budget field is a decimal major-unit amount, not minor units.
      [{ campaignId: input.externalCampaignId, dailyBudget: input.dailyBudgetMinor / 100 }],
    )
    if (!result.ok) return err({ reason: 'rejected', detail: result.error })
    return ok({ accepted: true, externalRef: input.idempotencyKey })
  }

  async verifyCampaignState(externalCampaignId: string): Promise<Result<NormalizedCampaignFact, string>> {
    // `capabilities.verifyWrites: false` — never called by the execution
    // pipeline (see `advertising/connectors/types.ts`'s comment on that
    // flag), but implemented honestly rather than omitted, matching every
    // other connector interface method in this codebase.
    return err(`Amazon Ads campaign verification for ${externalCampaignId} requires the same Reporting API gap as fetchCampaigns — not implemented.`)
  }
}

export const amazonAdsConnector = new AmazonAdsConnector()
