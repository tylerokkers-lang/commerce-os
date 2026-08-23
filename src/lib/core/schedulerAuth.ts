import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time secret comparison, shared by every scheduler-authenticated
 * route (`/api/automation/run`, `/api/monitoring/run`) so a wrong guess
 * cannot be narrowed down by response timing (`docs/SECURITY.md`).
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
