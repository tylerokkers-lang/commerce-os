'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess, requireSession, canApprove } from '@/lib/security/session'
import { captureAndValidateMedia } from '@/lib/products/media/assemble'
import { approveMedia, rejectMedia, setPrimaryMedia, removeMedia, refreshMedia } from '@/lib/products/media/moderation'
import type { MediaActionState } from './state'

/**
 * Manual media attach — the one UI-facing way today to add media to a
 * product outside supplier-candidate capture (Phase 5's own form covers
 * that path). Always `source_type: 'user_provided'`, never claimed as
 * supplier-authorised — the person attaching it is responsible for
 * having the right to use it, exactly as `mediaScore.ts`'s approved
 * reason text says.
 */
export async function attachMediaAction(_previous: MediaActionState, formData: FormData): Promise<MediaActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const mediaUrl = String(formData.get('mediaUrl') ?? '').trim()

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database, so media cannot be attached.' }
  if (!mediaUrl) return { status: 'error', message: 'An image URL is required.' }

  const result = await captureAndValidateMedia({
    orgId: session.orgId,
    productId,
    variantId: null,
    supplierId: null,
    supplierProductId: null,
    mediaUrl,
    sourceUrl: null,
    sourceType: 'user_provided',
    discoveryMethod: 'manual_attach',
    role: 'secondary',
    capturedTogether: false,
    conflictingSupplierSku: null,
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return {
    status: 'ok',
    message: result.value.isDuplicate ? `Not attached — ${result.value.validationReason}` : `Attached — ${result.value.validationReason}`,
  }
}

export async function approveMediaAction(_previous: MediaActionState, formData: FormData): Promise<MediaActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const mediaId = String(formData.get('mediaId') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }

  const result = await approveMedia(session.orgId, mediaId, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Approved.' }
}

export async function rejectMediaAction(_previous: MediaActionState, formData: FormData): Promise<MediaActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const mediaId = String(formData.get('mediaId') ?? '')
  const reason = String(formData.get('reason') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }

  const result = await rejectMedia(session.orgId, mediaId, reason, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Rejected.' }
}

export async function setPrimaryMediaAction(_previous: MediaActionState, formData: FormData): Promise<MediaActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const mediaId = String(formData.get('mediaId') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }

  const result = await setPrimaryMedia(session.orgId, productId, mediaId, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Set as primary image.' }
}

/** Owner-only, matching `product_media`'s own RLS delete policy. */
export async function removeMediaAction(_previous: MediaActionState, formData: FormData): Promise<MediaActionState> {
  const session = await requireSession()
  const productId = String(formData.get('productId') ?? '')
  const mediaId = String(formData.get('mediaId') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }
  if (!canApprove(session)) return { status: 'error', message: `Role "${session.role}" may not remove media — only an owner can.` }

  const result = await removeMedia(session.orgId, mediaId, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Removed.' }
}

export async function refreshMediaAction(_previous: MediaActionState, formData: FormData): Promise<MediaActionState> {
  const session = await requireWriteAccess()
  const productId = String(formData.get('productId') ?? '')
  const mediaId = String(formData.get('mediaId') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }

  const result = await refreshMedia(session.orgId, mediaId, { userId: session.userId, label: session.email })
  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath(`/products/${productId}`)
  return { status: 'ok', message: 'Refreshed.' }
}
