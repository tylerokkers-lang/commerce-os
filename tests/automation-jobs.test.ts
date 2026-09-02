import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeBackoffSeconds } from '@/lib/automation/backoff'

/**
 * Phase 14 — regression guard for a genuine concurrency bug found by live
 * verification against the real Supabase project (`HANDOVER.md`'s Phase 14
 * section): `claimNextJob` used to claim with a single
 * `.in('status', ['pending', 'running'])` filter shared by both the
 * "genuinely pending" and "abandoned/stale-locked" candidates. That let a
 * second worker re-claim a job the instant *any* other worker had already
 * claimed it — not only a truly abandoned one — because the update never
 * re-checked `locked_at` staleness at the moment it ran. Proven live: two
 * concurrent `claimNextJob` calls for the same freshly-enqueued job both
 * returned success, one silently overwriting the other's claim.
 *
 * PGlite/the in-memory test double cannot reproduce true concurrent
 * Postgres commits, so this cannot be proven by a Vitest test the way it
 * was proven live. What Vitest *can* prove, and what would have caught this
 * exact bug before it ever reached a real database, is the shape of the
 * query each code path issues: a pending-job claim must filter narrowly on
 * `status = 'pending'` alone, and an abandoned-job claim must filter on
 * `status = 'running'` AND a fresh `locked_at` cutoff, in the same update —
 * never the loose `.in(status, [...])` pattern that let the two cases blur
 * together.
 */
function createRecordingSupabaseMock(responses: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<{ op: 'select' | 'update'; methodCalls: Array<{ method: string; args: unknown[] }> }> = []
  let responseIndex = 0

  function makeBuilder(op: 'select' | 'update') {
    const methodCalls: Array<{ method: string; args: unknown[] }> = []
    const record = { op, methodCalls }
    calls.push(record)

    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'lte', 'lt', 'order', 'limit', 'update', 'in']) {
      builder[method] = (...args: unknown[]) => {
        methodCalls.push({ method, args })
        return builder
      }
    }
    const resolve = () => Promise.resolve(responses[responseIndex++] ?? { data: null, error: null })
    builder.maybeSingle = resolve
    builder.single = resolve
    builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected)
    return builder
  }

  const supabase = {
    from: () => {
      // The first call on a fresh builder is always select() or update() —
      // real jobs.ts code never calls anything else first.
      const builder: Record<string, unknown> = {}
      let opBuilder: Record<string, unknown> | null = null
      builder.select = (...args: unknown[]) => {
        opBuilder = makeBuilder('select')
        return (opBuilder.select as (...a: unknown[]) => unknown)(...args)
      }
      builder.update = (...args: unknown[]) => {
        opBuilder = makeBuilder('update')
        return (opBuilder.update as (...a: unknown[]) => unknown)(...args)
      }
      return builder
    },
  }

  return { supabase, calls }
}

function filtersOf(record: { methodCalls: Array<{ method: string; args: unknown[] }> }, method: string) {
  return record.methodCalls.filter((c) => c.method === method)
}

let mockSupabase: ReturnType<typeof createRecordingSupabaseMock>['supabase']

// `jobs.ts` imports 'server-only' — a real package Next.js resolves specially
// at build time, but not one Vitest's plain Node module resolution can find
// (confirmed directly: without this, every test below fails with
// `Cannot find package 'server-only'`, not a mock-related failure). This is
// exactly why no server-only Supabase-touching module in this codebase has
// ever had a Vitest test before this file — `core/env.ts` was the one
// exception, specifically because it has no imports of its own.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceSupabase: () => mockSupabase,
}))

