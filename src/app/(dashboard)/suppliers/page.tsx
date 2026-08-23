import Link from 'next/link'
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from '@/components/ui'
import { formatPct } from '@/lib/utils'
import { getSuppliers } from '@/lib/suppliers/repository'
import type { ApprovalStatus } from '@/lib/core/domain'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  approved: 'Approved',
  blocked: 'Blocked',
  review_required: 'Review required',
  not_assessed: 'Not assessed',
}

const STATUS_TONES: Record<ApprovalStatus, 'positive' | 'negative' | 'caution' | 'neutral'> = {
  approved: 'positive',
  blocked: 'negative',
  review_required: 'caution',
  not_assessed: 'neutral',
}

export default async function SuppliersPage() {
  const suppliers = await getSuppliers()

  const cheapest = suppliers.length === 0 ? null : [...suppliers].sort((a, b) => a.score - b.score)[0]

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Scored on cost, delivery, reliability, quality, returns, tracking and compliance capability. Cost carries less weight than delivery and reliability combined, because a cheap supplier that arrives late costs more than it saves."
        action={
          <Link
            href="/suppliers/new"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            Add supplier
          </Link>
        }
      />

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">Approval is per channel</p>
          <p className="mt-1 max-w-3xl text-sm text-ink">
            A supplier is never approved globally. Amazon requires that we remain the seller of
            record, that no other retailer appears on the parcel or paperwork, and that we handle
            returns. A supplier that cannot meet all three can still be perfectly good for Shopify,
            so the two statuses are assessed and stored separately.
          </p>
        </div>
      </Card>

      <Card>
        {suppliers.length === 0 ? (
          <EmptyState
            title="No suppliers yet"
            description="Add a supplier to begin assessing it against each channel's requirements."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Supplier</th>
                  <th className="px-3 py-2.5 text-right font-medium">Score</th>
                  <th className="px-3 py-2.5 font-medium">Shopify</th>
                  <th className="px-3 py-2.5 font-medium">Amazon UK</th>
                  <th className="px-3 py-2.5 font-medium">Delivery</th>
                  <th className="px-3 py-2.5 text-right font-medium">On time</th>
                  <th className="px-5 py-2.5 font-medium">Capability</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-3">
                      <Link href={`/suppliers/${supplier.id}`} className="font-medium text-accent hover:underline">
                        {supplier.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {supplier.country ?? 'Unknown'}
                        {supplier.platform ? ` · ${supplier.platform}` : ''} ·{' '}
                        {supplier.productCount} product{supplier.productCount === 1 ? '' : 's'}
                      </p>
                      {supplier.statusReason ? (
                        <p className="mt-1.5 max-w-sm text-xs text-ink-muted">{supplier.statusReason}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <p className="tabular font-medium">{supplier.score}</p>
                      <p className="text-xs text-ink-subtle">{supplier.band}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONES[supplier.shopifyStatus]}>
                        {STATUS_LABELS[supplier.shopifyStatus]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONES[supplier.amazonStatus]}>
                        {STATUS_LABELS[supplier.amazonStatus]}
                      </Badge>
                    </td>
                    <td className="tabular px-3 py-3">
                      {supplier.deliveryDaysMin !== null && supplier.deliveryDaysMax !== null
                        ? `${supplier.deliveryDaysMin} to ${supplier.deliveryDaysMax} days`
                        : 'Unknown'}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <p className="tabular">{formatPct(supplier.onTimeRatePct)}</p>
                      <p className="text-xs text-ink-subtle">{supplier.ordersPlaced} orders</p>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={supplier.supportsCustomInvoice ? 'positive' : 'negative'}>
                          Seller of record
                        </Badge>
                        <Badge tone={supplier.supportsBlindShipping ? 'positive' : 'negative'}>
                          Blind ship
                        </Badge>
                        <Badge tone={supplier.providesTracking ? 'positive' : 'negative'}>Tracking</Badge>
                        <Badge tone={supplier.handlesReturns ? 'positive' : 'negative'}>Returns</Badge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {cheapest && cheapest.score < 50 ? (
        <Card className="border-caution/30">
          <CardHeader title="Why the cheapest supplier is not the recommendation" />
          <div className="px-5 py-4">
            <p className="text-sm text-ink-muted">
              {cheapest.name} offers the lowest unit cost of any supplier here and scores{' '}
              {cheapest.score}/100. {cheapest.weaknesses[0] ?? ''} The ranking engine sorts on the
              composite score, not on price, so it is never selected automatically on cost alone.
            </p>
          </div>
        </Card>
      ) : null}
    </>
  )
}
