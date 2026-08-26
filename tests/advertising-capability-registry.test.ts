import { describe, expect, it } from 'vitest'
import { deriveCapabilityStatus, getProviderCapabilityStatus, getAllCapabilityStatuses, checkExecutionCapabilityGate, CAPABILITY_KIND, ADVERTISING_CAPABILITY_NAMES, type DeriveCapabilityStatusInput } from '@/lib/advertising/capabilityRegistry'
import type { AdvertisingConnectorSummary } from '@/lib/advertising/connectors/types'

/**
 * Milestone 19, Phase 2/3/4/18 — the capability registry's pure decision
 * logic. `deriveCapabilityStatus` is tested against every one of the
 * eight states the brief names; `getProviderCapabilityStatus` is tested
 * against real `AdvertisingConnectorSummary` shapes matching this
 * codebase's actual Amazon Ads / demo / stub connectors, not hypothetical
 * ones — the whole point of this milestone is that the model must reflect
 * genuine repository state, never an aspirational one.
 */

function baseInput(overrides: Partial<DeriveCapabilityStatusInput> = {}): DeriveCapabilityStatusInput {
  return {
    provider: 'Test Provider',
    capability: 'readCampaigns',
    implementationStatus: 'implemented',
    capabilityFlag: true,
    isConfigured: false,
    missingCredentials: ['A', 'B'],
    requiredCredentials: ['A', 'B'],
    connectionStatus: 'not_configured',
    readVerified: false,
    writeVerified: false,
    ...overrides,
  }
}

describe('deriveCapabilityStatus: the eight states, in priority order', () => {
  it('capability flag false + stub connector -> STUB', () => {
    const result = deriveCapabilityStatus(baseInput({ capabilityFlag: false, implementationStatus: 'stub' }))
    expect(result.status).toBe('STUB')
    expect(result.implemented).toBe(false)
  })

  it('capability flag false + implemented connector -> NOT_IMPLEMENTED (a real gap in one specific capability, not the whole connector)', () => {
    const result = deriveCapabilityStatus(baseInput({ capabilityFlag: false, implementationStatus: 'implemented' }))
    expect(result.status).toBe('NOT_IMPLEMENTED')
  })

  it('implemented, no credentials at all -> IMPLEMENTED_UNVERIFIED', () => {
    const result = deriveCapabilityStatus(baseInput({ isConfigured: false, missingCredentials: ['A', 'B'], requiredCredentials: ['A', 'B'] }))
    expect(result.status).toBe('IMPLEMENTED_UNVERIFIED')
  })

  it('implemented, some but not all credentials present -> MISCONFIGURED', () => {
    const result = deriveCapabilityStatus(baseInput({ isConfigured: false, missingCredentials: ['B'], requiredCredentials: ['A', 'B'] }))
    expect(result.status).toBe('MISCONFIGURED')
  })

  it('configured but connection health reports error -> UNAVAILABLE', () => {
    const result = deriveCapabilityStatus(baseInput({ isConfigured: true, missingCredentials: [], connectionStatus: 'error' }))
    expect(result.status).toBe('UNAVAILABLE')
  })

  it('configured but connection health reports degraded -> UNAVAILABLE', () => {
    const result = deriveCapabilityStatus(baseInput({ isConfigured: true, missingCredentials: [], connectionStatus: 'degraded' }))
    expect(result.status).toBe('UNAVAILABLE')
  })

  it('configured, healthy, no verification record yet -> CREDENTIALS_CONFIGURED', () => {
    const result = deriveCapabilityStatus(baseInput({ isConfigured: true, missingCredentials: [], connectionStatus: 'connected', readVerified: false }))
    expect(result.status).toBe('CREDENTIALS_CONFIGURED')
  })

  it('a read capability with a passing read verification -> READ_VERIFIED', () => {
    const result = deriveCapabilityStatus(baseInput({ capability: 'readCampaigns', isConfigured: true, missingCredentials: [], connectionStatus: 'connected', readVerified: true }))
    expect(result.status).toBe('READ_VERIFIED')
    expect(result.verified).toBe(true)
  })

  it('a write capability with a passing write verification -> WRITE_VERIFIED', () => {
    const result = deriveCapabilityStatus(baseInput({ capability: 'pauseCampaign', isConfigured: true, missingCredentials: [], connectionStatus: 'connected', writeVerified: true }))
    expect(result.status).toBe('WRITE_VERIFIED')
    expect(result.verified).toBe(true)
  })

  it('a write capability with only a passing READ verification is never WRITE_VERIFIED — read and write are never conflated', () => {
    const result = deriveCapabilityStatus(baseInput({ capability: 'pauseCampaign', isConfigured: true, missingCredentials: [], connectionStatus: 'connected', readVerified: true, writeVerified: false }))
    expect(result.status).not.toBe('WRITE_VERIFIED')
    expect(result.status).toBe('CREDENTIALS_CONFIGURED')
    expect(result.verified).toBe(false)
  })

  it('a read capability with writeVerified true but readVerified false is never READ_VERIFIED', () => {
    const result = deriveCapabilityStatus(baseInput({ capability: 'readCampaigns', isConfigured: true, missingCredentials: [], connectionStatus: 'connected', readVerified: false, writeVerified: true }))
    expect(result.status).not.toBe('READ_VERIFIED')
  })
})

