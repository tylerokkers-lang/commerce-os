'use server'

import { redirect } from 'next/navigation'
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

  // Deliberately generic: a distinct "no such account" message would let anyone
  // enumerate which email addresses have access.
  if (error) return { error: 'Those details were not recognised.' }

  redirect(next.startsWith('/') ? next : '/')
}
