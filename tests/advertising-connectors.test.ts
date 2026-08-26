import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { demoAdvertisingConnector } from '@/lib/advertising/connectors/demo'
import { amazonAdsConnector } from '@/lib/advertising/connectors/amazonAds'
import { allAdvertisingConnectors, advertisingConnectorByKey, connectorForPlatform, advertisingConnectorSummaries } from '@/lib/advertising/connectors/registry'

/**
 * Phase 2/13 — the connector interface and registry (Milestone 15).
 * "Successful connection" / "invalid credentials" / "expired credentials"
 * from the brief's connector test list map to: the demo connector always
 * succeeds (it is always configured), the real Amazon Ads connector and
 * every planned-platform stub always report `isConfigured() === false`
 * with no real credentials in this environment — proving the honest
 * "not configured" path without needing a live API to actually reject a
 * bad token against.
 */

describe('demoAdvertisingConnector: always available, never claims to be live', () => {
  it('isConfigured is always true', () => {
    expect(demoAdvertisingConnector.isConfigured()).toBe(true)
  })

  it('connection health reports demo, never connected', async () => {
    const health = await demoAdvertisingConnector.getConnectionHealth()
    expect(health.ok && health.value.status).toBe('demo')
  })

  it('fetchCampaigns returns real, deterministic campaign data, honouring the limit', async () => {
    const result = await demoAdvertisingConnector.fetchCampaigns({ limit: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.records).toHaveLength(1)
  })
})

describe('demoAdvertisingConnector: SUBMIT -> VERIFY behaviour is real, not a mock', () => {
  it('pausing a real demo campaign is visible to a later verify call', async () => {
    const before = await demoAdvertisingConnector.verifyCampaignState('demo-camp-2')
    expect(before.ok && before.value.status).toBe('active')

    const write = await demoAdvertisingConnector.pauseCampaign({ externalCampaignId: 'demo-camp-2', idempotencyKey: 'test-pause-1' })
    expect(write.ok).toBe(true)

    const after = await demoAdvertisingConnector.verifyCampaignState('demo-camp-2')
    expect(after.ok && after.value.status).toBe('paused')
  })

  it('setting a budget on a real demo campaign is visible to a later verify call', async () => {
    const write = await demoAdvertisingConnector.setCampaignBudget({ externalCampaignId: 'demo-camp-1', idempotencyKey: 'test-budget-1', dailyBudgetMinor: 9999 })
    expect(write.ok).toBe(true)

    const after = await demoAdvertisingConnector.verifyCampaignState('demo-camp-1')
    expect(after.ok && after.value.dailyBudgetMinor).toBe(9999)
  })

  it('pausing an unknown campaign id fails honestly, never silently accepted', async () => {
    const write = await demoAdvertisingConnector.pauseCampaign({ externalCampaignId: 'no-such-campaign', idempotencyKey: 'x' })
    expect(write.ok).toBe(false)
  })

  it('a zero-or-negative budget is rejected, never silently accepted', async () => {
    const write = await demoAdvertisingConnector.setCampaignBudget({ externalCampaignId: 'demo-camp-1', idempotencyKey: 'x', dailyBudgetMinor: 0 })
    expect(write.ok).toBe(false)
  })
})

describe('amazonAdsConnector: real credential gating, no network call without them', () => {
  const CREDENTIAL_KEYS = ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID']
  const originalEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of CREDENTIAL_KEYS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of CREDENTIAL_KEYS) {
      if (originalEnv[key] !== undefined) process.env[key] = originalEnv[key]
      else delete process.env[key]
    }
  })

  it('isConfigured is false with no credentials in the environment', () => {
    expect(amazonAdsConnector.isConfigured()).toBe(false)
  })

  it('connection health reports not_configured, never connected, without credentials', async () => {
    const health = await amazonAdsConnector.getConnectionHealth()
    expect(health.ok && health.value.status).toBe('not_configured')
  })

  it('fetchCampaigns fails honestly without credentials, never returns fabricated data', async () => {
    const result = await amazonAdsConnector.fetchCampaigns({ limit: 10 })
    expect(result.ok).toBe(false)
  })

  it('pauseCampaign fails with reason "not_configured" without credentials', async () => {
    const result = await amazonAdsConnector.pauseCampaign({ externalCampaignId: 'x', idempotencyKey: 'y' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.reason).toBe('not_configured')
  })

  it('isConfigured is still false with only some of the four required credentials set — partial credentials are not enough', () => {
    process.env.AMAZON_ADS_CLIENT_ID = 'test-id'
    process.env.AMAZON_ADS_CLIENT_SECRET = 'test-secret'
    expect(amazonAdsConnector.isConfigured()).toBe(false)
  })

  it('declares real capabilities honestly: can write (pause/budget), can read via the async report pipeline (Milestone 20), cannot verify writes', () => {
    expect(amazonAdsConnector.descriptor.capabilities.pauseCampaign).toBe(true)
    expect(amazonAdsConnector.descriptor.capabilities.setBudget).toBe(true)
    expect(amazonAdsConnector.descriptor.capabilities.readCampaigns).toBe(true)
    expect(amazonAdsConnector.descriptor.capabilities.verifyWrites).toBe(false)
  })

  it('fetchCampaigns itself still always errors honestly — the real read path is advertising/amazonAdsReportPipeline.ts, never a fabricated empty success from this method', async () => {
    const result = await amazonAdsConnector.fetchCampaigns({ limit: 10 })
    expect(result.ok).toBe(false)
  })
})

