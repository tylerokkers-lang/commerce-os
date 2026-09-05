import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const rpcMock = vi.fn().mockResolvedValue({ error: null })
let selectResult: { data: unknown; error: unknown } = { data: null, error: null }
const createServiceSupabaseMock = vi.fn(() => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(selectResult) }) }) }) }) }),
  rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceSupabase: () => createServiceSupabaseMock() }))

const createNotificationMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/create', () => ({ createNotification: (input: unknown) => createNotificationMock(input) }))

/**
 * Milestone: execution reliability & unified write path. Tests the real
 * gating decision end to end (load state -> `canConnectorRunNow` -> call ->
 * record) against a mocked database, since `canConnectorRunNow` itself
 * (the pure check) already has its own tests in `supplier-connectors.test.ts`
 * and the shared math in `circuit-breaker.test.ts`.
 */

function makeConnector(overrides: Partial<{ isConfigured: boolean }> = {}) {
  return {
    isConfigured: () => overrides.isConfigured ?? true,
    descriptor: {
      key: 'cjdropshipping',
      label: 'CJdropshipping',
      sourceType: 'api',
      requiredCredentials: ['CJ_API_KEY'],
      rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 5 },
      capabilities: {},
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  selectResult = { data: null, error: null }
  rpcMock.mockResolvedValue({ error: null })
})

describe('withSupplierConnectorGate', () => {
  it('a never-tracked connector (no row) is treated as fresh and healthy, not unknown — the real call proceeds', async () => {
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'real result' })
    const result = await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, value: 'real result' })
  })

  it('a genuine database read error fails closed — the connector is never called', async () => {
    selectResult = { data: null, error: { message: 'connection refused' } }
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'should never run' })
    const result = await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/could not be confirmed/i)
  })

  it('an open circuit (nextAllowedAt in the future) blocks the call without ever invoking it', async () => {
    selectResult = {
      data: { is_enabled: true, last_success_at: null, last_failure_at: new Date().toISOString(), last_error: 'timeout', next_allowed_at: new Date(Date.now() + 600_000).toISOString(), consecutive_failures: 5 },
      error: null,
    }
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'should never run' })
    const result = await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('a disabled connector is refused', async () => {
    selectResult = { data: { is_enabled: false, last_success_at: null, last_failure_at: null, last_error: null, next_allowed_at: null, consecutive_failures: 0 }, error: null }
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 'x' })
    const result = await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), fn)

    expect(fn).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })

  it('a successful call records a success outcome via the RPC function', async () => {
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), async () => ({ ok: true, value: 'x' }))

    expect(rpcMock).toHaveBeenCalledWith('record_supplier_connector_outcome', expect.objectContaining({ p_org_id: 'org-1', p_supplier_id: 'sup-1', p_succeeded: true }))
  })

  it('a failed call (the connector method itself returns err) records a failure outcome, never a success', async () => {
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    const result = await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), async () => ({ ok: false, error: 'API timeout' }))

    expect(result.ok).toBe(false)
    expect(rpcMock).toHaveBeenCalledWith('record_supplier_connector_outcome', expect.objectContaining({ p_succeeded: false, p_error: 'API timeout' }))
  })

  it('a bookkeeping failure while recording the outcome never masks the real call result', async () => {
    rpcMock.mockRejectedValue(new Error('rpc unavailable'))
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    const result = await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), async () => ({ ok: true, value: 'real answer' }))

    expect(result).toEqual({ ok: true, value: 'real answer' })
  })

  it('a failure that first crosses the circuit-open threshold sends exactly one critical notification', async () => {
    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: null, last_error: null, next_allowed_at: null, consecutive_failures: 2 }, error: null }
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), async () => ({ ok: false, error: 'API timeout' }))

    expect(createNotificationMock).toHaveBeenCalledTimes(1)
    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      severity: 'critical',
      category: 'supplier',
      entityType: 'supplier_connector',
      entityId: 'sup-1:cjdropshipping',
      dedupeKey: 'connector-circuit-open:org-1:sup-1:cjdropshipping',
    }))
  })

  it('a failure below the threshold, and a failure past it (already open), never re-notifies', async () => {
    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: null, last_error: null, next_allowed_at: null, consecutive_failures: 1 }, error: null }
    const { withSupplierConnectorGate } = await import('@/lib/suppliers/connectors/executionGate')
    await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), async () => ({ ok: false, error: 'API timeout' }))
    expect(createNotificationMock).not.toHaveBeenCalled()

    selectResult = { data: { is_enabled: true, last_success_at: null, last_failure_at: null, last_error: null, next_allowed_at: null, consecutive_failures: 4 }, error: null }
    await withSupplierConnectorGate('org-1', 'sup-1', makeConnector(), async () => ({ ok: false, error: 'API timeout' }))
    expect(createNotificationMock).not.toHaveBeenCalled()
  })
})
