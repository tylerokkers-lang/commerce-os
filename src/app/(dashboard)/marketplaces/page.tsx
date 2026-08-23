import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap, type Tone } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import { getChannelDiscrepancies, getMarketplaceChannels } from '@/lib/marketplaces/repository'

export const dynamic = 'force-dynamic'

const STATUS_TONES: Record<string, Tone> = {
  connected: 'positive',
  demo: 'demo',
  degraded: 'caution',
  error: 'negative',
  not_configured: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  demo: 'Demo',
  degraded: 'Degraded',
  error: 'Error',
  not_configured: 'Not configured',
}

const FIELD_LABELS: Record<string, string> = {
  stock: 'Stock',
  price: 'Price',
  listing_status: 'Listing status',
  order_status: 'Order status',
  fulfilment_status: 'Fulfilment status',
  tracking: 'Tracking',
}

export default async function MarketplacesPage() {
  const [channels, discrepancies] = await Promise.all([getMarketplaceChannels(), getChannelDiscrepancies()])

  return (
    <>
      <PageHeader
        title="Marketplaces"
        description="Shopify and Amazon UK, tracked as separate connections with their own health, sync history and discrepancies. A connector is never shown as connected unless it genuinely has credentials and has actually succeeded."
      />

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">Connecting to a real account</p>
          <p className="mt-1 max-w-3xl text-sm text-ink">
            A successful connection does not publish anything by itself. Every product still has to
            pass the product lifecycle rules, supplier status and fulfilment capability, the
            profitability gate, channel-specific compliance, identifier requirements, and the
            automation permission for your current automation level before it can be listed here.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {channels.map((channel) => (
          <Card key={channel.channel}>
            <CardHeader
              title={channel.label}
              description={channel.isDemo ? 'Simulated data. No real account is connected.' : channel.connectorKey}
              action={
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={STATUS_TONES[channel.status] ?? 'neutral'}>
                    {STATUS_LABELS[channel.status] ?? channel.status}
                  </Badge>
                  {channel.requiresAttention ? <Badge tone="caution">Needs attention</Badge> : null}
                </div>
              }
            />

            <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Listings</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold">{channel.listingCount}</dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Orders</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold">{channel.orderCount}</dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Last successful sync</dt>
                <dd className="mt-0.5 text-sm">
                  {channel.lastSuccessAt ? formatDateTime(channel.lastSuccessAt) : 'Never run'}
                </dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Last failed sync</dt>
                <dd className="mt-0.5 text-sm">
                  {channel.lastFailureAt ? formatDateTime(channel.lastFailureAt) : 'None'}
                  {channel.consecutiveFailures > 0 ? ` (${channel.consecutiveFailures} in a row)` : ''}
                </dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Inventory sync</dt>
                <dd className="mt-0.5">
                  <Badge
                    tone={
                      channel.inventorySyncStatus === 'ok'
                        ? 'positive'
                        : channel.inventorySyncStatus === 'discrepancies_found'
                          ? 'caution'
                          : 'neutral'
                    }
                  >
                    {channel.inventorySyncStatus.replace(/_/g, ' ')}
                  </Badge>
                </dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Open discrepancies</dt>
                <dd className="tabular mt-0.5 text-sm font-medium">{channel.openDiscrepancyCount}</dd>
              </div>
            </dl>

            {channel.lastError ? (
              <div className="border-t border-negative/25 bg-negative-soft px-5 py-3">
                <p className="text-sm text-ink">{channel.lastError}</p>
              </div>
            ) : null}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Discrepancies"
          description="Where Commerce OS's own record disagrees with what the marketplace itself reports. Neither side is assumed correct."
        />
        {discrepancies.length === 0 ? (
          <EmptyState
            title="No discrepancies found"
            description="Every field checked in the last sync agreed between Commerce OS and the marketplace."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Channel</th>
                  <th className="px-3 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 font-medium">Field</th>
                  <th className="px-3 py-2.5 text-right font-medium">Commerce OS says</th>
                  <th className="px-3 py-2.5 text-right font-medium">Marketplace says</th>
                  <th className="px-5 py-2.5 font-medium">Detected</th>
                </tr>
              </thead>
              <tbody>
                {discrepancies.map((d) => (
                  <tr key={`${d.channel}-${d.channelProductRef}-${d.field}`} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">{d.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'}</td>
                    <td className="px-3 py-2.5">{d.channelProductRef}</td>
                    <td className="px-3 py-2.5">{FIELD_LABELS[d.field] ?? d.field}</td>
                    <td className="tabular px-3 py-2.5 text-right font-medium">{d.ourValue}</td>
                    <td className="tabular px-3 py-2.5 text-right font-medium">{d.marketplaceValue}</td>
                    <td className="px-5 py-2.5 text-xs text-ink-subtle">{formatDateTime(d.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
          A discrepancy is recorded, never silently resolved by trusting one side. Resolving one is a
          deliberate action, kept in the audit trail like any other.
        </p>
      </Card>
    </>
  )
}
