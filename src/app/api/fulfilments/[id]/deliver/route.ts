import { requireSession } from '@/lib/security/session'
import { recordDelivery } from '@/lib/orders/shipmentTracking'

/** Confirms delivery for a fulfilment already marked shipped, cascading the parent order to 'delivered' once every fulfilment on it is complete. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try {
    session = await requireSession()
  } catch {
    return Response.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  if (session.isDemo) {
    return Response.json({ error: 'Demo mode has no database — recording a delivery is disabled until Supabase is connected.' }, { status: 400 })
  }

  const result = await recordDelivery({ orgId: session.orgId, fulfilmentId: id })

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json(result.value)
}
