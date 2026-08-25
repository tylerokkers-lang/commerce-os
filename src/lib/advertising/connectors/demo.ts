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
 * The demo advertising connector.
 *
 * Always available, always reports `demo` (never `connected`) — the same
 * distinction `shopifyDemoConnector`/`amazonDemoConnector` protect. Used
 * both to illustrate the pipeline in demo mode and, more importantly, to
 * drive the *real* sync/execution code end-to-end in tests
 * (`tests/advertising-execution-e2e.test.ts`) without a live Amazon/Meta/
 * Google/TikTok account — the same reason `automation-execution-e2e.test.ts`
 * drives `executePriceChange` through `shopifyDemoConnector` rather than a
 * mock.
 */

const DESCRIPTOR: AdvertisingConnectorDescriptor = {
  key: 'demo_ads',
  label: 'Demo Ads',
  platform: 'amazon_ads',
  capabilities: { readCampaigns: true, pauseCampaign: true, setBudget: true, verifyWrites: true },
  implementationStatus: 'implemented',
  requiredCredentials: [],
  rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
}

const TODAY = () => new Date().toISOString().slice(0, 10)

function seedCampaigns(): NormalizedCampaignFact[] {
  const periodDate = TODAY()
  const reportedAt = new Date().toISOString()
  return [
    {
      provider: 'amazon_ads', externalAccountId: 'demo-account-1', externalCampaignId: 'demo-camp-1',
      campaignName: 'Demo: Wasteful Campaign', status: 'active', periodDate,
      impressions: 900, clicks: 30, conversions: 0, spendMinor: 20000, revenueMinor: 0,
      currency: 'GBP', dailyBudgetMinor: 3000, attributionModel: '7-day click', reportedAt,
    },
    {
      provider: 'amazon_ads', externalAccountId: 'demo-account-1', externalCampaignId: 'demo-camp-2',
      campaignName: 'Demo: Healthy Campaign', status: 'active', periodDate,
      impressions: 5000, clicks: 220, conversions: 24, spendMinor: 3000, revenueMinor: 13500,
      currency: 'GBP', dailyBudgetMinor: 500, attributionModel: '7-day click', reportedAt,
    },
  ]
}

export class DemoAdvertisingConnector implements AdvertisingProvider {
  readonly descriptor = DESCRIPTOR

  isConfigured(): boolean {
    return true
  }

  async getConnectionHealth(): Promise<Result<AdvertisingConnectionHealth, string>> {
    return ok({ status: 'demo', checkedAt: new Date().toISOString(), detail: null })
  }

  async fetchCampaigns(options: FetchCampaignsOptions): Promise<Result<FetchOutcome<NormalizedCampaignFact>, string>> {
    return ok({ records: seedCampaigns().slice(0, options.limit), requestsMade: 0, warnings: [] })
  }

  // Module-level so a write made earlier in the same process is visible to a
  // later verify call — real SUBMIT -> VERIFY behaviour without a network
  // call. Resets on process restart, same as every other in-memory demo
  // dataset in this codebase.
  private static pausedCampaigns = new Set<string>()
  private static writtenBudgets = new Map<string, number>()

  async pauseCampaign(input: CampaignWriteInput): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    const exists = seedCampaigns().some((c) => c.externalCampaignId === input.externalCampaignId)
    if (!exists) return err({ reason: 'rejected', detail: `No demo campaign found for external id "${input.externalCampaignId}".` })
    DemoAdvertisingConnector.pausedCampaigns.add(input.externalCampaignId)
    return ok({ accepted: true, externalRef: `demo-pause-${input.idempotencyKey}` })
  }

  async setCampaignBudget(input: CampaignWriteInput & { dailyBudgetMinor: number }): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    if (input.dailyBudgetMinor <= 0) return err({ reason: 'rejected', detail: 'Daily budget must be greater than zero.' })
    const exists = seedCampaigns().some((c) => c.externalCampaignId === input.externalCampaignId)
    if (!exists) return err({ reason: 'rejected', detail: `No demo campaign found for external id "${input.externalCampaignId}".` })
    DemoAdvertisingConnector.writtenBudgets.set(input.externalCampaignId, input.dailyBudgetMinor)
    return ok({ accepted: true, externalRef: `demo-budget-${input.idempotencyKey}` })
  }

  async verifyCampaignState(externalCampaignId: string): Promise<Result<NormalizedCampaignFact, string>> {
    const campaign = seedCampaigns().find((c) => c.externalCampaignId === externalCampaignId)
    if (!campaign) return err(`No demo campaign found for external id "${externalCampaignId}".`)
    return ok({
      ...campaign,
      status: DemoAdvertisingConnector.pausedCampaigns.has(externalCampaignId) ? 'paused' : campaign.status,
      dailyBudgetMinor: DemoAdvertisingConnector.writtenBudgets.get(externalCampaignId) ?? campaign.dailyBudgetMinor,
      reportedAt: new Date().toISOString(),
    })
  }
}

export const demoAdvertisingConnector = new DemoAdvertisingConnector()
