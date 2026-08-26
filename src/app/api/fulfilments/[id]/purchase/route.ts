import { requireSession } from '@/lib/security/session'
import { recordSupplierPurchase } from '@/lib/orders/manualPurchase'

/**
 * Records a manual supplier purchase — the one operator action that moves a
 * fulfilment out of AWAITING_PURCHASE. You bought the goods yourself,
 * outside Commerce-OS; this only records that fact. Never places an order
 * with any supplier itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try {
    session = await requireSession()
  } catch {
    return Response.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  if (session.isDemo) {
    return Response.json({ error: 'Demo mode has no database — recording a purchase is disabled until Supabase is connected.' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request body — expected JSON.' }, { status: 400 })
  }

  const input = body as { costMinor?: unknown; shippingCostMinor?: unknown; supplierReference?: unknown; currency?: unknown }
  if (
    typeof input.costMinor !== 'number' || !Number.isInteger(input.costMinor) || input.costMinor < 0 ||
    typeof input.shippingCostMinor !== 'number' || !Number.isInteger(input.shippingCostMinor) || input.shippingCostMinor < 0 ||
    typeof input.supplierReference !== 'string' || input.supplierReference.trim().length === 0 ||
    typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)
  ) {
    return Response.json({ error: 'costMinor and shippingCostMinor must be non-negative whole minor units, supplierReference must be a non-empty string, and currency a 3-letter code.' }, { status: 400 })
  }

  const result = await recordSupplierPurchase({
    orgId: session.orgId,
    fulfilmentId: id,
    costMinor: input.costMinor,
    shippingCostMinor: input.shippingCostMinor,
    supplierReference: input.supplierReference,
    currency: input.currency,
  })

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json(result.value)
}
