import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from '@/lib/core/result'
import { demoAdvertisingConnector } from '@/lib/advertising/connectors/demo'
import { amazonAdsConnector } from '@/lib/advertising/connectors/amazonAds'
import { verifyProviderReadOnly, runAdvertisingVerificationHarness, mapAmazonAdsReportPipelineToVerification } from '@/lib/advertising/verificationCheck'
import type { AdvanceReportPipelineResult } from '@/lib/advertising/amazonAdsReportPipeline'
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
  implementationStatus: 'implemented',
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

describe('runAdvertisingVerificationHarness: named, incremental steps (Phase 7)', () => {
  it('an unconfigured connector fails at step 1, never attempting authentication', async () => {
    const result = await runAdvertisingVerificationHarness(amazonAdsConnector)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].step).toBe('Validate credentials exist')
    expect(result.steps[0].outcome).toBe('failed')
    expect(result.overallStatus).toBe('not_tested')
  })

  it('a real, fully-working connector (demo) passes every step in order', async () => {
    const result = await runAdvertisingVerificationHarness(demoAdvertisingConnector)
    expect(result.steps.map((s) => s.step)).toEqual([
      'Validate credentials exist',
      'Authenticate and identify accessible account/profile',
      'Perform a safe read: fetch campaign metadata and metrics',
      'Verify campaign state',
    ])
    expect(result.steps.every((s) => s.outcome === 'passed')).toBe(true)
    expect(result.overallStatus).toBe('data_retrieval_verified')
  })

  it('a connection-health failure stops the harness at step 2, never attempting a read', async () => {
    const connector = new FakeConnector(true, err('token expired'), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[1].outcome).toBe('failed')
    expect(result.overallStatus).toBe('failed')
  })

  it('a read failure after successful auth stops before verify campaign state', async () => {
    const connector = new FakeConnector(
      true,
      ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }),
      err('rate limited'),
    )
    const result = await runAdvertisingVerificationHarness(connector)
    expect(result.steps.map((s) => s.step)).toEqual(['Validate credentials exist', 'Authenticate and identify accessible account/profile', 'Perform a safe read: fetch campaign metadata and metrics'])
    expect(result.steps[2].outcome).toBe('failed')
    expect(result.overallStatus).toBe('authentication_verified')
  })

  it('zero campaigns returned -> verify campaign state is explicitly skipped, not silently omitted', async () => {
    const connector = new FakeConnector(
      true,
      ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }),
      ok({ records: [], requestsMade: 1, warnings: [] }),
    )
    const result = await runAdvertisingVerificationHarness(connector)
    const verifyStep = result.steps.find((s) => s.step === 'Verify campaign state')
    expect(verifyStep?.outcome).toBe('skipped')
    expect(result.overallStatus).toBe('read_access_verified')
  })

  it('never calls a connector write method — every step is read-only', async () => {
    let wroteAnything = false
    class WriteTrackingConnector extends FakeConnector {
      async pauseCampaign(): Promise<Result<{ accepted: boolean; externalRef: string | null }, AdvertisingWriteFailure>> {
        wroteAnything = true
        return ok({ accepted: true, externalRef: null })
      }
      async setCampaignBudget(): Promise<Result<{ accepted: boolean; externalRef: string | null }, AdvertisingWriteFailure>> {
        wroteAnything = true
        return ok({ accepted: true, externalRef: null })
      }
    }
    const connector = new WriteTrackingConnector(true, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 1, warnings: [] }))
    await runAdvertisingVerificationHarness(connector)
    expect(wroteAnything).toBe(false)
  })
})

/**
 * Milestone 20, Phase 19 — Amazon Ads' real read path is the async report
 * pipeline, not `fetchCampaigns()`. These tests prove verification honestly
 * reflects that pipeline's own state — one call, one action, never claiming
 * more than that single action actually proved — and never marks a write
 * capability, since `advanceAmazonAdsReportPipeline` never writes anything.
 */
function pipelineResult(overrides: Partial<AdvanceReportPipelineResult> = {}): AdvanceReportPipelineResult {
  return { ready: false, facts: [], unparseableRows: 0, status: 'requested', detail: 'A report was requested.', ...overrides }
}

const FACT: NormalizedCampaignFact = {
  provider: 'amazon_ads', externalAccountId: 'profile-1', externalCampaignId: 'c-1', campaignName: 'Test Campaign',
  status: 'active', periodDate: '2026-08-20', impressions: 100, clicks: 5, conversions: 1,
  spendMinor: 500, revenueMinor: 1000, currency: 'GBP' as never, dailyBudgetMinor: null,
  attributionModel: '14-day click', reportedAt: '2026-08-25T00:00:00.000Z',
}

