import { Badge, CardHeader } from '@/components/ui'
import { compareSupplierOffers } from '@/lib/suppliers/discovery/offerComparison'
import type { SupplierOfferSummary } from '@/lib/suppliers/discovery/repository'

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

/**
 * Read-only: compares whatever real `supplier_products` offers already
 * exist for this product (the brief's own "PRODUCT SOURCE HISTORY" —
 * already fully supported by that table's schema, nothing new added) and
 * explains the preferred one, never assuming cheapest is best.
 */
export function SupplierOffersPanel({ offers }: { offers: readonly SupplierOfferSummary[] }) {
  if (offers.length === 0) {
    return (
      <>
        <CardHeader title="Supplier offers" description="No supplier offer is on file for this product yet." />
      </>
    )
  }

  const comparison = compareSupplierOffers(offers)

  return (
    <>
      <CardHeader
        title="Supplier offers"
        description={offers.length > 1 ? `${offers.length} suppliers offer this product.` : '1 supplier offers this product.'}
      />
      <div className="border-t border-border px-5 py-4">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Preferred</p>
        <p className="mt-1 text-sm text-ink-muted">{comparison.reason}</p>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-ink-subtle">
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Cost</th>
              <th className="px-3 py-2">Shipping</th>
              <th className="px-3 py-2">Delivery</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {comparison.ranked.map((ranked) => {
              const offer = offers.find((o) => o.supplierId === ranked.supplierId)!
              return (
                <tr key={ranked.supplierId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-ink">
                    {offer.supplierName}
                    {ranked.supplierId === comparison.preferredSupplierId ? <Badge tone="positive" className="ml-2">Preferred</Badge> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">{formatMoney(offer.unitCostMinor, offer.currency)}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">{formatMoney(offer.shippingCostMinor, offer.currency)}</td>
                  <td className="px-3 py-2 text-ink">{offer.deliveryDaysMax !== null ? `Up to ${offer.deliveryDaysMax}d` : 'Not available'}</td>
                  <td className="px-3 py-2 tabular-nums text-ink">{ranked.compositeScore}/100</td>
                  <td className="px-3 py-2">
                    {ranked.excludedReason ? <Badge tone="negative">{ranked.excludedReason}</Badge> : <Badge tone="neutral">Available</Badge>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
