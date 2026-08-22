'use client'

import { createBrowserClient } from '@supabase/ssr'
import { supabaseAnonKey, supabaseUrl } from '@/lib/core/env'
import type { Database } from './database.types'

/**
 * Browser client. Carries only the anon key and is subject to RLS, so the worst
 * a compromised browser session can reach is the org the signed-in user belongs
 * to.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey())
}
