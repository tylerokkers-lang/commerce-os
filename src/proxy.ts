import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

function isDemo(): boolean {
  const configured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  return process.env.COMMERCE_OS_MODE !== 'live' || !configured
}

export async function proxy(request: NextRequest) {
  if (isDemo()) return NextResponse.next()

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
  const { data } = await supabase.auth.getUser()

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
