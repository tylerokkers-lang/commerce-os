'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/security/session'
import { refreshShippingQuoteForProduct } from '@/lib/suppliers/shippingQuotes'

export interface ShippingActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export const initialShippingState: ShippingActionState = { status: 'idle', message: '' }

/**
 * "Check/refresh UK shipping" (Milestone: shipping-aware publication,
 * Phase 9) — the only UI-facing trigger for
 * `refreshShippingQuoteForProduct`. Never places an order, never
 * publishes anything; it only fetches and records a shipping fact that
 * the Shopify eligibility gate can then read.
 */
export async function refreshShippingQuoteAction(_previous: ShippingActionState, formData: FormData): Promise<ShippingActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database, so a shipping quote cannot be fetched.' }

  const result = await refreshShippingQuoteForProduct(session.orgId, productId, 'GB', { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)

  return { status: 'ok', message: `${result.value.policy.status.replace('_', ' ')}: ${result.value.policy.reason}` }
}
