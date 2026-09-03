'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Status = 'checking' | 'ready' | 'invalid' | 'submitting' | 'done'

/**
 * A Supabase invite/recovery email link's proof of identity arrives as an
 * old-style implicit-grant fragment (`#access_token=...&refresh_token=...`).
 * Nothing here can rely on the client library's own automatic
 * `detectSessionInUrl` handling of that: `@supabase/ssr`'s `createBrowserClient`
 * hardcodes `flowType: 'pkce'` (confirmed by reading the installed
 * package's own source, not assumed — `node_modules/@supabase/ssr/dist/module/createBrowserClient.js`),
 * and a PKCE-flow client only recognises a `?code=` query parameter, never
 * an implicit-grant hash — found live, not by inspection: a first attempt
 * using `onAuthStateChange`/`getSession()` alone consistently reported
 * `INITIAL_SESSION` with no session at all for a genuinely valid, freshly
 * generated recovery link, because `_getSessionFromURL` was never even
 * being triggered.
 *
 * The fix is to parse the fragment ourselves and hand the tokens straight
 * to `setSession()` — a direct, explicit call that works regardless of
 * `flowType`, since it isn't going through the automatic detection path at
 * all. `@supabase/ssr`'s browser client still does its normal job from
 * there: writing the resulting session into cookies in the shape the
 * server client (`createServerSupabase()`) already reads.
 *
 * The `hasRun` ref guard is required, not optional, also found live: React
 * Strict Mode deliberately double-invokes effects in development, and
 * without the guard the second invocation re-parses the URL *after* the
 * first invocation's own success handler has already stripped the tokens
 * from it (see below) — reading no tokens the second time and overwriting
 * a genuinely successful `ready` state with `invalid`.
 */
export function ResetPasswordForm() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    const params = new URLSearchParams(window.location.hash.slice(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    // Both branches resolve through the same `.then()` rather than one of
    // them calling `setState` synchronously in the effect body, which
    // `react-hooks/set-state-in-effect` flags regardless of whether the
    // call is reachable on every render.
    const session = accessToken && refreshToken
      ? createClient().auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      : Promise.resolve({ error: new Error('missing tokens') })

    session.then(({ error: sessionError }) => {
      setStatus(sessionError ? 'invalid' : 'ready')
      if (!sessionError) {
        // The tokens have done their job; drop them from the visible URL
        // rather than leave them sitting in the address bar/history.
        window.history.replaceState(null, '', window.location.pathname)
      }
    })
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setStatus('submitting')
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setStatus('ready')
      return
    }

    setStatus('done')
    setTimeout(() => router.replace('/login'), 1500)
  }

  if (status === 'checking') {
    return <p className="text-sm text-ink-muted">Checking your link…</p>
  }

  if (status === 'invalid') {
    return (
      <p className="text-sm text-negative">
        This link is invalid or has expired. Ask whoever manages your Commerce OS account to send a new one.
      </p>
    )
  }

  if (status === 'done') {
    return <p className="text-sm text-positive">Password set. Taking you to sign in…</p>
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium">Confirm password</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
      </div>
      {error ? <p className="text-sm text-negative">{error}</p> : null}
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {status === 'submitting' ? 'Saving…' : 'Set password'}
      </button>
    </form>
  )
}
