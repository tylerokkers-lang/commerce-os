'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

/**
 * Browser client. Carries only the anon key and is subject to RLS, so the worst
 * a compromised browser session can reach is the org the signed-in user belongs
 * to.
 *
 * Deliberately reads `process.env.NEXT_PUBLIC_*` as static literals here
 * rather than through `core/env.ts`'s `supabaseUrl()`/`supabaseAnonKey()` —
 * found live, not by inspection, wiring up this file's first-ever caller
 * (`reset-password/ResetPasswordForm.tsx`): those helpers do a *dynamic*
 * `process.env[key]` lookup, which Next.js's client bundler cannot
 * statically analyse and inline, so it silently compiles to `undefined` in
 * the browser. `src/proxy.ts` already had to work around the exact same
 * constraint for its own Edge-runtime client, for the same reason — this
 * matches that established precedent rather than inventing a second one.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
