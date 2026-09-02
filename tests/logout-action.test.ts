import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 13 — authentication & session hardening.
 *
 * `signOut` (`src/app/(auth)/logout/actions.ts`) is a `'use server'` action,
 * so like every other server-only auth file in this codebase it cannot run
 * against a real Supabase project inside Vitest — that is proven live in the
 * browser instead (see `HANDOVER.md`'s Phase 13 section). What Vitest *can*
 * genuinely prove, by mocking only Next.js's own `redirect`/`cookies` and
 * this repo's own Supabase client factory (never a new auth library, never a
 * parallel session mechanism), is the action's control flow: which scope it
 * signs out with, that it never skips the redirect, and — the specific
 * "fails safely" requirement — that a signOut error from Supabase still
 * results in a redirect to `/login` rather than a stuck or misleading state.
 */

const signOutMock = vi.fn()
const createServerSupabaseMock = vi.fn(async () => ({ auth: { signOut: signOutMock } }))
const isDemoModeMock = vi.fn(() => false)

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => createServerSupabaseMock(),
}))

vi.mock('@/lib/core/env', () => ({
  isDemoMode: () => isDemoModeMock(),
}))

class RedirectSignal extends Error {
  constructor(public destination: string) {
    super(`NEXT_REDIRECT:${destination}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => {
    throw new RedirectSignal(destination)
  },
}))

async function runSignOut() {
  const { signOut } = await import('../src/app/(auth)/logout/actions')
  try {
    await signOut()
    throw new Error('signOut() returned without redirecting — the redirect is the whole point of this action')
  } catch (error) {
    if (error instanceof RedirectSignal) return error.destination
    throw error
  }
}

beforeEach(() => {
  vi.resetModules()
  signOutMock.mockReset()
  createServerSupabaseMock.mockClear()
  isDemoModeMock.mockReset().mockReturnValue(false)
  signOutMock.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('signOut', () => {
  it('demo mode: redirects to / and never touches Supabase', async () => {
    isDemoModeMock.mockReturnValue(true)

    const destination = await runSignOut()

    expect(destination).toBe('/')
    expect(createServerSupabaseMock).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('live mode, successful sign-out: signs out with local scope and redirects to /login', async () => {
    const destination = await runSignOut()

    expect(signOutMock).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    expect(destination).toBe('/login')
  })

  it('uses local scope, not the library default global scope', async () => {
    // Regression guard for the deliberate choice documented in the action
    // itself: global scope would end every device/member's session, not
    // just the one clicking "Sign out" — the opposite of what a
    // multi-member application's sign-out button should do.
    await runSignOut()

    const [options] = signOutMock.mock.calls[0] as [{ scope: string }]
    expect(options.scope).toBe('local')
    expect(options.scope).not.toBe('global')
  })

  it('fails safely: a Supabase sign-out error still redirects to /login, not a stuck or misleading state', async () => {
    signOutMock.mockResolvedValue({
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 },
    })

    const destination = await runSignOut()

    expect(destination).toBe('/login')
  })

  it('never throws the raw Supabase error out to the caller', async () => {
    signOutMock.mockResolvedValue({
      error: { name: 'AuthApiError', message: 'some internal detail that must never reach the user', status: 500 },
    })

    await expect(runSignOut()).resolves.toBe('/login')
  })
})
