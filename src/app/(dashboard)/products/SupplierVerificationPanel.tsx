import { CardHeader } from '@/components/ui'
import { compareSupplierOffers } from '@/lib/suppliers/discovery/offerComparison'
import type { SupplierOfferSummary } from '@/lib/suppliers/discovery/repository'

/**
 * Milestone: supplier product verification link.
 *
 * A compact, single-purpose section distinct from `SupplierOffersPanel`
 * (which compares *multiple* offers against each other): this is for a
 * human to manually verify the ONE supplier Commerce OS is actually
 * relying on — click through to the real supplier site and compare what
 * it shows against what Commerce OS has on file, fact by fact. Every
 * value is either a real fact already stored elsewhere in this schema or
 * the literal string "Unknown" — never inferred, never defaulted.
 */

interface ProductFacts {
  supplierTitle: string | null
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-sm text-ink-subtle">{label}</td>
      <td className="px-3 py-2 text-sm text-ink">{value ?? <span className="text-ink-subtle italic">Unknown</span>}</td>
    </tr>
  )
}

export function SupplierVerificationPanel({ product, offers }: { product: ProductFacts; offers: readonly SupplierOfferSummary[] }) {
  if (offers.length === 0) return null

  const comparison = compareSupplierOffers(offers)
  const preferred = offers.find((o) => o.supplierId === comparison.preferredSupplierId) ?? offers[0]

  const dimensions =
    preferred && product.lengthMm !== null && product.widthMm !== null && product.heightMm !== null
      ? `${product.lengthMm} × ${product.widthMm} × ${product.heightMm} mm`
      : null

  return (
    <>
      <CardHeader
        title="Supplier verification"
        description="Click through to the real supplier page and manually compare it against what Commerce OS has on file."
      />
      <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-ink-subtle">Supplier</p>
          <p className="text-sm font-medium text-ink">{preferred.supplierName}</p>
        </div>
        <div>
          <p className="text-sm text-ink-subtle">Supplier SKU</p>
          <p className="text-sm font-medium text-ink">{preferred.supplierSku ?? <span className="text-ink-subtle italic">Unknown</span>}</p>
        </div>
        <div>
          <p className="text-sm text-ink-subtle">Supplier product reference</p>
          <p className="text-sm font-medium text-ink">{preferred.connectorProductRef ?? <span className="text-ink-subtle italic">Unknown</span>}</p>
        </div>
        <div>
          <p className="text-sm text-ink-subtle">Verification link</p>
          {preferred.sourceUrl && preferred.sourceUrlType === 'product' ? (
            <a href={preferred.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-accent hover:underline">
              View supplier product ↗
            </a>
          ) : preferred.sourceUrl && preferred.sourceUrlType === 'search' ? (
            <a
              href={preferred.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-accent hover:underline"
              title="Opens the supplier's own official search using the stored product reference — Commerce OS cannot guarantee the result is the exact product; confirm that yourself."
            >
              Search supplier ↗
            </a>
          ) : (
            <p className="text-sm text-ink-subtle">Unavailable — no supplier route could be safely resolved</p>
          )}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-ink-subtle">
              <th className="px-3 py-2">Commerce OS fact</th>
              <th className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            <Fact label="Supplier title" value={product.supplierTitle} />
            <Fact label="Supplier cost" value={formatMoney(preferred.unitCostMinor, preferred.currency)} />
            <Fact label="Shipping" value={formatMoney(preferred.shippingCostMinor, preferred.currency)} />
            <Fact label="Delivery estimate" value={preferred.deliveryDaysMax !== null ? `Up to ${preferred.deliveryDaysMax} days` : null} />
            <Fact label="Stock" value={preferred.inStock === null ? null : preferred.inStock ? 'In stock' : 'Out of stock'} />
            <Fact label="Weight" value={product.weightGrams !== null ? `${product.weightGrams} g` : null} />
            <Fact label="Dimensions" value={dimensions} />
          </tbody>
        </table>
      </div>
    </>
  )
}
