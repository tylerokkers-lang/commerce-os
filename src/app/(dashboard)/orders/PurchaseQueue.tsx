'use client'

import { useActionState } from 'react'
import { Badge, Card, CardHeader, type Tone } from '@/components/ui'
import { formatMoney, money, type CurrencyCode } from '@/lib/core/money'
import { formatDateTime } from '@/lib/utils'
import { CHANNEL_LABELS } from '@/lib/constants'
import { recordPurchaseAction, recordShipmentAction, recordDeliveryAction } from './actions'
import { initialPurchaseQueueActionState, type PurchaseQueueActionState } from './state'
import type { PurchaseQueueItem, PurchaseQueueStatus } from '@/lib/orders/repository'

/**
 * The operator's AWAITING_PURCHASE queue (§49/§52 of HANDOVER.md — the
 * backend for this has existed since the order-ingestion milestone, but no
 * UI ever called it). Every action here only records something the operator
 * already did outside Commerce-OS — it never places an order, calls a
 * supplier, or moves money. `canEdit` mirrors `DecisionControl.tsx`'s own
 * gate: read-only roles see the queue but no forms.
 */

const STATUS_LABELS: Record<PurchaseQueueStatus, string> = {
  awaiting_supplier: 'Awaiting purchase',
  submitted: 'Purchased — awaiting shipment',
  shipped: 'Shipped — awaiting delivery',
}

const STATUS_TONES: Record<PurchaseQueueStatus, Tone> = {
  awaiting_supplier: 'caution',
  submitted: 'accent',
  shipped: 'positive',
}

const inputClass = 'mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25'
const labelClass = 'block text-sm font-medium text-ink'
const buttonClass = 'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50'

function ActionMessage({ state }: { state: PurchaseQueueActionState }) {
  if (!state.message) return null
  return <span className={state.status === 'error' ? 'text-sm text-negative' : 'text-sm text-positive'}>{state.message}</span>
}

export function PurchaseQueue({ items, canEdit }: { items: readonly PurchaseQueueItem[]; canEdit: boolean }) {
  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <PurchaseQueueCard key={item.fulfilmentId} item={item} canEdit={canEdit} />
      ))}
    </div>
  )
}

function PurchaseQueueCard({ item, canEdit }: { item: PurchaseQueueItem; canEdit: boolean }) {
  return (
    <Card>
      <CardHeader
        title={item.orderNumber}
        description={`${CHANNEL_LABELS[item.channel]} · placed ${formatDateTime(item.placedAt)}${item.supplierName ? ` · supplier: ${item.supplierName}` : ' · no supplier assigned'}`}
        action={<Badge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Badge>}
      />

      <div className="border-t border-border px-5 py-3">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Line items</p>
        <ul className="mt-2 space-y-1 text-sm">
          {item.lineItems.length === 0 ? (
            <li className="text-ink-subtle">No line items recorded for this fulfilment.</li>
          ) : (
            item.lineItems.map((li, idx) => (
              <li key={`${item.fulfilmentId}-${idx}`} className="flex justify-between gap-3">
                <span>
                  {li.description} <span className="text-ink-subtle">({li.sku})</span>
                </span>
                <span className="tabular text-ink-subtle">×{li.quantity}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      {item.status !== 'awaiting_supplier' ? (
        <div className="border-t border-border px-5 py-3 text-sm text-ink-subtle">
          Actual cost: {formatMoney(money(item.costMinor, item.currency as CurrencyCode))} + {formatMoney(money(item.shippingCostMinor, item.currency as CurrencyCode))} shipping
          {item.supplierReference ? ` · Supplier ref: ${item.supplierReference}` : ''}
        </div>
      ) : null}

      {!canEdit ? (
        <p className="border-t border-border px-5 py-3 text-sm text-ink-subtle">Your role cannot record purchases, shipments or deliveries.</p>
      ) : item.status === 'awaiting_supplier' ? (
        <PurchaseForm fulfilmentId={item.fulfilmentId} defaultCurrency={item.currency} />
      ) : item.status === 'submitted' ? (
        <ShipmentForm fulfilmentId={item.fulfilmentId} />
      ) : (
        <DeliveryForm fulfilmentId={item.fulfilmentId} />
      )}
    </Card>
  )
}

function PurchaseForm({ fulfilmentId, defaultCurrency }: { fulfilmentId: string; defaultCurrency: string }) {
  const [state, formAction, pending] = useActionState(recordPurchaseAction, initialPurchaseQueueActionState)

  return (
    <form action={formAction} className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2">
      <input type="hidden" name="fulfilmentId" value={fulfilmentId} />
      <div>
        <label className={labelClass} htmlFor={`cost-${fulfilmentId}`}>Cost paid (excl. shipping)</label>
        <input id={`cost-${fulfilmentId}`} name="cost" type="number" step="0.01" min="0" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`shipping-${fulfilmentId}`}>Shipping cost paid</label>
        <input id={`shipping-${fulfilmentId}`} name="shippingCost" type="number" step="0.01" min="0" required className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`ref-${fulfilmentId}`}>Supplier order reference</label>
        <input id={`ref-${fulfilmentId}`} name="supplierReference" type="text" required placeholder="e.g. the order # the supplier gave you" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`currency-${fulfilmentId}`}>Currency you paid in</label>
        <input id={`currency-${fulfilmentId}`} name="currency" type="text" defaultValue={defaultCurrency} maxLength={3} required className={inputClass} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? 'Recording…' : 'Record purchase'}</button>
        <ActionMessage state={state} />
      </div>
    </form>
  )
}

function ShipmentForm({ fulfilmentId }: { fulfilmentId: string }) {
  const [state, formAction, pending] = useActionState(recordShipmentAction, initialPurchaseQueueActionState)

  return (
    <form action={formAction} className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2">
      <input type="hidden" name="fulfilmentId" value={fulfilmentId} />
      <div>
        <label className={labelClass} htmlFor={`carrier-${fulfilmentId}`}>Carrier</label>
        <input id={`carrier-${fulfilmentId}`} name="carrier" type="text" required placeholder="e.g. Royal Mail" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`tracking-${fulfilmentId}`}>Tracking number</label>
        <input id={`tracking-${fulfilmentId}`} name="trackingNumber" type="text" required className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass} htmlFor={`trackingUrl-${fulfilmentId}`}>Tracking URL (optional)</label>
        <input id={`trackingUrl-${fulfilmentId}`} name="trackingUrl" type="url" className={inputClass} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? 'Recording…' : 'Record shipment'}</button>
        <ActionMessage state={state} />
      </div>
    </form>
  )
}

function DeliveryForm({ fulfilmentId }: { fulfilmentId: string }) {
  const [state, formAction, pending] = useActionState(recordDeliveryAction, initialPurchaseQueueActionState)

  return (
    <form action={formAction} className="flex items-center gap-3 border-t border-border px-5 py-4">
      <input type="hidden" name="fulfilmentId" value={fulfilmentId} />
      <button type="submit" disabled={pending} className={buttonClass}>{pending ? 'Confirming…' : 'Confirm delivery'}</button>
      <ActionMessage state={state} />
    </form>
  )
}
