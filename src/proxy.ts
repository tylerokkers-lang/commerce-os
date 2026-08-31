import { createServerClient } from '@supabase/ssr'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { isDemoMode } from '@/lib/core/env'

/**
 * Runs before every matched request.
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie. Server Components cannot write
 *      cookies, so this is the only place a rotating refresh token can be
 *      persisted.
 *   2. Keep unauthenticated visitors out of the dashboard when running live.
 *
 * In demo mode there is no Supabase project and no user, so this steps aside
 * entirely and the application is browsable immediately.
 *
 * Note: this file is `proxy.ts`, not `middleware.ts`. The middleware convention
 * was deprecated and renamed in Next.js 16.
 */

const PUBLIC_PATHS = ['/login', '/auth', '/api/health']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export async function proxy(request: NextRequest) {
  // Milestone: live infrastructure activation (Phase 11). Previously a
  // second, independent copy of this check lived here — `core/env.ts`'s
  // `isDemoMode()` had a genuine inverted-logic bug (see its own comment)
  // that this local duplicate did not share, which is exactly the risk
  // duplicated logic carries: two copies silently drifting apart with no
  // way to notice until one of them is actually exercised. `core/env.ts`
  // has no imports of its own (pure `process.env` reads), so it is fully
  // Edge-runtime-safe to import directly here — there was never a real
  // reason for a separate copy.
  if (isDemoMode()) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Revalidates the token against Supabase rather than trusting the cookie.
  //
  // Milestone: live infrastructure activation (Phase 11). A genuine
  // connection failure here (network error, wrong URL, a paused project)
  // must never be treated the same as "no valid session." Verified
  // directly (not assumed): Supabase's own client never *throws* from
  // `getUser()` for a network failure — it always resolves cleanly with
  // `{ data: { user: null }, error }`, wrapping even a DNS/connection
  // failure into that same shape a routine "not logged in" response uses.
  // A `try/catch` here would silently never fire — confirmed by directly
  // testing the real client against an unreachable host during this
  // milestone's work, which is exactly why this checks the *resolved*
  // error's real type instead, via Supabase's own `isAuthRetryableFetchError`
  // (the class it documents itself as using specifically for a transient
  // fetch failure, distinct from every genuine "no valid session" error
  // shape). On a real connectivity failure this lets the request through
  // unredirected: the page itself (`(dashboard)/layout.tsx`) calls
  // `getUser()` again via `getSession()`, whose own equivalent check *can*
  // render a real "database connection unavailable" message, unlike this
  // proxy, which can only redirect or pass through. This proxy's job stays
  // narrow: refresh the cookie and gate genuinely-unauthenticated
  // visitors, never diagnose an outage.
  const { data, error } = await supabase.auth.getUser()
  if (error && isAuthRetryableFetchError(error)) {
    return response
  }

  if (!data.user && !isPublic(request.nextUrl.pathname)) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  // Without a matcher this would also run on static assets and images, which
  // would make every CSS and JS request pay for an auth round trip.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
