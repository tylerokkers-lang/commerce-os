import 'server-only'

import { cache } from 'react'
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
  if (error || !data.user) return null

  const { data: membership } = await supabase
    .from('memberships')
    .select('org_id, role, organisations(name)')
    .eq('user_id', data.user.id)
    .limit(1)
    .maybeSingle()

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
