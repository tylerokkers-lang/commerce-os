'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/security/session'
import { captureCandidate, importCandidate, rejectCandidate } from '@/lib/suppliers/discovery/ingestion'
import { getConnector } from '@/lib/suppliers/connectors/registry'
import type { CaptureFormState, QueueActionState, CjDiscoveryState } from './state'

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
    // This form's "Product URL / reference" field is already a real,
    // `type="url"`-validated supplier product link when one is entered —
    // reused directly as the canonical supplier URL, never a second,
    // duplicate input for the same fact.
    sourceReference: (formData.get('sourceReference') as string) || null,
    sourceUrl: (formData.get('sourceReference') as string) || null,
    // A human explicitly pasted this — trusted as the real product page,
    // never merely a search route, matching how this field has always
    // behaved (this milestone only adds the explicit label).
    sourceUrlType: (formData.get('sourceReference') as string) ? 'product' : null,
    imageUrl: (formData.get('imageUrl') as string) || null,
    imageUrls: [],
    variants: [],
    connectorKey: null,
    connectorProductRef: null,
    // The manual entry form has no dimension/weight/stock inputs — left
    // genuinely unknown rather than guessed, same as every other unset
    // field on this form.
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    stockQty: null,
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

/**
 * Discovery via the real CJdropshipping connector (Milestone: real
 * supplier connector, Phase 8) — a lightweight browse (`fetchStatus`,
 * genuinely rate-limited and throttled inside the connector itself),
 * never a full-detail read for every result. Capturing one specific
 * result as a candidate (`captureFromCjAction` below) is what triggers
 * the richer `readProductDetail` call, matching the brief's own
 * instruction not to hammer the API by treating a browse and an
 * inspection as the same cost.
 */
export async function discoverFromCjAction(_previous: CjDiscoveryState, formData: FormData): Promise<CjDiscoveryState> {
  await requireWriteAccess()
  const keyword = String(formData.get('keyword') ?? '').trim()

  const connector = getConnector('cjdropshipping')
  if (!connector) return { status: 'error', message: 'CJdropshipping connector is not registered.', items: [] }
  if (!connector.isConfigured()) return { status: 'error', message: 'CJdropshipping is not configured — set CJ_API_KEY to enable discovery.', items: [] }

  const result = await connector.fetchStatus({ limit: 20, keyword: keyword || undefined })
  if (!result.ok) return { status: 'error', message: result.error, items: [] }

  return {
    status: 'ok',
    message: `${result.value.statuses.length} product${result.value.statuses.length === 1 ? '' : 's'} found.`,
    items: result.value.statuses.map((s) => ({
      productRef: s.productRef,
      title: typeof s.raw.productNameEn === 'string' ? s.raw.productNameEn : typeof s.raw.nameEn === 'string' ? s.raw.nameEn : s.productRef,
      sku: s.supplierSku ?? null,
      unitCostMinor: s.unitCost.minor,
      currency: s.unitCost.currency,
      inStock: s.inStock,
    })),
  }
}

/**
 * Captures one specific CJ-discovered product as a real candidate —
 * calls the connector's richer `readProductDetail` (title, description,
 * variants, images, and a UK shipping quote), then hands the result to
 * the exact same `captureCandidate` every manual entry already goes
 * through. Never imports on its own; import remains its own explicit,
 * separately-audited action (`importCandidateAction` above).
 */
export async function captureFromCjAction(_previous: CaptureFormState, formData: FormData): Promise<CaptureFormState> {
  const session = await requireWriteAccess()
  const productRef = String(formData.get('productRef') ?? '')
  const supplierId = (formData.get('supplierId') as string) || null

  if (session.isDemo) return { status: 'error', message: 'Demo mode has no database, so candidates cannot be captured.', fieldErrors: {} }

  const connector = getConnector('cjdropshipping')
  if (!connector || !connector.isConfigured()) return { status: 'error', message: 'CJdropshipping is not configured.', fieldErrors: {} }

  const detail = await connector.readProductDetail(productRef, { destinationCountry: 'GB' })
  if (!detail.ok) return { status: 'error', message: detail.error, fieldErrors: {} }

  const primaryVariant = detail.value.variants[0]

  // Milestone: supplier product verification link. CJ's real
  // `/product/query` response has no product-page URL field (confirmed
  // live against this exact product and against CJ's own published
  // documentation) — `productUrl` is therefore always `null` today, never
  // a guessed/constructed link. When that's the case, fall back to the
  // connector's own official search route (a genuinely different, weaker
  // claim — never presented as the exact product page).
  let sourceUrl = detail.value.productUrl
  let sourceUrlType: 'product' | 'search' | null = sourceUrl ? 'product' : null
  if (!sourceUrl && connector.descriptor.capabilities.resolvesProductSourceLink) {
    const link = await connector.getProductSourceLink({ productRef, supplierSku: detail.value.supplierSku })
    if (link.ok) {
      sourceUrl = link.value.url
      sourceUrlType = link.value.type
    }
  }

  const result = await captureCandidate({
    orgId: session.orgId,
    candidateTitle: detail.value.title,
    category: detail.value.category,
    supplierId,
    supplierSku: detail.value.supplierSku,
    sourceReference: detail.value.productUrl,
    sourceUrl,
    sourceUrlType,
    imageUrl: detail.value.primaryImageUrl,
    imageUrls: detail.value.additionalImageUrls,
    variants: detail.value.variants.map((v) => ({ sku: v.sku, attributes: v.attributes, unitCostMinor: v.unitCost.minor, imageUrls: v.imageUrls, weightGrams: v.weightGrams })),
    connectorKey: 'cjdropshipping',
    connectorProductRef: productRef,
    source: 'supplier_catalogue',
    unitCostMinor: primaryVariant?.unitCost.minor ?? null,
    shippingCostMinor: detail.value.shippingQuotes[0]?.shippingCost.minor ?? null,
    currency: primaryVariant?.unitCost.currency ?? 'USD',
    deliveryDaysMin: detail.value.shippingQuotes[0]?.totalDeliveryDaysMin ?? null,
    deliveryDaysMax: detail.value.shippingQuotes[0]?.totalDeliveryDaysMax ?? null,
    notes: detail.value.description,
    // Real physical specifications and stock, when CJ reported them —
    // CJ's dimensions/weight are per-variant, so these are the primary
    // (first) variant's own real figures, the same "first variant/first
    // image represents the product" convention this file already applies
    // to `unitCostMinor` and `imageUrl` above. `null` when the supplier
    // genuinely didn't report a figure, never guessed.
    weightGrams: primaryVariant?.weightGrams ?? null,
    lengthMm: primaryVariant?.lengthMm ?? null,
    widthMm: primaryVariant?.widthMm ?? null,
    heightMm: primaryVariant?.heightMm ?? null,
    stockQty: primaryVariant?.stockQty ?? null,
    identifiers: [],
    actorUserId: session.userId,
    actorLabel: session.email,
  })

  if (!result.ok) return { status: 'error', message: result.error, fieldErrors: {} }

  revalidatePath('/suppliers/discovery')

  return {
    status: 'ok',
    message:
      result.value.status === 'duplicate'
        ? `Captured from CJdropshipping, but flagged as a possible duplicate: ${result.value.duplicateCheck.reason}`
        : `Captured from CJdropshipping — ${detail.value.variants.length} variant(s), ${(detail.value.primaryImageUrl ? 1 : 0) + detail.value.additionalImageUrls.length} image(s). Ready for review.`,
    fieldErrors: {},
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
