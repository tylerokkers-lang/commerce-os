import { integrationStatus, isDemoMode, isSupabaseConfigured } from '@/lib/core/env'
import { createServiceSupabase } from '@/lib/supabase/server'

/**
 * Liveness and configuration check. Reports which integrations are configured
 * but never the credential values themselves.
 *
 * Production scheduler & automation operations milestone: `configured`
 * (an env var being present) is not the same fact as `reachable` (a real
 * query against the real database actually succeeding) — this route
 * previously only ever reported the former, which cannot answer "is
 * Supabase unavailable right now?", one of the operational questions this
 * milestone's own brief names explicitly. `supabase.reachable` below is a
 * genuine, live, single cheap query (`count`-only, no rows), not inferred
 * from configuration. In demo mode there is no real project to check, so
 * this is `null` (never fabricated `true`/`false`) rather than skipped
 * silently.
 */
export async function GET() {
  let supabaseReachable: boolean | null = null
  if (!isDemoMode() && isSupabaseConfigured()) {
    try {
      const { error } = await createServiceSupabase().from('organisations').select('id', { count: 'exact', head: true })
      supabaseReachable = !error
    } catch {
      supabaseReachable = false
    }
  }

  return Response.json({
    status: 'ok',
    mode: isDemoMode() ? 'demo' : 'live',
    checkedAt: new Date().toISOString(),
    supabase: { reachable: supabaseReachable },
    integrations: integrationStatus().map((i) => ({
      key: i.key,
      configured: i.configured,
      missingCount: i.missing.length,
    })),
  })
}
