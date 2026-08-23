import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from '@/lib/core/result'
import { withRetry, instantSleep } from '@/lib/marketplaces/retry'

function flakyOperation(failuresBeforeSuccess: number): () => Promise<Result<string, string>> {
  let calls = 0
  return async () => {
    calls += 1
    if (calls <= failuresBeforeSuccess) return err(`attempt ${calls} failed: timeout`)
    return ok(`succeeded on attempt ${calls}`)
  }
}

describe('retry with backoff', () => {
  it('succeeds immediately without retrying when the first attempt works', async () => {
    const outcome = await withRetry(flakyOperation(0), { maxAttempts: 3, baseDelayMs: 10, sleep: instantSleep })
    expect(outcome.result.ok).toBe(true)
    expect(outcome.attempts).toBe(1)
    expect(outcome.delaysMs).toHaveLength(0)
  })

  it('retries a transient failure and eventually succeeds', async () => {
    const outcome = await withRetry(flakyOperation(2), { maxAttempts: 5, baseDelayMs: 10, sleep: instantSleep })
    expect(outcome.result.ok).toBe(true)
    expect(outcome.attempts).toBe(3)
  })

  it('gives up cleanly after exhausting attempts, returning the last failure rather than throwing', async () => {
    const outcome = await withRetry(flakyOperation(10), { maxAttempts: 3, baseDelayMs: 10, sleep: instantSleep })
    expect(outcome.result.ok).toBe(false)
    expect(outcome.attempts).toBe(3)
    if (!outcome.result.ok) expect(outcome.result.error).toMatch(/attempt 3 failed/)
  })

  it('never simulates an API timeout as a success: a permanently failing operation never resolves ok', async () => {
    const outcome = await withRetry(
      async () => err('API timeout'),
      { maxAttempts: 4, baseDelayMs: 10, sleep: instantSleep },
    )
    expect(outcome.result.ok).toBe(false)
    expect(outcome.attempts).toBe(4)
  })

  it('uses exponential backoff: each delay doubles the previous one', async () => {
    const outcome = await withRetry(flakyOperation(3), { maxAttempts: 5, baseDelayMs: 100, sleep: instantSleep })
    expect(outcome.delaysMs).toEqual([100, 200, 400])
  })

  it('stops retrying immediately when the error is classified as not retryable', async () => {
    let calls = 0
    const outcome = await withRetry(
      async () => {
        calls += 1
        return err('401 Unauthorized')
      },
      { maxAttempts: 5, baseDelayMs: 10, sleep: instantSleep, isRetryable: (e) => !e.includes('401') },
    )
    expect(calls).toBe(1)
    expect(outcome.attempts).toBe(1)
    expect(outcome.result.ok).toBe(false)
  })

  it('retries a retryable error but not a non-retryable one in the same policy', async () => {
    const retryable = (message: string) => !message.includes('401')
    let timeoutCalls = 0
    const timeoutOutcome = await withRetry(
      async () => {
        timeoutCalls += 1
        return timeoutCalls < 2 ? err('timeout') : ok('recovered')
      },
      { maxAttempts: 3, baseDelayMs: 10, sleep: instantSleep, isRetryable: retryable },
    )
    expect(timeoutOutcome.result.ok).toBe(true)
    expect(timeoutOutcome.attempts).toBe(2)
  })
})
