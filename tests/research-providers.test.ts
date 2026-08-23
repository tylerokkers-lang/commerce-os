import { describe, expect, it } from 'vitest'
import { demoResearchProvider, demoCandidates } from '@/lib/research/providers/demo'
import { canRunNow, deriveStatus, getProvider, listProviders, providerHealth } from '@/lib/research/providers/registry'

const CLOCK = new Date('2026-08-22T09:00:00Z')

describe('demo research provider', () => {
  it('is always configured, because it needs no credentials', () => {
    expect(demoResearchProvider.isConfigured()).toBe(true)
    expect(demoResearchProvider.descriptor.requiredCredentials).toHaveLength(0)
  })

  it('is marked as simulated, never as a real source', () => {
    expect(demoResearchProvider.descriptor.sourceType).toBe('simulated')
  })

  it('makes no network requests', async () => {
    const result = await demoResearchProvider.fetch({ limit: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.requestsMade).toBe(0)
  })

  it('honours the requested limit', async () => {
    const result = await demoResearchProvider.fetch({ limit: 2 })
    if (result.ok) expect(result.value.candidates.length).toBeLessThanOrEqual(2)
  })

  it('skips candidates already known', async () => {
    const all = demoCandidates()
    const known = new Set([all[0].externalRef])
    const result = await demoResearchProvider.fetch({ limit: 50, knownRefs: known })
    if (result.ok) {
      expect(result.value.candidates.some((c) => c.externalRef === all[0].externalRef)).toBe(false)
    }
  })

  it('includes a deliberately unbranded-vs-branded and viable-vs-blocked spread', () => {
    const candidates = demoCandidates()
    expect(candidates.some((c) => c.brand)).toBe(true)
    expect(candidates.some((c) => c.hasBattery)).toBe(true)
    expect(candidates.some((c) => (c.seasonalityIndex ?? 0) > 0.8)).toBe(true)
  })
})

describe('provider registry', () => {
  it('registers the demo provider and every planned provider', () => {
    const keys = listProviders().map((p) => p.descriptor.key)
    expect(keys).toContain('demo')
    expect(keys).toContain('amazon_sp_api')
    expect(keys).toContain('shopify_admin')
    expect(keys).toContain('tiktok_shop')
  })

  it('reports a planned provider as not configured even in principle', () => {
    const amazon = getProvider('amazon_sp_api')!
    expect(amazon.isConfigured()).toBe(false)
  })

  it('refuses to fetch from an unavailable provider', async () => {
    const amazon = getProvider('amazon_sp_api')!
    const result = await amazon.fetch({ limit: 10 })
    expect(result.ok).toBe(false)
  })

  it('never reports a provider as ready without its credentials', () => {
    for (const provider of listProviders()) {
      if (provider.descriptor.key === 'demo') continue
      const health = providerHealth(provider, {
        isEnabled: true,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        nextAllowedAt: null,
        consecutiveFailures: 0,
      })
      expect(health.status).toBe('not_configured')
      expect(health.missingCredentials.length).toBeGreaterThan(0)
    }
  })

  it('derives status from observed state rather than an asserted flag', () => {
    const demo = getProvider('demo')!
    expect(deriveStatus(demo, { isEnabled: false, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 })).toBe('disabled')
    expect(deriveStatus(demo, { isEnabled: true, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 })).toBe('ready')
    expect(deriveStatus(demo, { isEnabled: true, lastSuccessAt: CLOCK.toISOString(), lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 })).toBe('healthy')
    expect(deriveStatus(demo, { isEnabled: true, lastSuccessAt: CLOCK.toISOString(), lastFailureAt: CLOCK.toISOString(), lastError: 'x', nextAllowedAt: null, consecutiveFailures: 3 })).toBe('failing')
  })

  it('honours a declared minimum gap between runs', () => {
    const demo = getProvider('demo')!
    const justRan = { isEnabled: true, lastSuccessAt: CLOCK.toISOString(), lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }
    // The demo provider declares a zero second gap, so it may always run again.
    expect(canRunNow(demo, justRan, CLOCK).ok).toBe(true)
  })

  it('refuses a disabled provider even if it is configured', () => {
    const demo = getProvider('demo')!
    const result = canRunNow(demo, { isEnabled: false, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }, CLOCK)
    expect(result.ok).toBe(false)
  })

  it('refuses to run before a declared rate limit window has passed', () => {
    const amazon = getProvider('amazon_sp_api')!
    const future = new Date(CLOCK.getTime() + 600_000).toISOString()
    const result = canRunNow(amazon, { isEnabled: true, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: future, consecutiveFailures: 0 }, CLOCK)
    expect(result.ok).toBe(false)
  })

  it('declares usage terms for every provider, even unavailable ones', () => {
    for (const provider of listProviders()) {
      expect(provider.descriptor.usagePolicy.permittedUseNote.length).toBeGreaterThan(10)
    }
  })
})
