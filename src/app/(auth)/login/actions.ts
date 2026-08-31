'use server'

import { redirect } from 'next/navigation'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/core/env'
import type { LoginState } from './state'

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  if (isDemoMode()) redirect('/')

  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  if (!email || !password) return { error: 'Enter your email address and password.' }

  const supabase = await createServerSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Milestone: live infrastructure activation (Phase 11). A genuine
    // connection failure (network error, wrong Supabase URL, a paused
    // project) must never be reported as "those details were not
    // recognised" — that would tell a real admin hitting a genuine
    // outage that *they* made a mistake, when the infrastructure did.
    // Verified directly: `signInWithPassword` resolves this the same way
    // `getUser()` does — cleanly, with `AuthRetryableFetchError`, never a
    // thrown exception — so this checks the real error type rather than
    // relying on a try/catch that would never fire.
    if (isAuthRetryableFetchError(error)) {
      return { error: 'Could not reach the database. Live mode is enabled but the Supabase connection is currently unavailable — this is an infrastructure problem, not an incorrect password.' }
    }
    // Deliberately generic for every other failure: a distinct "no such
    // account" message would let anyone enumerate which email addresses
    // have access.
    return { error: 'Those details were not recognised.' }
  }

  redirect(next.startsWith('/') ? next : '/')
}
