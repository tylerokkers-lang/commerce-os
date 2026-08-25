import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time secret comparison, shared by every scheduler-authenticated
 * route (`/api/automation/run`, `/api/monitoring/run`, `/api/automation/maintenance`)
 * so a wrong guess cannot be narrowed down by response timing (`docs/SECURITY.md`).
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Milestone 18 — pulled out of what was three near-identical
 * `header?.replace(/^Bearer\s+/i, '')` lines (one per scheduler route) so
 * the exact parsing rules are directly testable and cannot drift between
 * routes. Returns `null` for a missing header, a header that is not the
 * `Bearer` scheme, or a `Bearer` header with no token after it — every one
 * of those must be rejected identically to a present-but-wrong token by
 * the caller (never treated as "no auth required").
 */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}
