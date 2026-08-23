import { err, type Result } from '@/lib/core/result'

/**
 * Retry with exponential backoff, for the external calls a marketplace
 * connector makes.
 *
 * A timeout or a transient 5xx from Shopify or Amazon is not a reason to give
 * up on a sync immediately, but it is also not a reason to hammer an API that
 * is already struggling. This retries a bounded number of times with
 * increasing delay, and gives up cleanly — returning the last failure rather
 * than throwing — once the attempts are exhausted.
 *
 * `sleep` is injected so tests can run this with a zero-delay clock rather
 * than actually waiting, and `isRetryable` is injected so callers can decide
 * that, for example, a 401 should fail immediately while a 429 or a network
 * timeout should be retried.
 */

export interface RetryOptions {
  maxAttempts: number
  /** Base delay in ms; actual delay is `baseDelayMs * 2^(attempt-1)`. */
  baseDelayMs: number
  isRetryable?: (error: string) => boolean
  sleep?: (ms: number) => Promise<void>
}

export interface RetryOutcome<T> {
  result: Result<T, string>
  attempts: number
  /** The delay before each retry that was actually taken, for observability. */
  delaysMs: readonly number[]
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(
  operation: () => Promise<Result<T, string>>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const isRetryable = options.isRetryable ?? (() => true)
  const sleep = options.sleep ?? defaultSleep
  const delaysMs: number[] = []

  let lastResult: Result<T, string> = err('withRetry called with maxAttempts <= 0')

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    lastResult = await operation()
    if (lastResult.ok) {
      return { result: lastResult, attempts: attempt, delaysMs }
    }
    if (attempt === options.maxAttempts || !isRetryable(lastResult.error)) {
      return { result: lastResult, attempts: attempt, delaysMs }
    }

    const delay = options.baseDelayMs * 2 ** (attempt - 1)
    delaysMs.push(delay)
    await sleep(delay)
  }

  return { result: lastResult, attempts: options.maxAttempts, delaysMs }
}

/** A sleep function that resolves immediately, for deterministic tests. */
export const instantSleep = async (ms: number): Promise<void> => {
  // Yield a real microtask tick rather than doing literally nothing, so this
  // still behaves like an async boundary in tests that check ordering.
  void ms
  await Promise.resolve()
}