describe('deriveCapabilityStatus: demo connector is inherently verified, never requiring real credentials', () => {
  it('a demo connection status counts as configured and verified for both read and write capabilities', () => {
    const read = deriveCapabilityStatus(baseInput({ capability: 'readCampaigns', isConfigured: true, missingCredentials: [], connectionStatus: 'demo', readVerified: false }))
    expect(read.status).toBe('READ_VERIFIED')
    const write = deriveCapabilityStatus(baseInput({ capability: 'pauseCampaign', isConfigured: true, missingCredentials: [], connectionStatus: 'demo', writeVerified: false }))
    expect(write.status).toBe('WRITE_VERIFIED')
  })
})

describe('canRead / canWrite / requiresCredentials', () => {
  it('canRead is true only for an implemented read capability', () => {
    expect(deriveCapabilityStatus(baseInput({ capability: 'readCampaigns', capabilityFlag: true })).canRead).toBe(true)
    expect(deriveCapabilityStatus(baseInput({ capability: 'readCampaigns', capabilityFlag: false })).canRead).toBe(false)
    expect(deriveCapabilityStatus(baseInput({ capability: 'pauseCampaign', capabilityFlag: true })).canRead).toBe(false)
  })

  it('canWrite is true only for an implemented write capability', () => {
    expect(deriveCapabilityStatus(baseInput({ capability: 'pauseCampaign', capabilityFlag: true })).canWrite).toBe(true)
    expect(deriveCapabilityStatus(baseInput({ capability: 'pauseCampaign', capabilityFlag: false })).canWrite).toBe(false)
    expect(deriveCapabilityStatus(baseInput({ capability: 'readCampaigns', capabilityFlag: true })).canWrite).toBe(false)
  })

  it('CAPABILITY_KIND classifies exactly two read and two write capabilities', () => {
    const kinds = ADVERTISING_CAPABILITY_NAMES.map((c) => CAPABILITY_KIND[c])
    expect(kinds.filter((k) => k === 'read')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'write')).toHaveLength(2)
  })
})

function amazonAdsSummary(overrides: Partial<AdvertisingConnectorSummary> = {}): AdvertisingConnectorSummary {
  return {
    key: 'amazon_ads', label: 'Amazon Ads', platform: 'amazon_ads',
    // The real, current Amazon Ads descriptor (amazonAds.ts, Milestone 20):
    // reads are now real code (the async report pipeline) but still
    // capability-registry-unverified; verifyCampaignState remains
    // honestly unimplemented; the two write methods are real code
    // against an unconfirmed contract.
    capabilities: { readCampaigns: true, pauseCampaign: true, setBudget: true, verifyWrites: false },
    implementationStatus: 'implemented',
    status: 'not_configured',
    isConfigured: false,
    missingCredentials: ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID'],
    requiredCredentials: ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET', 'AMAZON_ADS_REFRESH_TOKEN', 'AMAZON_ADS_PROFILE_ID'],
    rateLimit: { requestsPerMinute: 2, requestsPerDay: null, minSecondsBetweenRuns: 30 },
    lastSyncAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null, consecutiveFailures: 0,
    verificationStatus: 'not_tested', verifiedAt: null, verificationDetail: null,
    writeVerificationStatus: 'not_tested', writeVerifiedAt: null, writeVerificationDetail: null,
    ...overrides,
  }
}