describe('claimNextJob — query shape (regression guard for the Phase 14 concurrency bug)', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('claims a pending job with a narrow status=pending filter, never .in(status, [...])', async () => {
    const claimedRow = {
      id: 'job1', org_id: 'org1', job_type: 'x', status: 'running', payload: {}, run_at: new Date().toISOString(),
      idempotency_key: null, attempts: 1, max_attempts: 5, last_error: null, locked_at: new Date().toISOString(),
      locked_by: 'worker1', correlation_id: 'c1', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
    }
    const mock = createRecordingSupabaseMock([
      { data: [{ id: 'job1', attempts: 0 }], error: null }, // pending candidates
      { data: [], error: null }, // abandoned candidates
      { data: claimedRow, error: null }, // the claim update itself
    ])
    mockSupabase = mock.supabase

    const { claimNextJob } = await import('@/lib/automation/jobs')
    const result = await claimNextJob('worker1')

    expect(result?.id).toBe('job1')
    const updateCall = mock.calls.find((c) => c.op === 'update')
    expect(updateCall).toBeDefined()
    expect(filtersOf(updateCall!, 'eq')).toContainEqual({ method: 'eq', args: ['status', 'pending'] })
    expect(filtersOf(updateCall!, 'in')).toHaveLength(0)
  })

  it('recovers an abandoned job with BOTH status=running and a locked_at staleness filter on the same update', async () => {
    const claimedRow = {
      id: 'job2', org_id: 'org1', job_type: 'x', status: 'running', payload: {}, run_at: new Date().toISOString(),
      idempotency_key: null, attempts: 3, max_attempts: 5, last_error: null, locked_at: new Date().toISOString(),
      locked_by: 'worker2', correlation_id: 'c2', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
    }
    const mock = createRecordingSupabaseMock([
      { data: [], error: null }, // pending candidates — none
      { data: [{ id: 'job2', attempts: 2 }], error: null }, // abandoned candidates
      { data: claimedRow, error: null }, // the recovery update itself
    ])
    mockSupabase = mock.supabase

    const { claimNextJob } = await import('@/lib/automation/jobs')
    const result = await claimNextJob('worker2')

    expect(result?.id).toBe('job2')
    const updateCall = mock.calls.find((c) => c.op === 'update')
    expect(updateCall).toBeDefined()
    expect(filtersOf(updateCall!, 'eq')).toContainEqual({ method: 'eq', args: ['status', 'running'] })
    expect(filtersOf(updateCall!, 'lt').length).toBeGreaterThan(0)
    const [ltColumn] = filtersOf(updateCall!, 'lt')[0].args
    expect(ltColumn).toBe('locked_at')
    expect(filtersOf(updateCall!, 'in')).toHaveLength(0)
  })

  it('never uses the buggy .in(status, [pending, running]) pattern on any update, regardless of which candidate list it came from', async () => {
    // A single combined regression assertion: whichever branch ran, `in`
    // must never appear on the update builder at all — that loose filter is
    // exactly what let a second worker re-claim a job the instant the first
    // worker's claim had committed, not only once it was genuinely stale.
    const claimedRow = {
      id: 'job3', org_id: 'org1', job_type: 'x', status: 'running', payload: {}, run_at: new Date().toISOString(),
      idempotency_key: null, attempts: 1, max_attempts: 5, last_error: null, locked_at: new Date().toISOString(),
      locked_by: 'worker3', correlation_id: 'c3', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null,
    }
    const mock = createRecordingSupabaseMock([
      { data: [{ id: 'job3', attempts: 0 }], error: null },
      { data: [], error: null },
      { data: claimedRow, error: null },
    ])
    mockSupabase = mock.supabase

    const { claimNextJob } = await import('@/lib/automation/jobs')
    await claimNextJob('worker3')

    for (const call of mock.calls) {
      expect(filtersOf(call, 'in')).toHaveLength(0)
    }
  })
})

describe('job retry backoff', () => {
  it('increases with each attempt', () => {
    const first = computeBackoffSeconds(1)
    const second = computeBackoffSeconds(2)
    const third = computeBackoffSeconds(3)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it('is deterministic for the same attempt count', () => {
    expect(computeBackoffSeconds(3)).toBe(computeBackoffSeconds(3))
  })

  it('caps at one hour no matter how many attempts', () => {
    expect(computeBackoffSeconds(20)).toBe(3600)
    expect(computeBackoffSeconds(100)).toBe(3600)
  })

  it('never returns a negative or zero backoff, even for a zero or negative attempt count', () => {
    expect(computeBackoffSeconds(0)).toBeGreaterThan(0)
    expect(computeBackoffSeconds(-5)).toBeGreaterThan(0)
  })
})
