import { requireSession, requireWriteAccess } from '@/lib/security/session'
import { getProductDetail } from '@/lib/products/repository'
import { executeDecisionChange } from '@/lib/products/decisionExecutor'
import { isValidProductDecision, PRODUCT_DECISIONS } from '@/lib/products/decision'
import type { ProductDecision } from '@/lib/core/domain'

/** Reads a product's current Commerce-OS decision. Any authenticated org member may read — same access model as the rest of the product read paths. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try {
    session = await requireSession()
  } catch {
    return Response.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const product = await getProductDetail(id)
  if (!product) return Response.json({ error: `No product ${id} found for this organisation.` }, { status: 404 })

  return Response.json({
    productId: product.id,
    decision: product.decision,
    reason: product.decisionReason,
    changedAt: product.decisionChangedAt,
    changedBy: product.decisionChangedBy,
    isDemo: session.isDemo,
  })
}

/** Sets a product's Commerce-OS decision. Write-access-gated (owner/admin), same as every other product/order write path in this codebase. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let session
  try {
    session = await requireWriteAccess()
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authenticated') {
      return Response.json({ error: 'Not authenticated.' }, { status: 401 })
    }
    return Response.json({ error: 'You do not have permission to change this product\'s decision.' }, { status: 403 })
  }

  if (session.isDemo) {
    return Response.json({ error: 'Demo mode has no database — changing a product decision is disabled until Supabase is connected.' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Malformed request body — expected JSON.' }, { status: 400 })
  }

  const input = body as { decision?: unknown; reason?: unknown }
  if (typeof input.decision !== 'string' || !isValidProductDecision(input.decision)) {
    return Response.json({ error: `"decision" must be one of: ${PRODUCT_DECISIONS.join(', ')}.` }, { status: 400 })
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length < 3) {
    return Response.json({ error: 'A short "reason" string is required.' }, { status: 400 })
  }

  const current = await getProductDetail(id)
  if (!current) return Response.json({ error: `No product ${id} found for this organisation.` }, { status: 404 })

  const result = await executeDecisionChange({
    orgId: session.orgId,
    productId: id,
    from: current.decision,
    to: input.decision as ProductDecision,
    reason: input.reason,
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
  return Response.json(result.value)
}
