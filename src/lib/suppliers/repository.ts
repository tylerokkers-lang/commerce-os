import 'server-only'

import { demoSuppliers } from '@/lib/demo/dataset'
import { DEMO_SUPPLIERS, findDemoSupplier, suppliersFor } from '@/lib/demo/suppliers'
import { demoSupplierScores } from '@/lib/demo/research'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import {
  assessAmazonCapability,
  assessShopifyCapability,
  scoreSupplier,
  type ChannelCapability,
  type SupplierScore,
} from '@/lib/suppliers/scoring'
import type { SupplierListItem } from '@/lib/core/domain'
import type { Money } from '@/lib/core/money'

export async function getSuppliers(): Promise<readonly SupplierListItem[]> {
  const session = await requireSession()
  if (session.isDemo) return demoSuppliers()

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('suppliers')
    .select(
      'id, name, country, platform, shopify_status, amazon_status, status_reason, typical_delivery_days_min, typical_delivery_days_max, current_score, provides_tracking, handles_returns, supports_custom_invoice, supports_blind_shipping, orders_placed, orders_late',
    )
    .eq('org_id', session.orgId)
    .order('current_score', { ascending: false, nullsFirst: false })

  if (error) throw new Error(`Could not load suppliers: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    score: row.current_score ?? 0,
    band: row.current_score === null ? 'Not scored' : 'Scored',
    confidence: 0,
    strengths: [],
    weaknesses: [],
    shopifyStatus: row.shopify_status,
    amazonStatus: row.amazon_status,
    statusReason: row.status_reason,
    deliveryDaysMin: row.typical_delivery_days_min,
    deliveryDaysMax: row.typical_delivery_days_max,
    onTimeRatePct:
      row.orders_placed === 0
        ? null
        : Math.round(((row.orders_placed - row.orders_late) / row.orders_placed) * 1000) / 10,
    productCount: 0,
    platform: row.platform,
    providesTracking: row.provides_tracking,
    handlesReturns: row.handles_returns,
    supportsCustomInvoice: row.supports_custom_invoice,
    supportsBlindShipping: row.supports_blind_shipping,
    ordersPlaced: row.orders_placed,
  }))
}

export interface SupplierProductQuote {
  candidateRef: string
  productTitle: string
  unitCost: Money
  shippingCost: Money
  /** True when this supplier is the cheapest quoting for that product. */
  isCheapest: boolean
  /** True when the ranking engine would pick this supplier for the product. */
  isRecommended: boolean
}

export interface SupplierDetail {
  id: string
  name: string
  companyName: string | null
  website: string | null
  contactEmail: string | null
  country: string | null
  platform: string | null
  notes: string | null
  returnsPolicy: string | null

  score: SupplierScore
  shopify: ChannelCapability
  amazon: ChannelCapability

  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  ordersPlaced: number
  ordersLate: number
  ordersDefective: number
  qualityRating: number | null
  communicationRating: number | null
  onTimeRatePct: number | null

  providesTracking: boolean
  handlesReturns: boolean
  acceptsFaultyReturns: boolean
  returnsWindowDays: number | null
  supportsBlindShipping: boolean
  supportsCustomInvoice: boolean
  supportsCustomPackaging: boolean
  supportsOwnBranding: boolean
  documentCount: number

  quotes: readonly SupplierProductQuote[]
  isDemo: boolean
}

/**
 * One supplier in full, including how it compares on the products it quotes for.
 *
 * The per-product comparison is where the "not simply the cheapest" rule
 * becomes visible: a supplier can be cheapest on a product and still not be the
 * recommendation.
 */
export async function getSupplierDetail(id: string): Promise<SupplierDetail | null> {
  const session = await requireSession()
  if (!session.isDemo) {
    // Live supplier detail arrives with the persistence path in a later
    // milestone. Returning null keeps the route honest rather than partial.
    return null
  }

  const supplier = findDemoSupplier(id)
  if (!supplier) return null

  const score = demoSupplierScores().get(id)!
  const placed = supplier.signals.ordersPlaced ?? 0
  const late = supplier.signals.ordersLate ?? 0

  const quotes: SupplierProductQuote[] = supplier.supplies.map((ref) => {
    const quoting = suppliersFor(ref)
    const landed = (q: (typeof quoting)[number]) =>
      q.signals.unitCost.minor + q.signals.shippingCost.minor
    const cheapest = Math.min(...quoting.map(landed))

    const scored = quoting
      .map((q) => ({ q, s: scoreSupplier(q.signals) }))
      .sort((a, b) => b.s.total - a.s.total)

    const mine = quoting.find((q) => q.id === id)!

    return {
      candidateRef: ref,
      productTitle: ref
        .replace(/^demo-/, '')
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      unitCost: mine.signals.unitCost,
      shippingCost: mine.signals.shippingCost,
      isCheapest: landed(mine) === cheapest,
      isRecommended: scored[0].q.id === id,
    }
  })

  return {
    id: supplier.id,
    name: supplier.name,
    companyName: supplier.companyName,
    website: supplier.website,
    contactEmail: supplier.contactEmail,
    country: supplier.country,
    platform: supplier.platform,
    notes: supplier.notes,
    returnsPolicy: supplier.returnsPolicy,
    score,
    shopify: assessShopifyCapability(supplier.signals),
    amazon: assessAmazonCapability(supplier.signals),
    deliveryDaysMin: supplier.signals.deliveryDaysMin ?? null,
    deliveryDaysMax: supplier.signals.deliveryDaysMax ?? null,
    ordersPlaced: placed,
    ordersLate: late,
    ordersDefective: supplier.signals.ordersDefective ?? 0,
    qualityRating: supplier.signals.qualityRating ?? null,
    communicationRating: supplier.signals.communicationRating ?? null,
    onTimeRatePct: placed === 0 ? null : Math.round(((placed - late) / placed) * 1000) / 10,
    providesTracking: supplier.signals.providesTracking,
    handlesReturns: supplier.signals.handlesReturns,
    acceptsFaultyReturns: supplier.signals.acceptsFaultyReturns,
    returnsWindowDays: supplier.signals.returnsWindowDays ?? null,
    supportsBlindShipping: supplier.signals.supportsBlindShipping,
    supportsCustomInvoice: supplier.signals.supportsCustomInvoice,
    supportsCustomPackaging: supplier.signals.supportsCustomPackaging,
    supportsOwnBranding: supplier.signals.supportsOwnBranding,
    documentCount: supplier.documentCount,
    quotes,
    isDemo: true,
  }
}

export const demoSupplierIds = (): readonly string[] => DEMO_SUPPLIERS.map((s) => s.id)
