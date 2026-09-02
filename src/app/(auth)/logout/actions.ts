'use server'

import { redirect } from 'next/navigation'
import { createServerSupabase } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/core/env'

/**
 * `{ scope: 'local' }` rather than the library default (`'global'`, which
 * signs the user out on every device they're currently signed in on) —
 * Commerce OS is a multi-member application (owner/admin/analyst/viewer),
 * and a member clicking "Sign out" on one device should not silently end
 * every other member's — or their own other device's — session too.
 *
 * Verified directly against `@supabase/auth-js`'s own `_signOut`
 * implementation: the local session (and, via this app's cookie adapter,
 * the auth cookies) is cleared regardless of whether the server-side
 * revoke call succeeds — a genuine connectivity failure calling Supabase's
 * logout endpoint still leaves the browser signed out locally, which is
 * exactly what "prevent continued access to protected routes" requires.
 * `proxy.ts` independently re-validates the session on every request
 * regardless, so even in the one case that isn't true (the cookie write
 * itself failing) a stale cookie still cannot reach a protected route.
 */
export async function signOut() {
  // Demo mode has no real session to end (matches `signIn`'s and
  // `LoginPage`'s own demo-mode short-circuit).
  if (isDemoMode()) redirect('/')

  const supabase = await createServerSupabase()
  await supabase.auth.signOut({ scope: 'local' })

  redirect('/login')
}
