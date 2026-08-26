import { requireSession } from '@/lib/security/session'
import { recordShipment } from '@/lib/orders/shipmentTracking'

/** Records shipment/tracking for a fulfilment already marked purchased. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try {
    session = await requireSession()
  } catch {
    return Response.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  if (session.isDemo) {
    return Response.json({ error: 'Demo mode has no database — recording a shipment is disabled until Supabase is connected.' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request body — expected JSON.' }, { status: 400 })
  }

  const input = body as { carrier?: unknown; trackingNumber?: unknown; trackingUrl?: unknown }
  if (typeof input.carrier !== 'string' || input.carrier.trim().length === 0 || typeof input.trackingNumber !== 'string' || input.trackingNumber.trim().length === 0) {
    return Response.json({ error: 'carrier and trackingNumber are both required, non-empty strings.' }, { status: 400 })
  }
  if (input.trackingUrl !== undefined && typeof input.trackingUrl !== 'string') {
    return Response.json({ error: 'trackingUrl, if provided, must be a string.' }, { status: 400 })
  }

  const result = await recordShipment({
    orgId: session.orgId,
    fulfilmentId: id,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    trackingUrl: (input.trackingUrl as string | undefined) ?? null,
  })

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json(result.value)
}
