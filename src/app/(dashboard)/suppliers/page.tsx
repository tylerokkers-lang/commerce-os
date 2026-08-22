import { Badge, Card, EmptyState, PageHeader, TableWrap } from '@/components/ui'
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

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="A supplier is approved per channel, never globally. One that is perfectly acceptable for Shopify can be unusable for Amazon, most often because it cannot ship as seller of record or will not handle returns."
      />

      <Card>
        {suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet" description="Add a supplier to begin assessing it against each channel's requirements." />
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
                  <th className="px-5 py-2.5 text-right font-medium">On time</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-3">
                      <p className="font-medium">{supplier.name}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {supplier.country ?? 'Unknown'} · {supplier.productCount} product{supplier.productCount === 1 ? '' : 's'}
                      </p>
                      {supplier.statusReason ? (
                        <p className="mt-1.5 max-w-md text-xs text-ink-muted">{supplier.statusReason}</p>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-3 text-right font-medium">{supplier.score}</td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONES[supplier.shopifyStatus]}>{STATUS_LABELS[supplier.shopifyStatus]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS_TONES[supplier.amazonStatus]}>{STATUS_LABELS[supplier.amazonStatus]}</Badge>
                    </td>
                    <td className="tabular px-3 py-3">
                      {supplier.deliveryDaysMin !== null && supplier.deliveryDaysMax !== null
                        ? `${supplier.deliveryDaysMin} to ${supplier.deliveryDaysMax} days`
                        : 'Unknown'}
                    </td>
                    <td className="tabular px-5 py-3 text-right">{formatPct(supplier.onTimeRatePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}
