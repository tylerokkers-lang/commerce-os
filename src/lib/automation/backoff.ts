/**
 * Exponential backoff for job retries, capped at one hour.
 *
 * Kept in its own file, with no `server-only` import, specifically so it is
 * unit-testable without a database — `jobs.ts` (which does need
 * `server-only`, since it writes to Postgres) imports this rather than
 * defining it inline.
 */

const BASE_BACKOFF_SECONDS = 30
const MAX_BACKOFF_SECONDS = 3600

export function computeBackoffSeconds(attempts: number): number {
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_SECONDS)
}
