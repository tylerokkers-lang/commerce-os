'use client'

import { useActionState } from 'react'
import { Badge, CardHeader, type Tone } from '@/components/ui'
import { refreshShippingQuoteAction, initialShippingState } from './shippingActions'
import type { ShopifyPublicationPreview } from '@/lib/marketplaces/shopify/publicationService'

function formatMoneyMinor(minor: number | null, currency: string | null): string {
  if (minor === null || currency === null) return 'Not available'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

function formatDeliveryDays(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'Not available'
  if (min !== null && max !== null && min !== max) return `${min}–${max} days`
  return `${max ?? min} days`
}

const STATUS_LABELS: Record<string, string> = {
  approved: 'APPROVED',
  review_required: 'REVIEW REQUIRED',
  rejected: 'REJECTED',
}

const STATUS_TONES: Record<string, Tone> = {
  approved: 'positive',
  review_required: 'caution',
  rejected: 'negative',
}

const STATUS_ICON: Record<string, string> = {
  approved: '✓',
  review_required: '⚠',
  rejected: '✕',
}

export function ShippingPanel({
  productId,
  supplier,
  supplierCurrency,
  shipping,
  canEdit,
}: {
  productId: string
  supplier: ShopifyPublicationPreview['supplier']
  supplierCurrency: string
  shipping: ShopifyPublicationPreview['shipping']
  canEdit: boolean
}) {
  const [state, formAction, pending] = useActionState(refreshShippingQuoteAction, initialShippingState)

  return (
    <>
      <CardHeader
        title="Supplier & shipping"
        description="Can this supplier realistically deliver this product to the customer, and is that fast enough?"
        action={<Badge tone={STATUS_TONES[shipping.status]}>{STATUS_ICON[shipping.status]} {STATUS_LABELS[shipping.status]}</Badge>}
      />

      <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-ink-subtle">Supplier</p>
          <p className="text-sm font-medium text-ink">{supplier?.supplierName ?? 'None selected'}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Supplier cost</p>
          <p className="text-sm font-medium text-ink">{supplier ? formatMoneyMinor(supplier.unitCostMinor, supplierCurrency) : 'Not available'}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Shipping cost</p>
          <p className="text-sm font-medium text-ink">{formatMoneyMinor(shipping.shippingCostMinor, shipping.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Delivery estimate</p>
          <p className="text-sm font-medium text-ink">{formatDeliveryDays(shipping.totalDeliveryDaysMin, shipping.totalDeliveryDaysMax)}</p>
          {shipping.method ? <p className="text-xs text-ink-subtle">via {shipping.method}</p> : null}
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Destination</p>
          <p className="text-sm font-medium text-ink">{shipping.destinationCountry === 'GB' ? 'United Kingdom' : shipping.destinationCountry}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Tracking</p>
          <p className="text-sm font-medium text-ink">{shipping.providesTracking === true ? 'Yes' : shipping.providesTracking === false ? 'No' : 'Unknown'}</p>
        </div>
      </div>

      <div className="border-t border-border px-5 py-4">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Reason</p>
        <p className="mt-1 text-sm text-ink-muted">{shipping.reason}</p>
      </div>

      {canEdit ? (
        <div className="border-t border-border px-5 py-4">
          <form action={formAction}>
            <input type="hidden" name="productId" value={productId} />
            <button type="submit" disabled={pending} className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
              {pending ? 'Checking…' : 'Check / refresh UK shipping'}
            </button>
          </form>
          {state.message ? <p className={`mt-2 text-xs ${state.status === 'error' ? 'text-negative' : 'text-ink-subtle'}`}>{state.message}</p> : null}
          <p className="mt-2 text-xs text-ink-subtle">Only works for products discovered through a connector such as CJdropshipping — a manually-captured product has no supplier API reference to check against.</p>
        </div>
      ) : null}
    </>
  )
}
