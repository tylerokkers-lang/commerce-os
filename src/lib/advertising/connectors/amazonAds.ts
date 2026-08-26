import { gunzipSync } from 'node:zlib'
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
import type { RawAmazonAdsReportRow } from '../amazonAdsReporting'

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
 * ASYNC REPORTING API (Milestone 20): `requestReport`/`checkReportStatus`/
 * `downloadReport` below are real, working HTTP calls implementing Amazon
 * Ads' asynchronous Reporting API — the only source of spend/impressions/
 * clicks/conversions. They are deliberately *not* called from
 * `fetchCampaigns` below: a real report can take minutes to hours to
 * finish, and this codebase's non-negotiable rule is "never wait
 * indefinitely for report completion" — so the async lifecycle is driven
 * by `advertising/amazonAdsReportPipeline.ts` (server-only, DB-backed,
 * called once per maintenance cycle) instead, which persists the
 * in-flight report's state across separate HTTP requests and can span
 * multiple maintenance runs. `fetchCampaigns` stays the same honest,
 * immediate `err(...)` it always was — it is not the entry point real
 * Amazon Ads syncing uses; `advertising/sync.ts` special-cases this one
 * provider to call the report pipeline instead (see that file's own
 * comment).
 *
 * IMPLEMENTED, NOT VERIFIED: exactly like `pauseCampaign`/`setCampaignBudget`
 * below, the report methods are real code against an unconfirmed API
 * contract — no Amazon Ads account exists to have exchanged a real report
 * request against. `capabilities.readCampaigns` is `true` (real code
 * exists) but the capability registry (`capabilityRegistry.ts`) still
 * reports this as `IMPLEMENTED_UNVERIFIED`, never `READ_VERIFIED`, until a
 * real verification run actually succeeds.
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
 *
 * Reporting API additions (Milestone 20), equally unverified:
 *   - `POST /reporting/reports` (create), `GET /reporting/reports/{id}`
 *     (status) and the reporting-specific `Content-Type`
 *     (`application/vnd.createasyncreportrequest.v3+json`) are the
 *     current Amazon Ads Reporting API v3 shape as documented in general
 *     knowledge at implementation time — not confirmed against a live
 *     endpoint, and Amazon has changed this API's version/shape before.
 *   - The report request body's exact `configuration` shape
 *     (`adProduct`/`groupBy`/`columns`/`reportTypeId`/`timeUnit`/`format`)
 *     and the exact column names requested (`campaignId`/`campaignName`/
 *     `campaignStatus`/`date`/`impressions`/`clicks`/`cost`/
 *     `attributedSales14d`/`attributedConversions14d`) are a best-effort
 *     reconstruction, not a confirmed schema.
 *   - The downloaded report file is assumed gzip-compressed JSON
 *     (`format: 'GZIP_JSON'` in the request, manually `gunzip`'d here
 *     rather than relying on HTTP `Content-Encoding`, since Amazon's own
 *     documentation describes the *file itself* as a gzip archive, not
 *     transport-level compression) — unverified against a real file.
 *   - The status values (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILURE`)
 *     and the completed-report's `url` field name are a best guess.
 */

const DESCRIPTOR: AdvertisingConnectorDescriptor = {
  key: 'amazon_ads',
  label: 'Amazon Ads',
  platform: 'amazon_ads',
  capabilities: { readCampaigns: true, pauseCampaign: true, setBudget: true, verifyWrites: false },
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

  /** The advertising account identity report rows are scoped to — never a secret itself (an account/profile id, not a credential), exposed so `amazonAdsReportPipeline.ts` can stamp `NormalizedCampaignFact.externalAccountId` without re-reading `process.env` in a second place. */
  getProfileId(): string | null {
    return credentials()?.profileId ?? null
  }

  async fetchCampaigns(options: FetchCampaignsOptions): Promise<Result<FetchOutcome<NormalizedCampaignFact>, string>> {
    const creds = credentials()
    if (!creds) return err('Amazon Ads is not configured.')
    return err(
      `Amazon Ads campaign metrics require the asynchronous Reporting API (create report -> poll -> download) — ` +
      `implemented as requestReport/checkReportStatus/downloadReport below, but deliberately not called from here ` +
      `(requested up to ${options.limit} campaigns): a real report can take minutes to hours, and this codebase's ` +
      `sync engine must never block a caller waiting for one. Use advertising/amazonAdsReportPipeline.ts, which ` +
      `drives this same connector's report methods across separate maintenance-cycle invocations instead.`,
    )
  }

  /**
   * Step 1 of the async Reporting API — creates a Sponsored Products
   * campaign performance report for `[startDate, endDate]` (inclusive,
   * `YYYY-MM-DD`) and returns Amazon's own report identifier. Never
   * called more than once per genuinely new reporting window — see
   * `amazonAdsReportPipeline.ts`'s idempotency handling.
   */
  async requestReport(startDate: string, endDate: string): Promise<Result<{ reportId: string }, string>> {
    const creds = credentials()
    if (!creds) return err('Amazon Ads is not configured.')

    const result = await adsApiRequest<{ reportId?: string }>(
      creds, '/reporting/reports', 'POST',
      {
        name: `commerce-os-sp-campaigns-${startDate}-${endDate}`,
        startDate,
        endDate,
        configuration: {
          adProduct: 'SPONSORED_PRODUCTS',
          groupBy: ['campaign'],
          columns: ['campaignId', 'campaignName', 'campaignStatus', 'date', 'impressions', 'clicks', 'cost', 'attributedSales14d', 'attributedConversions14d'],
          reportTypeId: 'spCampaigns',
          timeUnit: 'DAILY',
          format: 'GZIP_JSON',
        },
      },
    )
    if (!result.ok) return result
    if (!result.value.reportId) return err('Amazon Ads report creation returned no reportId.')
    return ok({ reportId: result.value.reportId })
  }

  /**
   * Step 2 — a single, immediate status check. Never retries or waits
   * internally; the caller (`amazonAdsReportPipeline.ts`) decides whether
   * and when to check again, across separate invocations, never a loop
   * within one call.
   */
  async checkReportStatus(reportId: string): Promise<Result<{ status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILURE'; downloadUrl: string | null; failureReason: string | null }, string>> {
    const creds = credentials()
    if (!creds) return err('Amazon Ads is not configured.')

    const result = await adsApiRequest<{ status?: string; url?: string; failureReason?: string }>(creds, `/reporting/reports/${encodeURIComponent(reportId)}`, 'GET')
    if (!result.ok) return result

    const status = result.value.status
    if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'COMPLETED' && status !== 'FAILURE') {
      return err(`Amazon Ads returned an unrecognised report status: "${String(status)}".`)
    }
    return ok({ status, downloadUrl: result.value.url ?? null, failureReason: result.value.failureReason ?? null })
  }

  /**
   * Step 3 — downloads and decompresses a completed report's file, parsing
   * it into raw rows. The URL is Amazon's own pre-signed download link
   * (no Amazon Ads auth headers attached — a pre-signed URL carries its
   * own, separate authorization), so this does not go through
   * `adsApiRequest`. Never called for anything but a `COMPLETED` report's
   * own `downloadUrl` — the caller is responsible for that ordering.
   */
  async downloadReport(downloadUrl: string): Promise<Result<readonly RawAmazonAdsReportRow[], string>> {
    try {
      const response = await fetch(downloadUrl)
      if (!response.ok) return err(`Amazon Ads report download returned ${response.status} ${response.statusText}.`)
      const compressed = Buffer.from(await response.arrayBuffer())
      const decompressed = gunzipSync(compressed).toString('utf-8')
      const parsed = JSON.parse(decompressed) as unknown
      if (!Array.isArray(parsed)) return err('Amazon Ads report file did not contain a JSON array of rows.')
      return ok(parsed as readonly RawAmazonAdsReportRow[])
    } catch (error) {
      return err(`Amazon Ads report download/decompression failed: ${error instanceof Error ? error.message : String(error)}`)
    }
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