describe('getProviderCapabilityStatus: real Amazon Ads state in this environment (no credentials configured)', () => {
  it('readCampaigns is IMPLEMENTED_UNVERIFIED (Milestone 20: real report-pipeline code exists), never automatically READ_VERIFIED from implementation alone', () => {
    const result = getProviderCapabilityStatus(amazonAdsSummary(), 'readCampaigns')
    expect(result.status).toBe('IMPLEMENTED_UNVERIFIED')
    expect(result.verified).toBe(false)
  })

  it('verifyCampaignState is NOT_IMPLEMENTED — gated by the honestly-false verifyWrites flag', () => {
    const result = getProviderCapabilityStatus(amazonAdsSummary(), 'verifyCampaignState')
    expect(result.status).toBe('NOT_IMPLEMENTED')
  })

  it('pauseCampaign is IMPLEMENTED_UNVERIFIED — real code, zero credentials configured in this environment', () => {
    const result = getProviderCapabilityStatus(amazonAdsSummary(), 'pauseCampaign')
    expect(result.status).toBe('IMPLEMENTED_UNVERIFIED')
    expect(result.verified).toBe(false)
  })

  it('setBudget is IMPLEMENTED_UNVERIFIED for the same reason', () => {
    const result = getProviderCapabilityStatus(amazonAdsSummary(), 'setBudget')
    expect(result.status).toBe('IMPLEMENTED_UNVERIFIED')
  })

  it('even if read verification had somehow passed, write capabilities never become WRITE_VERIFIED from it', () => {
    const summary = amazonAdsSummary({ isConfigured: true, missingCredentials: [], status: 'connected', verificationStatus: 'data_retrieval_verified' })
    const pause = getProviderCapabilityStatus(summary, 'pauseCampaign')
    expect(pause.status).not.toBe('WRITE_VERIFIED')
    expect(pause.verified).toBe(false)
  })

  it('getAllCapabilityStatuses returns exactly the four named capabilities, in order', () => {
    const statuses = getAllCapabilityStatuses(amazonAdsSummary())
    expect(statuses.map((s) => s.capability)).toEqual(ADVERTISING_CAPABILITY_NAMES)
  })
})

describe('getProviderCapabilityStatus: a stub provider (Meta/Google/TikTok) never claims implementation', () => {
  it('every capability is STUB for a planned, unimplemented platform', () => {
    const meta: AdvertisingConnectorSummary = amazonAdsSummary({
      key: 'meta_ads', label: 'Meta Ads', platform: 'meta_ads' as never,
      capabilities: { readCampaigns: false, pauseCampaign: false, setBudget: false, verifyWrites: false },
      implementationStatus: 'stub',
      missingCredentials: ['META_ADS_ACCESS_TOKEN'], requiredCredentials: ['META_ADS_ACCESS_TOKEN'],
    })
    for (const status of getAllCapabilityStatuses(meta)) {
      expect(status.status).toBe('STUB')
      expect(status.implemented).toBe(false)
      expect(status.verified).toBe(false)
    }
  })
})

describe('checkExecutionCapabilityGate: Phase 5/6/13/14 — the execution-time capability gate', () => {
  function gateInput(overrides: Partial<Parameters<typeof checkExecutionCapabilityGate>[0]> = {}) {
    return {
      provider: 'Amazon Ads',
      capability: 'pauseCampaign' as const,
      implementationStatus: 'implemented' as const,
      capabilityFlag: true,
      isConfigured: false,
      connectionStatus: 'not_configured' as const,
      writeVerificationStatus: 'not_tested' as const,
      ...overrides,
    }
  }

  it('an unconfigured real provider (Amazon Ads today, in this environment) is blocked — approval alone never authorises execution', () => {
    const result = checkExecutionCapabilityGate(gateInput())
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toContain('not verified')
  })

  it('configured, healthy, but never write-verified is still blocked', () => {
    const result = checkExecutionCapabilityGate(gateInput({ isConfigured: true, connectionStatus: 'connected', writeVerificationStatus: 'not_tested' }))
    expect(result.allowed).toBe(false)
  })

  it('a real provider with a genuinely passing write verification is allowed', () => {
    const result = checkExecutionCapabilityGate(gateInput({ isConfigured: true, connectionStatus: 'connected', writeVerificationStatus: 'verified' }))
    expect(result.allowed).toBe(true)
  })

  it('a failed write verification is still blocked, never treated as ok because *some* verification was attempted', () => {
    const result = checkExecutionCapabilityGate(gateInput({ isConfigured: true, connectionStatus: 'connected', writeVerificationStatus: 'failed' }))
    expect(result.allowed).toBe(false)
  })

  it('the demo connection is always allowed, without ever needing a real write-verification record — Demo connector preservation (Phase 15)', () => {
    const result = checkExecutionCapabilityGate(gateInput({ isConfigured: true, connectionStatus: 'demo', writeVerificationStatus: 'not_tested' }))
    expect(result.allowed).toBe(true)
  })

  it('a provider unavailable (degraded/error) is blocked even with a prior passing write verification — capability safety is re-checked fresh, never cached as permanently true', () => {
    const result = checkExecutionCapabilityGate(gateInput({ isConfigured: true, connectionStatus: 'error', writeVerificationStatus: 'verified' }))
    expect(result.allowed).toBe(false)
  })

  it('a stub connector (Meta/Google/TikTok) is always blocked, capability flag false', () => {
    const result = checkExecutionCapabilityGate(gateInput({ implementationStatus: 'stub', capabilityFlag: false, connectionStatus: 'not_configured' }))
    expect(result.allowed).toBe(false)
  })
})
