import { redirect } from 'next/navigation'
import Link from 'next/link'
import { DemoBanner } from '@/components/dashboard/DemoBanner'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { countUnread, getNotifications } from '@/lib/notifications/repository'
import { getPendingApprovals } from '@/lib/automation/approvals'
import { getSession, LiveConnectionError } from '@/lib/security/session'
import { signOut } from '@/app/(auth)/logout/actions'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Handled here, server-side, rather than left to a client error
  // boundary (Milestone: live infrastructure activation, Phase 11):
  // Next.js redacts thrown-error detail for the client in production
  // builds, which would make a genuine "the Supabase connection failed"
  // message indistinguishable from any other crash. Catching it here,
  // before that boundary, means the real (safe — never containing a
  // credential) detail can still be shown honestly.
  let session
  try {
    session = await getSession()
  } catch (error) {
    if (error instanceof LiveConnectionError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-lg rounded-xl border border-negative/40 bg-negative/10 px-6 py-5">
            <p className="text-sm font-semibold text-negative">Live mode — database connection unavailable</p>
            <p className="mt-2 text-sm text-ink-muted">
              Commerce OS is configured for live mode (<code className="rounded bg-surface-inset px-1">COMMERCE_OS_MODE=live</code>),
              but the Supabase connection failed. Nothing has fallen back to demo data — the application has
              stopped rather than show anything that might not be real.
            </p>
            <p className="mt-3 text-xs text-ink-subtle">{error.message}</p>
          </div>
        </div>
      )
    }
    throw error
  }
  if (!session) redirect('/login')

  const [notifications, approvals] = await Promise.all([getNotifications(), getPendingApprovals()])
  const unread = countUnread(notifications)

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-border bg-surface lg:block lg:h-screen lg:sticky lg:top-0">
        <Sidebar orgName={session.orgName} pendingApprovalsCount={approvals.length} unreadNotificationCount={unread} />
      </aside>

      <div className="flex min-w-0 flex-col">
        {session.isDemo ? <DemoBanner /> : null}

        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3 lg:hidden">
          <span className="text-sm font-semibold">Commerce OS</span>
          <span className="text-xs text-ink-subtle">{session.orgName}</span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            {children}
            <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-ink-subtle">
              <span>Signed in as {session.email}</span>
              <span aria-hidden>·</span>
              <span>Role: {session.role}</span>
              <span aria-hidden>·</span>
              <Link href="/notifications" className="text-accent hover:underline">{unread} unread notification{unread === 1 ? '' : 's'}</Link>
              {!session.isDemo ? (
                <>
                  <span aria-hidden>·</span>
                  <form action={signOut}>
                    <button type="submit" className="text-accent hover:underline">
                      Sign out
                    </button>
                  </form>
                </>
              ) : null}
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}
