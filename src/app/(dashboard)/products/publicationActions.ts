'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/security/session'
import { createDraft, publishLive, pauseListing, overrideSellingPrice } from '@/lib/marketplaces/shopify/publicationService'
import type { PublicationActionState } from './state'

/**
 * Creates a Shopify DRAFT — never live. The only UI-facing trigger for
 * `createDraft` (`@/lib/marketplaces/shopify/publicationService.ts`),
 * which is itself idempotent: resubmitting this action for a product that
 * already has a Shopify listing returns the existing one rather than
 * creating a duplicate.
 */
export async function createShopifyDraftAction(_previous: PublicationActionState, formData: FormData): Promise<PublicationActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const selectedPriceMinor = Math.round(Number(formData.get('selectedPriceMajor') ?? 0) * 100)

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database, so no Shopify draft can be created.' }
  if (!selectedPriceMinor || selectedPriceMinor <= 0) return { status: 'error', message: 'Select a selling price before creating a draft.' }

  const result = await createDraft(session.orgId, productId, selectedPriceMinor, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: result.value.alreadyExisted ? 'A Shopify draft already exists for this product.' : 'Shopify draft created.' }
}

/**
 * Live publication — a genuinely separate, explicit action from draft
 * creation. Requires the user to check a confirmation box; the checkbox
 * itself has no effect on `publishLive`'s own re-checks, which happen
 * regardless of what the form says — the confirmation is a real
 * click-through, not cosmetic.
 */
export async function publishShopifyListingAction(_previous: PublicationActionState, formData: FormData): Promise<PublicationActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const confirmed = formData.get('confirmed') === 'on'

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database, so nothing can be published live.' }
  if (!confirmed) return { status: 'error', message: 'You must explicitly confirm before publishing live.' }

  const result = await publishLive(session.orgId, productId, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Published live on Shopify.' }
}

export async function pauseShopifyListingAction(_previous: PublicationActionState, formData: FormData): Promise<PublicationActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const reason = String(formData.get('reason') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }
  if (!reason.trim()) return { status: 'error', message: 'A reason is required to pause a listing.' }

  const result = await pauseListing(session.orgId, productId, reason, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Listing paused.' }
}

export async function overrideShopifyPriceAction(_previous: PublicationActionState, formData: FormData): Promise<PublicationActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const newPriceMinor = Math.round(Number(formData.get('newPriceMajor') ?? 0) * 100)
  const reason = String(formData.get('reason') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }
  if (!newPriceMinor || newPriceMinor <= 0) return { status: 'error', message: 'Enter a valid price.' }

  const result = await overrideSellingPrice(session.orgId, productId, newPriceMinor, reason, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return {
    status: 'ok',
    message: result.value.message ?? 'Price updated.',
  }
}
