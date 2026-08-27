'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/security/session'
import { recordSupplierPurchase } from '@/lib/orders/manualPurchase'
import { recordShipment, recordDelivery } from '@/lib/orders/shipmentTracking'
import type { PurchaseQueueActionState } from './state'

/**
 * The three operator actions that move a fulfilment through
 * awaiting_supplier -> submitted -> shipped -> delivered. Every one of these
 * only ever RECORDS something the operator already did themselves outside
 * Commerce-OS — a purchase, a shipment, a delivery. None of them place an
 * order, call a supplier API, or move money. This is deliberately the ONLY
 * UI-facing path to these functions; no automated job calls them (confirmed
 * in `manualPurchase.ts`'s and `shipmentTracking.ts`'s own doc comments).
 */

export async function recordPurchaseAction(
  _previous: PurchaseQueueActionState,
  formData: FormData,
): Promise<PurchaseQueueActionState> {
  const session = await requireWriteAccess()

  if (session.isDemo) {
    return { status: 'error', message: 'Demo mode has no database — recording a purchase is disabled until Supabase is connected.' }
  }

  const fulfilmentId = String(formData.get('fulfilmentId') ?? '')
  const costMajor = Number(formData.get('cost'))
  const shippingCostMajor = Number(formData.get('shippingCost'))
  const supplierReference = String(formData.get('supplierReference') ?? '').trim()
  const currency = String(formData.get('currency') ?? '').trim().toUpperCase()

  if (!Number.isFinite(costMajor) || costMajor < 0 || !Number.isFinite(shippingCostMajor) || shippingCostMajor < 0) {
    return { status: 'error', message: 'Cost and shipping cost must be non-negative numbers.' }
  }
  if (supplierReference.length === 0) {
    return { status: 'error', message: 'A supplier order reference is required — the reference you were given when you placed the order.' }
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { status: 'error', message: 'Currency must be a 3-letter code, e.g. GBP.' }
  }

  const result = await recordSupplierPurchase({
    orgId: session.orgId,
    fulfilmentId,
    costMinor: Math.round(costMajor * 100),
    shippingCostMinor: Math.round(shippingCostMajor * 100),
    supplierReference,
    currency,
  })

  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath('/orders')

  const variance = result.value.variance
  const varianceNote =
    variance.variancePct === null
      ? ''
      : ` (${variance.variancePct > 0 ? '+' : ''}${variance.variancePct}% vs the estimate at the time a supplier was chosen)`
  return { status: 'success', message: `Purchase recorded${varianceNote}.` }
}

export async function recordShipmentAction(
  _previous: PurchaseQueueActionState,
  formData: FormData,
): Promise<PurchaseQueueActionState> {
  const session = await requireWriteAccess()

  if (session.isDemo) {
    return { status: 'error', message: 'Demo mode has no database — recording a shipment is disabled until Supabase is connected.' }
  }

  const fulfilmentId = String(formData.get('fulfilmentId') ?? '')
  const carrier = String(formData.get('carrier') ?? '').trim()
  const trackingNumber = String(formData.get('trackingNumber') ?? '').trim()
  const trackingUrl = String(formData.get('trackingUrl') ?? '').trim()

  if (carrier.length === 0 || trackingNumber.length === 0) {
    return { status: 'error', message: 'Carrier and tracking number are both required.' }
  }

  const result = await recordShipment({
    orgId: session.orgId,
    fulfilmentId,
    carrier,
    trackingNumber,
    trackingUrl: trackingUrl.length > 0 ? trackingUrl : null,
  })

  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath('/orders')
  return { status: 'success', message: 'Shipment recorded.' }
}

export async function recordDeliveryAction(
  _previous: PurchaseQueueActionState,
  formData: FormData,
): Promise<PurchaseQueueActionState> {
  const session = await requireWriteAccess()

  if (session.isDemo) {
    return { status: 'error', message: 'Demo mode has no database — recording a delivery is disabled until Supabase is connected.' }
  }

  const fulfilmentId = String(formData.get('fulfilmentId') ?? '')
  const result = await recordDelivery({ orgId: session.orgId, fulfilmentId })

  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath('/orders')
  return { status: 'success', message: result.value.orderCascadedToDelivered ? 'Delivery confirmed — the order is now fully delivered.' : 'Delivery confirmed.' }
}