describe('mapAmazonAdsReportPipelineToVerification: one call, one honest state', () => {
  it('failed -> failed, with the pipeline\'s own detail, never a generic message', () => {
    const result = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status: 'failed', detail: 'Amazon Ads report status check failed: token expired.' }))
    expect(result.status).toBe('failed')
    expect(result.detail).toContain('token expired')
  })

  it('requested -> read_access_verified, never data_retrieval_verified (no data exists yet)', () => {
    const result = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status: 'requested' }))
    expect(result.status).toBe('read_access_verified')
  })

  it('processing -> read_access_verified', () => {
    const result = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status: 'processing', detail: 'still processing' }))
    expect(result.status).toBe('read_access_verified')
  })

  it('completed with zero normalizable facts -> read_access_verified, not data_retrieval_verified — access proven, real data not', () => {
    const result = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status: 'completed', ready: true, facts: [], unparseableRows: 3 }))
    expect(result.status).toBe('read_access_verified')
    expect(result.detail).toContain('3')
  })

  it('completed with real facts -> data_retrieval_verified, the only path that reaches it', () => {
    const result = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status: 'completed', ready: true, facts: [FACT] }))
    expect(result.status).toBe('data_retrieval_verified')
  })

  it('never returns end_to_end_sync_verified or a write-verified status — this remains a read capability only', () => {
    for (const status of ['requested', 'processing', 'failed'] as const) {
      const result = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status }))
      expect(result.status).not.toBe('end_to_end_sync_verified')
    }
    const completed = mapAmazonAdsReportPipelineToVerification(pipelineResult({ status: 'completed', ready: true, facts: [FACT] }))
    expect(completed.status).not.toBe('end_to_end_sync_verified')
  })
})

describe('runAdvertisingVerificationHarness with an Amazon Ads report pipeline result: named step evidence (Phase 19)', () => {
  it('a configured connector with a requested report reaches report creation, skips the rest', async () => {
    const connector = new FakeConnector(true, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector, pipelineResult({ status: 'requested', detail: 'Requested a report for 2026-07-27 to 2026-08-24.' }))
    expect(result.steps.map((s) => s.step)).toEqual([
      'Validate credentials exist',
      'Authenticate and identify accessible account/profile',
      'Report creation',
      'Report status lookup',
      'Report retrieval',
      'Report parsing and campaign normalization',
    ])
    expect(result.steps.find((s) => s.step === 'Report creation')?.outcome).toBe('passed')
    expect(result.steps.filter((s) => s.outcome === 'skipped')).toHaveLength(3)
    expect(result.overallStatus).toBe('read_access_verified')
  })

  it('a processing report shows status lookup passed, retrieval/normalization still skipped', async () => {
    const connector = new FakeConnector(true, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector, pipelineResult({ status: 'processing', detail: 'still processing' }))
    expect(result.steps.find((s) => s.step === 'Report status lookup')?.outcome).toBe('passed')
    expect(result.steps.find((s) => s.step === 'Report retrieval')?.outcome).toBe('skipped')
    expect(result.overallStatus).toBe('read_access_verified')
  })

  it('a completed report with real facts passes every step, with the fact count as evidence', async () => {
    const connector = new FakeConnector(true, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector, pipelineResult({ status: 'completed', ready: true, facts: [FACT], detail: 'Retrieved 1 report row(s), normalized 1.' }))
    expect(result.steps.every((s) => s.outcome === 'passed')).toBe(true)
    const normalizeStep = result.steps.find((s) => s.step === 'Report parsing and campaign normalization')
    expect(normalizeStep?.detail).toContain('1')
    expect(result.overallStatus).toBe('data_retrieval_verified')
  })

  it('a completed report with zero normalizable facts fails only the normalization step', async () => {
    const connector = new FakeConnector(true, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector, pipelineResult({ status: 'completed', ready: true, facts: [], unparseableRows: 2 }))
    expect(result.steps.find((s) => s.step === 'Report parsing and campaign normalization')?.outcome).toBe('failed')
    expect(result.overallStatus).toBe('read_access_verified')
  })

  it('a failed pipeline result stops the harness with a single failed step, never fabricating later steps', async () => {
    const connector = new FakeConnector(true, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector, pipelineResult({ status: 'failed', detail: 'Amazon Ads report status check failed.' }))
    expect(result.steps.at(-1)?.outcome).toBe('failed')
    expect(result.overallStatus).toBe('failed')
  })

  it('an unconfigured connector never reaches the report pipeline branch, even when a result is supplied', async () => {
    const connector = new FakeConnector(false, ok({ status: 'connected', checkedAt: new Date().toISOString(), detail: null }), ok({ records: [], requestsMade: 0, warnings: [] }))
    const result = await runAdvertisingVerificationHarness(connector, pipelineResult({ status: 'completed', ready: true, facts: [FACT] }))
    expect(result.overallStatus).toBe('not_tested')
    expect(result.steps).toHaveLength(1)
  })
})
