import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const rpcMock = vi.fn().mockResolvedValue({ error: null })
let selectResult: { data: unknown; error: unknown } = { data: null, error: null }
const createServiceSupabaseMock = vi.fn(() => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(selectResult) }) }) }) }),
  rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceSupabase: () => createServiceSupabaseMock() }))

function makeConnector(key: string, isConfigured = true) {
  return { isConfigured: () => isConfigured, descriptor: { key, label: key, channel: 'shopify' } } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  selectResult = { data: null, error: null }
  rpcMock.mockResolvedValue({ error: null })
})

describe('withMarketplaceConnectorGate', () => {
  it('a demo connector always bypasses the gate — no database round-trip, the call always proceeds', async () => {
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'demo result' })
    const result = await withMarketplaceConnectorGate('org-1', makeConnector('shopify_demo'), fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(createServiceSupabaseMock).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, value: 'demo result' })
  })

  it('a never-tracked real connector (no channels row) is treated as fresh, not unknown', async () => {
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'x' })
    const result = await withMarketplaceConnectorGate('org-1', makeConnector('shopify'), fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
  })

  it('FAIL CLOSED: a genuine query error refuses the call', async () => {
    selectResult = { data: null, error: { message: 'db down' } }
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'x' })
    const result = await withMarketplaceConnectorGate('org-1', makeConnector('shopify'), fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('an open circuit blocks the call', async () => {
    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: new Date().toISOString(), last_error: 'boom', next_retry_at: new Date(Date.now() + 600_000).toISOString(), consecutive_failures: 5 }, error: null }
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'x' })
    const result = await withMarketplaceConnectorGate('org-1', makeConnector('shopify'), fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('a not-configured connector is refused even with a healthy tracked row', async () => {
    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: null, last_error: null, next_retry_at: null, consecutive_failures: 0 }, error: null }
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'x' })
    const result = await withMarketplaceConnectorGate('org-1', makeConnector('shopify', false), fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('a successful call is recorded, resetting any prior failure streak', async () => {
    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: new Date().toISOString(), last_error: 'e', next_retry_at: null, consecutive_failures: 2 }, error: null }
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    await withMarketplaceConnectorGate('org-1', makeConnector('shopify'), async () => ({ ok: true, value: 'x' }))

    expect(rpcMock).toHaveBeenCalledWith('record_marketplace_connector_outcome', expect.objectContaining({ p_channel_key: 'shopify', p_succeeded: true, p_consecutive_failures: 0 }))
  })

  it('a failed call increments the recorded failure streak', async () => {
    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: null, last_error: null, next_retry_at: null, consecutive_failures: 1 }, error: null }
    const { withMarketplaceConnectorGate } = await import('@/lib/marketplaces/connectors/executionGate')
    const result = await withMarketplaceConnectorGate('org-1', makeConnector('shopify'), async () => ({ ok: false, error: { reason: 'rejected', detail: 'nope' } }))

    expect(result.ok).toBe(false)
    expect(rpcMock).toHaveBeenCalledWith('record_marketplace_connector_outcome', expect.objectContaining({ p_succeeded: false, p_consecutive_failures: 2 }))
  })
})
