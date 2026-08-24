import { Badge, Card, PageHeader } from '@/components/ui'
import { getIntegrationHealth } from '@/lib/integrations/health'
import type { IntegrationHealth } from '@/lib/core/domain'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<IntegrationHealth['status'], string> = {
  connected: 'Connected',
  demo: 'Simulated',
  not_configured: 'Not configured',
  error: 'Error',
}

const STATUS_TONES: Record<IntegrationHealth['status'], 'positive' | 'demo' | 'neutral' | 'negative'> = {
  connected: 'positive',
  demo: 'demo',
  not_configured: 'neutral',
  error: 'negative',
}

const DESCRIPTIONS: Record<string, string> = {
  supabase: 'Database, authentication and file storage. Everything else depends on this.',
  shopify: 'Products, inventory, orders and fulfilment on the Shopify channel.',
  amazon: 'Listings, inventory, pricing, orders and reports through the Selling Partner API.',
  resend: 'Delivers invoices, alerts and the daily report by email.',
  xero: 'Pushes invoices, credit notes and expenses into your accounting system.',
  anthropic: 'Powers the Commerce Intelligence chat, research summaries, listing content and decision reasoning.',
}

export default async function IntegrationsPage() {
  const integrations = await getIntegrationHealth()

  return (
    <>
      <PageHeader
        title="Integrations"
        description="What is genuinely connected. An integration is only ever reported as live when its credentials are actually present, so nothing here can imply a connection that does not exist."
      />

      <div className="grid gap-4">
        {integrations.map((integration) => (
          <Card key={integration.key}>
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">{integration.label}</h2>
                  <Badge tone={STATUS_TONES[integration.status]}>{STATUS_LABELS[integration.status]}</Badge>
                </div>
                <p className="mt-1 max-w-xl text-sm text-ink-muted">{DESCRIPTIONS[integration.key]}</p>

                {integration.missingCredentials.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-ink-subtle">Missing environment variables</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {integration.missingCredentials.map((name) => (
                        <li key={name}>
                          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink-muted">
                            {name}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <dl className="shrink-0 space-y-1 text-right text-xs text-ink-subtle">
                <div>
                  <dt className="inline">Last success: </dt>
                  <dd className="inline">{integration.lastSuccessAt ?? 'never'}</dd>
                </div>
                <div>
                  <dt className="inline">Last failure: </dt>
                  <dd className="inline">{integration.lastFailureAt ?? 'none'}</dd>
                </div>
                <div>
                  <dt className="inline">Next retry: </dt>
                  <dd className="inline">{integration.nextRetryAt ?? 'not scheduled'}</dd>
                </div>
              </dl>
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">Adding credentials</p>
          <p className="mt-1 max-w-3xl text-sm text-ink">
            Credentials belong in environment variables, never in the database and never in this
            interface. Add them to <code className="font-mono text-xs">.env.local</code> for local
            work, or to your hosting provider&rsquo;s environment settings for a deployment, then
            set <code className="font-mono text-xs">COMMERCE_OS_MODE=live</code>. Until then the
            system stays in demo mode, which is deliberate: it cannot touch a real marketplace by
            accident.
          </p>
        </div>
      </Card>
    </>
  )
}
