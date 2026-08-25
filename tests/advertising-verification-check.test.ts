import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from '@/lib/core/result'
import { demoAdvertisingConnector } from '@/lib/advertising/connectors/demo'
import { amazonAdsConnector } from '@/lib/advertising/connectors/amazonAds'
import { verifyProviderReadOnly } from '@/lib/advertising/verificationCheck'
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
} from '@/lib/advertising/connectors/types'

/**
 * Phase 9/12 — direct tests of the staged, read-only verification check's
 * decision logic, split out into its own non-`server-only` module
 * (`verificationCheck.ts`) specifically so this is possible, the same
 * reason `advertising-monitor-plan.test.ts` tests `monitorPlan.ts` rather
 * than `monitor.ts` itself. Never asserts on a live network call — every
 * scenario here drives a real `AdvertisingProvider` implementation (the
 * demo connector, the real-but-uncredentialled Amazon Ads connector, and
 * small fakes for the health-ok-but-read-fails / empty-read paths that
 * neither of those two naturally exercises).
 */

const DESCRIPTOR: AdvertisingConnectorDescriptor = {
  key: 'fake_ads', label: 'Fake Ads', platform: 'meta_ads',
  capabilities: { readCampaigns: true, pauseCampaign: false, setBudget: false, verifyWrites: false },
  requiredCredentials: [],
  rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
}

class FakeConnector implements AdvertisingProvider {
  readonly descriptor = DESCRIPTOR
  constructor(
    private readonly configured: boolean,
    private readonly health: Result<AdvertisingConnectionHealth, string>,
    private readonly fetchResult: Result<FetchOutcome<NormalizedCampaignFact>, string>,
  ) {}

  isConfigured(): boolean {
    return this.configured
  }
  async getConnectionHealth(): Promise<Result<AdvertisingConnectionHealth, string>> {
    return this.health
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by the AdvertisingProvider interface; this fake ignores it
  async fetchCampaigns(_options: FetchCampaignsOptions): Promise<Result<FetchOutcome<NormalizedCampaignFact>, string>> {
    return this.fetchResult
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by the AdvertisingProvider interface; this fake never writes
  async pauseCampaign(_input: CampaignWriteInput): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    return err({ reason: 'not_supported', detail: 'FakeConnector never writes.' })
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by the AdvertisingProvider interface; this fake never writes
  async setCampaignBudget(_input: CampaignWriteInput & { dailyBudgetMinor: number }): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    return err({ reason: 'not_supported', detail: 'FakeConnector never writes.' })
  }
  async verifyCampaignState(externalCampaignId: string): Promise<Result<NormalizedCampaignFact, string>> {
    return err(`FakeConnector cannot verify ${externalCampaignId}.`)
  }
}

describe('verifyProviderReadOnly: honest, staged verification states', () => {
  it('not configured -> not_tested, without ever calling health or fetch', async () => {
    const result = await verifyProviderReadOnly(amazonAdsConnector)
    expect(amazonAdsConnector.isConfigured()).toBe(false)
    expect(result.status).toBe('not_tested')
  })

  it('configured but health check fails -> failed', async () => {
    const connector = new FakeConnector(true, err('network unreachable'), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await verifyProviderReadOnly(connector)
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('network unreachable')
  })

  it('health reports error status -> failed', async () => {
    const connector = new FakeConnector(
      true,
      ok({ status: 'error', checkedAt: new Date().toISOString(), detail: 'token expired' }),
      ok({ records: [], requestsMade: 0, warnings: [] }),
    )
    const result = await verifyProviderReadOnly(connector)
    expect(result.status).toBe('failed')
    expect(result.detail).toBe('token expired')
  })

  it('health passes but reading campaigns fails -> authentication_verified, never a plain failure', async () => {
    const connector = new FakeConnector(
      true,
      ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }),
      err('rate limited'),
    )
    const result = await verifyProviderReadOnly(connector)
    expect(result.status).toBe('authentication_verified')
    expect(result.detail).toContain('rate limited')
  })

  it('read succeeds but returns zero campaigns -> read_access_verified, not data_retrieval_verified', async () => {
    const connector = new FakeConnector(
      true,
      ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }),
      ok({ records: [], requestsMade: 1, warnings: [] }),
    )
    const result = await verifyProviderReadOnly(connector)
    expect(result.status).toBe('read_access_verified')
  })

  it('a real connector returning real records -> data_retrieval_verified (demo connector, end to end)', async () => {
    const result = await verifyProviderReadOnly(demoAdvertisingConnector)
    expect(result.status).toBe('data_retrieval_verified')
    expect(result.detail).toContain('campaign record')
  })

  it('never returns end_to_end_sync_verified — this check never actually runs a sync', async () => {
    for (const connector of [demoAdvertisingConnector, amazonAdsConnector]) {
      const result = await verifyProviderReadOnly(connector)
      expect(result.status).not.toBe('end_to_end_sync_verified')
    }
  })
})
