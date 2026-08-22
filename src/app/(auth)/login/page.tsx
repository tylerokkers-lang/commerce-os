import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui'
import { isDemoMode } from '@/lib/core/env'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function LoginPage(props: PageProps<'/login'>) {
  // Demo mode has no accounts to sign into, so there is nothing to ask for.
  if (isDemoMode()) redirect('/')

  const searchParams = await props.searchParams
  const nextParam = searchParams.next
  const next = typeof nextParam === 'string' && nextParam.startsWith('/') ? nextParam : '/'

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Commerce OS</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in to your business.</p>
        </div>
        <Card className="px-5 py-5">
          <LoginForm next={next} />
        </Card>
        <p className="mt-4 text-center text-xs text-ink-subtle">
          Accounts are created by an owner from{' '}
          <Link href="/settings" className="text-accent hover:underline">business settings</Link>, not
          self-service.
        </p>
      </div>
    </main>
  )
}
