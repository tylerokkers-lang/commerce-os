import { describe, expect, it } from 'vitest'
import { secretsMatch, extractBearerToken } from '@/lib/core/schedulerAuth'

/**
 * Milestone 18, Phase 14/15 — the auth primitives shared by every
 * scheduler-authenticated route (`/api/automation/run`,
 * `/api/monitoring/run`, `/api/automation/maintenance`). Extracted into
 * their own module specifically so header-parsing edge cases (missing,
 * malformed, wrong scheme, empty token) are proven once, directly, rather
 * than relying on three copies of the same regex staying in sync.
 */

describe('extractBearerToken: only a genuine, well-formed Bearer token is ever returned', () => {
  it('a well-formed header returns the token', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123')
  })

  it('is case-insensitive on the scheme', () => {
    expect(extractBearerToken('bearer abc123')).toBe('abc123')
    expect(extractBearerToken('BEARER abc123')).toBe('abc123')
  })

  it('tolerates extra surrounding whitespace', () => {
    expect(extractBearerToken('  Bearer   abc123  ')).toBe('abc123')
  })

  it('a missing header returns null, never an empty string treated as "no auth required"', () => {
    expect(extractBearerToken(null)).toBeNull()
  })

  it('an empty header returns null', () => {
    expect(extractBearerToken('')).toBeNull()
  })

  it('a non-Bearer scheme is rejected', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull()
  })

  it('"Bearer" with no token at all is rejected, not treated as an empty valid token', () => {
    expect(extractBearerToken('Bearer')).toBeNull()
    expect(extractBearerToken('Bearer ')).toBeNull()
  })

  it('a malformed header with no scheme at all is rejected', () => {
    expect(extractBearerToken('abc123')).toBeNull()
  })

  it('never throws on garbage input', () => {
    expect(() => extractBearerToken('<script>alert(1)</script>')).not.toThrow()
    expect(extractBearerToken('<script>alert(1)</script>')).toBeNull()
  })
})

describe('secretsMatch: constant-time, length-safe comparison', () => {
  it('matching secrets return true', () => {
    expect(secretsMatch('correct-secret', 'correct-secret')).toBe(true)
  })

  it('a wrong secret of the same length returns false', () => {
    expect(secretsMatch('wrong-secret-x', 'correct-secret')).toBe(false)
  })

  it('a wrong secret of a different length returns false, never throws', () => {
    expect(() => secretsMatch('short', 'a-much-longer-correct-secret')).not.toThrow()
    expect(secretsMatch('short', 'a-much-longer-correct-secret')).toBe(false)
  })

  it('an empty provided secret never matches a real one', () => {
    expect(secretsMatch('', 'correct-secret')).toBe(false)
  })
})
