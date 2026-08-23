import { Badge, Card, CardHeader, EmptyState, PageHeader, type Tone } from '@/components/ui'
import { formatMoney, money } from '@/lib/core/money'
import { formatDateTime } from '@/lib/utils'
import { getPriceAlerts, getSupplierConnectors } from '@/lib/suppliers/connectors/repository'

export const dynamic = 'force-dynamic'

const STATUS_TONES: Record<string, Tone> = {
  healthy: 'positive',
  ready: 'accent',
  degraded: 'caution',
  rate_limited: 'caution',
  failing: 'negative',
  disabled: 'neutral',
  not_configured: 'neutral',
}

const SOURCE_LABELS: Record<string, string> = {
  api: 'API',
  feed: 'Feed',
  csv: 'CSV',
  manual: 'Manual',
  custom: 'Custom',
}

export default async function SupplierConnectorsPage() {
  const [connectors, priceAlerts] = await Promise.all([getSupplierConnectors(), getPriceAlerts()])
  const active = connectors.filter((c) => c.isConfigured && c.isEnabled)

  return (
    <>
      <PageHeader
        title="Supplier connectors"
        description="Where supplier cost, stock and delivery data comes from. Each connector is a separate, independently configured source with its own status — a connector without credentials is never shown as connected."
      />

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">How this differs from a supplier record</p>
          <p className="mt-1 max-w-3xl text-sm text-ink">
            A supplier is who you buy from. A connector is how their data reaches this system — by
            hand, by CSV, by feed, or by API. The same supplier can move from a manual catalogue to a
            live feed later without changing who they are; only the connector changes. No connector
            here claims to be live unless it genuinely has credentials and a written integration
            behind it.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {active.length} of {connectors.length} connector types are active.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Price changes detected"
          description="Comparing each connector's current cost against the last one it reported."
        />
        {priceAlerts.length === 0 ? (
          <EmptyState title="No price changes" description="No connector has reported a different cost since the last sync." />
        ) : (
          <ul className="divide-y divide-border">
            {priceAlerts.map((alert) => (
              <li key={`${alert.supplierRef}-${alert.productRef}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{alert.supplierName}</p>
                  <p className="text-xs text-ink-subtle">{alert.productRef.replace(/^demo-/, '').replace(/-/g, ' ')}</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm">
                    {formatMoney(money(alert.previousUnitCostMinor, 'GBP'))} →{' '}
                    {formatMoney(money(alert.newUnitCostMinor, 'GBP'))}
                  </p>
                  <Badge tone={alert.direction === 'increase' ? 'caution' : 'positive'}>
                    {alert.direction === 'increase' ? '+' : ''}
                    {alert.changePct.toFixed(1)}%
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4">
        {connectors.map((connector) => (
          <Card key={connector.key}>
            <CardHeader
              title={connector.label}
              description={connector.description}
              action={
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={STATUS_TONES[connector.status] ?? 'neutral'}>
                    {connector.status.replace(/_/g, ' ')}
                  </Badge>
                  <Badge tone={connector.sourceType === 'manual' ? 'demo' : 'neutral'}>
                    {SOURCE_LABELS[connector.sourceType] ?? connector.sourceType}
                  </Badge>
                </div>
              }
            />

            <div className="px-5 py-4">
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
                Permitted use
              </p>
              <p className="mt-1 max-w-3xl text-sm text-ink-muted">{connector.permittedUseNote}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={connector.authenticatedFirstParty ? 'positive' : 'neutral'}>
                  {connector.authenticatedFirstParty
                    ? 'Our own credentials'
                    : 'Not a first-party authenticated source'}
                </Badge>
                {connector.termsUrl ? (
                  <a
                    href={connector.termsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-accent hover:underline"
                  >
                    Terms
                  </a>
                ) : null}
              </div>
            </div>

            <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Rate limit</dt>
                <dd className="mt-0.5 text-sm">
                  {connector.rateLimitPerMinute === null && connector.rateLimitPerDay === null
                    ? 'None declared'
                    : [
                        connector.rateLimitPerMinute ? `${connector.rateLimitPerMinute}/min` : null,
                        connector.rateLimitPerDay ? `${connector.rateLimitPerDay}/day` : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                </dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Minimum gap between runs</dt>
                <dd className="tabular mt-0.5 text-sm">{connector.minSecondsBetweenRuns}s</dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Last success</dt>
                <dd className="mt-0.5 text-sm">
                  {connector.lastSuccessAt ? formatDateTime(connector.lastSuccessAt) : 'Never run'}
                </dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Last failure</dt>
                <dd className="mt-0.5 text-sm">
                  {connector.lastFailureAt ? formatDateTime(connector.lastFailureAt) : 'None'}
                  {connector.consecutiveFailures > 0 ? ` (${connector.consecutiveFailures} in a row)` : ''}
                </dd>
              </div>
            </dl>

            {connector.missingCredentials.length > 0 ? (
              <div className="border-t border-border px-5 py-3">
                <p className="text-xs font-medium text-ink-subtle">Required environment variables</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {connector.missingCredentials.map((name) => (
                    <li key={name}>
                      <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink-muted">
                        {name}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {connector.lastError ? (
              <div className="border-t border-negative/25 bg-negative-soft px-5 py-3">
                <p className="text-sm text-ink">{connector.lastError}</p>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  )
}
