import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from '@/lib/core/env'
import type { Database } from './database.types'

/**
 * Request-scoped client that acts as the signed-in user. RLS applies, which is
 * the point: page and Server Action code cannot read another org's data even
 * if a query forgets its `org_id` filter.
 */
export async function createServerSupabase() {
  // `cookies()` is async in Next 16 — synchronous access was removed.
  const cookieStore = await cookies()

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh happens in proxy.ts instead, so this is safe to
          // swallow rather than crash the render.
        }
      },
    },
  })
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for trusted server-side automation: syncs, schedulers, webhook handlers
 * and audit writes. Never expose it to a request whose org came from user
 * input without checking membership first.
 */
export function createServiceSupabase() {
  return createServerClient<Database>(supabaseUrl(), supabaseServiceKey(), {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