describe('registry: planned platforms are honest stubs, never mistaken for working connectors', () => {
  it('every platform is registered', () => {
    const platforms = allAdvertisingConnectors().map((c) => c.descriptor.platform)
    expect(new Set(platforms)).toEqual(new Set(['amazon_ads', 'meta_ads', 'google_ads', 'tiktok_ads']))
  })

  it('meta_ads, google_ads and tiktok_ads are never configured and fail every call honestly', async () => {
    for (const key of ['meta_ads', 'google_ads', 'tiktok_ads']) {
      const connector = advertisingConnectorByKey(key)
      expect(connector).not.toBeNull()
      expect(connector!.isConfigured()).toBe(false)
      const fetchResult = await connector!.fetchCampaigns({ limit: 10 })
      expect(fetchResult.ok).toBe(false)
      const pauseResult = await connector!.pauseCampaign({ externalCampaignId: 'x', idempotencyKey: 'y' })
      expect(pauseResult.ok).toBe(false)
      if (!pauseResult.ok) expect(pauseResult.error.reason).toBe('not_configured')
    }
  })

  it('an unknown connector key returns null, never throws', () => {
    expect(advertisingConnectorByKey('not_a_real_key')).toBeNull()
  })
})

describe('connectorForPlatform: demo mode always returns the demo connector, live mode never does', () => {
  it('demo mode returns the demo connector regardless of platform', () => {
    expect(connectorForPlatform('google_ads', true)).toBe(demoAdvertisingConnector)
    expect(connectorForPlatform('tiktok_ads', true)).toBe(demoAdvertisingConnector)
  })

  it('live mode returns the real (or stub) connector for that platform, never the demo one', () => {
    expect(connectorForPlatform('amazon_ads', false)).toBe(amazonAdsConnector)
    expect(connectorForPlatform('meta_ads', false)).not.toBe(demoAdvertisingConnector)
  })
})

describe('advertisingConnectorSummaries: what /advertising renders', () => {
  it('reports missing credentials for every unconfigured platform, and never reports "connected" without real state', () => {
    const summaries = advertisingConnectorSummaries(new Map())
    expect(summaries).toHaveLength(4)
    for (const s of summaries) {
      expect(s.isConfigured).toBe(false)
      expect(s.status).not.toBe('connected')
      expect(s.missingCredentials.length).toBeGreaterThan(0)
    }
  })

  it('reflects persisted connection state (last sync/error) when supplied, never fabricating it', () => {
    const connections = new Map([['amazon_ads', { status: 'error' as const, lastSyncAt: '2026-08-24T00:00:00.000Z', lastSuccessAt: null, lastFailureAt: '2026-08-24T00:00:00.000Z', lastError: 'boom', consecutiveFailures: 3, verificationStatus: 'not_tested' as const, verifiedAt: null, verificationDetail: null, writeVerificationStatus: 'not_tested' as const, writeVerifiedAt: null, writeVerificationDetail: null }]])
    const summaries = advertisingConnectorSummaries(connections)
    const amazon = summaries.find((s) => s.platform === 'amazon_ads')!
    expect(amazon.status).toBe('error')
    expect(amazon.lastError).toBe('boom')
    expect(amazon.consecutiveFailures).toBe(3)

    const meta = summaries.find((s) => s.platform === 'meta_ads')!
    expect(meta.lastSyncAt).toBeNull()
  })
})
