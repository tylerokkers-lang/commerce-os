import { redirect } from 'next/navigation'
import { Card } from '@/components/ui'
import { isDemoMode } from '@/lib/core/env'
import { ResetPasswordForm } from './ResetPasswordForm'

export const dynamic = 'force-dynamic'

/**
 * Where a Supabase invite/recovery email link lands. The token that proves
 * who this is arrives in the URL fragment (`#access_token=...`), which is
 * never sent to the server — this whole page has to be public
 * (`src/proxy.ts`'s `PUBLIC_PATHS`) and the actual session exchange has to
 * happen client-side, in `ResetPasswordForm`, using the same
 * `@supabase/ssr` browser client `login/LoginForm.tsx`'s server-side
 * counterpart already relies on to keep client and server session state in
 * sync via cookies.
 */
export default function ResetPasswordPage() {
  if (isDemoMode()) redirect('/')

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Commerce OS</h1>
          <p className="mt-1 text-sm text-ink-muted">Set a new password.</p>
        </div>
        <Card className="px-5 py-5">
          <ResetPasswordForm />
        </Card>
      </div>
    </main>
  )
}
