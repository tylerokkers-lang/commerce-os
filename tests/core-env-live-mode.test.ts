import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDemoMode, isSupabaseConfigured } from '@/lib/core/env'

/**
 * Milestone: live infrastructure activation (Phase 11).
 *
 * `core/env.ts` has zero imports of its own — pure `process.env` reads —
 * so unlike almost every other credential-reading file in this codebase
 * it is genuinely, directly unit-testable. It never had a test file
 * before this, which is exactly how the bug these tests exist to catch
 * went unnoticed: `isDemoMode()` returned `isSupabaseConfigured()`
 * directly instead of its negation, meaning demo mode was reported as
 * *on* whenever Supabase *was* correctly configured, and the app could
 * never actually enter live mode even with fully valid credentials. The
 * inverse of the documented behaviour. Found via a live, real `next dev`
 * failure-injection test during this milestone (`COMMERCE_OS_MODE=live`
 * plus real-shaped but non-functional Supabase values), not by
 * inspection — these tests exist so it can never regress silently again.
 */

const ENV_KEYS = ['COMMERCE_OS_MODE', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
const originalValues: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalValues[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalValues[key] === undefined) delete process.env[key]
    else process.env[key] = originalValues[key]
  }
})

describe('isDemoMode (the core demo/live switch)', () => {
  it('is demo by default, with nothing configured at all', () => {
    expect(isDemoMode()).toBe(true)
  })

  it('stays demo when Supabase is fully configured but COMMERCE_OS_MODE is not set to "live"', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real-project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'real-anon-key'
    expect(isDemoMode()).toBe(true)
  })

  it('stays demo when COMMERCE_OS_MODE=live is set but Supabase is not configured — never a broken half-live state', () => {
    process.env.COMMERCE_OS_MODE = 'live'
    expect(isSupabaseConfigured()).toBe(false)
    expect(isDemoMode()).toBe(true)
  })

  it('stays demo when COMMERCE_OS_MODE=live is set but only one of the two Supabase variables is present', () => {
    process.env.COMMERCE_OS_MODE = 'live'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real-project.supabase.co'
    expect(isDemoMode()).toBe(true)
  })

  it('is genuinely live only when COMMERCE_OS_MODE=live AND Supabase is fully configured — the exact regression this file exists to catch', () => {
    process.env.COMMERCE_OS_MODE = 'live'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real-project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'real-anon-key'
    expect(isSupabaseConfigured()).toBe(true)
    expect(isDemoMode()).toBe(false)
  })

  it('an unrecognised COMMERCE_OS_MODE value (typo, wrong case) is treated as demo, never guessed as live', () => {
    process.env.COMMERCE_OS_MODE = 'Live' // wrong case
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real-project.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'real-anon-key'
    expect(isDemoMode()).toBe(true)
  })

  it('whitespace-only Supabase values are treated as absent, not configured', () => {
    process.env.COMMERCE_OS_MODE = 'live'
    process.env.NEXT_PUBLIC_SUPABASE_URL = '   '
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'real-anon-key'
    expect(isSupabaseConfigured()).toBe(false)
    expect(isDemoMode()).toBe(true)
  })
})
