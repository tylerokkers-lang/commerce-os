'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/security/session'
import { captureCandidate, importCandidate, rejectCandidate } from '@/lib/suppliers/discovery/ingestion'
import type { CaptureFormState, QueueActionState } from './state'

/**
 * Manual candidate capture — the "MANUAL SUPPLIER ENTRY" workflow the
 * brief asks for. Any future connector's `discoverProducts()` output
 * would call `captureCandidate` the same way; this action is simply the
 * one legitimate way to reach it today, since no connector is live.
 */
export async function captureCandidateAction(_previous: CaptureFormState, formData: FormData): Promise<CaptureFormState> {
  const session = await requireWriteAccess()

  const numberOrNull = (name: string) => {
    const raw = formData.get(name)
    return raw === null || String(raw).trim() === '' ? null : Number(raw)
  }

  if (session.isDemo) {
    return { status: 'error', message: 'Demo mode has no database, so candidates cannot be captured.', fieldErrors: {} }
  }

  const result = await captureCandidate({
    orgId: session.orgId,
    candidateTitle: String(formData.get('candidateTitle') ?? '').trim(),
    category: (formData.get('category') as string) || null,
    supplierId: (formData.get('supplierId') as string) || null,
    supplierSku: (formData.get('supplierSku') as string) || null,
    sourceReference: (formData.get('sourceReference') as string) || null,
    imageUrl: (formData.get('imageUrl') as string) || null,
    source: 'manual',
    unitCostMinor: (() => {
      const major = numberOrNull('unitCostMajor')
      return major === null ? null : Math.round(major * 100)
    })(),
    shippingCostMinor: (() => {
      const major = numberOrNull('shippingCostMajor')
      return major === null ? null : Math.round(major * 100)
    })(),
    currency: String(formData.get('currency') ?? 'GBP').trim() || 'GBP',
    deliveryDaysMin: numberOrNull('deliveryDaysMin'),
    deliveryDaysMax: numberOrNull('deliveryDaysMax'),
    notes: (formData.get('notes') as string) || null,
    identifiers: [],
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!result.ok) {
    return { status: 'error', message: result.error, fieldErrors: {} }
  }

  revalidatePath('/suppliers/discovery')

  return {
    status: 'ok',
    message:
      result.value.status === 'duplicate'
        ? `Captured, but flagged as a possible duplicate: ${result.value.duplicateCheck.reason}`
        : 'Candidate captured — ready for review.',
    fieldErrors: {},
  }
}

export async function importCandidateAction(_previous: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const session = await requireWriteAccess()
  const candidateId = String(formData.get('candidateId') ?? '')
  const acknowledgeDuplicate = formData.get('acknowledgeDuplicate') === 'on'

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }

  const result = await importCandidate(session.orgId, candidateId, { userId: session.userId, label: session.email }, { acknowledgeDuplicate })

  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath('/suppliers/discovery')
  revalidatePath('/products')

  return {
    status: 'ok',
    message: result.value.intelligenceComputed
      ? 'Imported and product intelligence calculated — see the product page.'
      : 'Imported. Product intelligence could not be calculated automatically — recalculate from the product page.',
  }
}

export async function rejectCandidateAction(_previous: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const session = await requireWriteAccess()
  const candidateId = String(formData.get('candidateId') ?? '')
  const reason = String(formData.get('reason') ?? '')

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database.' }

  const result = await rejectCandidate(session.orgId, candidateId, reason, { userId: session.userId, label: session.email })

  if (!result.ok) return { status: 'error', message: result.error }

  revalidatePath('/suppliers/discovery')

  return { status: 'ok', message: 'Candidate rejected.' }
}
