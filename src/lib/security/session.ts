import 'server-only'

import { cache } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { isDemoMode, isSupabaseConfigured } from '@/lib/core/env'
import { createServerSupabase } from '@/lib/supabase/server'
import { canWrite } from './roles'
import type { Enums } from '@/lib/supabase/database.types'

export { canWrite, canApprove } from './roles'

/**
 * Who is asking, and which business are they asking about.
 *
 * In demo mode there is no Supabase project and no real user, so a synthetic
 * owner session is returned. This is what lets the whole application be
 * explored before any credentials exist (§55), and it is always flagged so no
 * screen can present simulated data as real.
 */

export interface SessionContext {
  isDemo: boolean
  userId: string
  email: string
  orgId: string
  orgName: string
  role: Enums<'member_role'>
}

export const DEMO_SESSION: SessionContext = {
  isDemo: true,
  userId: 'demo-user',
  email: 'owner@demo.local',
  orgId: 'demo-org',
  orgName: 'Demo Commerce Co',
  role: 'owner',
}

/**
 * Thrown by `getSession()` when `COMMERCE_OS_MODE=live` is set and Supabase
 * is genuinely unreachable — a network failure, a wrong URL, a paused
 * project (Milestone: live infrastructure activation, Phase 11). Distinct
 * from "not authenticated": a real Supabase connection cleanly reporting
 * "no valid session" still correctly returns `null` below and redirects to
 * `/login`, exactly as before. This class exists so that case can never be
 * confused with an actual outage — before this, both looked identical to a
 * caller (`getSession()` returning `null`), which meant an admin hitting a
 * genuine live-mode database outage was silently bounced to the login
 * screen with no indication anything was actually broken, rather than
 * seeing an honest "database connection unavailable" message.
 *
 * Verified directly, not assumed: Supabase's own auth client never
 * *throws* from `getUser()` for a network failure — confirmed by testing
 * the real client against an unreachable host during this milestone's own
 * work, which resolved cleanly to `{ data: { user: null }, error }` every
 * time, `error` being `AuthRetryableFetchError` (Supabase's own documented
 * class specifically for a transient fetch failure). A `try/catch` around
 * the call would silently never fire. `isAuthRetryableFetchError` (from
 * `@supabase/supabase-js`, already a direct dependency) is the real,
 * reliable signal checked below instead. Caught by `(dashboard)/layout.tsx`
 * server-side, before Next.js's client-side error redaction would strip
 * this message's detail in a production build.
 */
export class LiveConnectionError extends Error {
  constructor(detail: string) {
    super(`Live mode is enabled (COMMERCE_OS_MODE=live) but the Supabase connection failed: ${detail}`)
    this.name = 'LiveConnectionError'
  }
}

/**
 * Resolves the session for the current request.
 *
 * `cache` deduplicates this within a single render pass, so a layout and five
 * nested Server Components asking for the session cause one lookup, not six.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  if (isDemoMode() || !isSupabaseConfigured()) return DEMO_SESSION

  const supabase = await createServerSupabase()
  // getUser revalidates the token against Supabase. getSession would trust
  // whatever is in the cookie, which is not good enough for an auth check.
  const { data, error } = await supabase.auth.getUser()
  if (error && isAuthRetryableFetchError(error)) throw new LiveConnectionError(error.message)
  if (error || !data.user) return null

  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('org_id, role, organisations(name)')
    .eq('user_id', data.user.id)
    .limit(1)
    .maybeSingle()
  // A Postgrest error here (as opposed to a clean "no row") means the
  // query itself could not be answered — a connection/configuration
  // problem, not "this user has no membership." Never silently treated
  // as `null` (which would look like an access issue, not an outage).
  if (membershipError) throw new LiveConnectionError(membershipError.message)
  if (!membership) return null

  const organisation = membership.organisations as unknown as { name: string } | null

  return {
    isDemo: false,
    userId: data.user.id,
    email: data.user.email ?? '',
    orgId: membership.org_id,
    orgName: organisation?.name ?? 'Untitled business',
    role: membership.role,
  }
})

/** For code paths that cannot meaningfully continue without a session. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')
  return session
}

/**
 * Guard for Server Actions. Server Functions are reachable by direct POST, not
 * only through the UI, so every one of them must check permission itself.
 */
export async function requireWriteAccess(): Promise<SessionContext> {
  const session = await requireSession()
  if (!canWrite(session)) {
    throw new Error(`Role "${session.role}" is not permitted to make changes`)
  }
  return session
}
