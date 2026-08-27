import 'server-only'

import type { ChannelKey, ProductDecision, ProductSummary, StockAlert } from '@/lib/core/domain'
import { demoProducts, demoStockAlerts } from '@/lib/demo/dataset'
import { PRODUCT_DECISIONS } from '@/lib/products/decision'
import { getChannelReadiness } from '@/lib/marketplaces/channelReadiness'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import { zero } from '@/lib/core/money'
import type { PublicationDecision } from '@/lib/marketplaces/publicationGate'

export async function getProducts(): Promise<readonly ProductSummary[]> {
  const session = await requireSession()
  if (session.isDemo) return demoProducts()

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, title, category, stage, decision')
    .eq('org_id', session.orgId)
    .neq('stage', 'removed')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(`Could not load products: ${error.message}`)

  // Performance figures are joined in Milestone 3 once orders flow. Until then
  // a product is shown with its real stage and no invented trading history.
  return (data ?? []).map((row) => ({
    id: row.id,
    sku: row.sku,
    title: row.title,
    category: row.category,
    stage: row.stage,
    decision: row.decision,
    healthScore: 0,
    opportunityScore: null,
    channelStatus: { shopify: 'not_listed', amazon_uk: 'not_listed', ebay: 'not_listed' },
    revenue: zero('GBP'),
    contribution: zero('GBP'),
    contributionMarginPct: null,
    unitsSold: 0,
    adSpend: zero('GBP'),
    returnRatePct: 0,
    rating: null,
    reviewCount: 0,
    trend: 'flat' as const,
    trendPct: 0,
    daysOfStock: null,
  }))
}

// `getOpportunities` used to be duplicated here, byte-for-byte identical
// to `products/opportunities.ts`'s own version — removed; that file is
// the one every real caller already used. Import from there instead.

export async function getStockAlerts(): Promise<readonly StockAlert[]> {
  const session = await requireSession()
  return session.isDemo ? demoStockAlerts() : []
}

export type ProductDecisionSummary = Record<ProductDecision, number>

const EMPTY_DECISION_SUMMARY = (): ProductDecisionSummary =>
  Object.fromEntries(PRODUCT_DECISIONS.map((d) => [d, 0])) as ProductDecisionSummary

/**
 * One grouped count per decision, org-scoped — the single real query the
 * dashboard/products page reads, never a second calculation of the same
 * thing. Counted from the same `products` rows `getProducts()` reads, not a
 * duplicated business rule.
 */
export async function getProductDecisionSummary(): Promise<ProductDecisionSummary> {
  const session = await requireSession()
  const summary = EMPTY_DECISION_SUMMARY()

  if (session.isDemo) {
    for (const product of demoProducts()) summary[product.decision]++
    return summary
  }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('products').select('decision').eq('org_id', session.orgId).neq('stage', 'removed')
  if (error) throw new Error(`Could not load product decision summary: ${error.message}`)

  for (const row of data ?? []) summary[row.decision]++
  return summary
}

export interface ProductDetail {
  id: string
  sku: string
  title: string
  category: string | null
  stage: string
  decision: ProductDecision
  decisionReason: string | null
  decisionChangedAt: string
  /** From `product_decision_transitions`' most recent row — `products` itself has no "changed by" column, only what/when. */
  decisionChangedBy: string | null
}

/**
 * The single-product read the product detail page needs. No new
 * price/margin/stock/marketplace-status computation is invented here —
 * those remain out of scope for this read until a real caller needs them
 * from their own existing, canonical source (`getProducts()`'s per-product
 * row already carries the honest zeros/nulls live mode has today).
 */
export async function getProductDetail(productId: string): Promise<ProductDetail | null> {
  const session = await requireSession()

  if (session.isDemo) {
    const product = demoProducts().find((p) => p.id === productId)
    if (!product) return null
    return {
      id: product.id,
      sku: product.sku,
      title: product.title,
      category: product.category,
      stage: product.stage,
      decision: product.decision,
      decisionReason: 'Demo data — no real decision history exists.',
      decisionChangedAt: new Date().toISOString(),
      decisionChangedBy: 'Demo',
    }
  }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, title, category, stage, decision, decision_reason, decision_changed_at')
    .eq('org_id', session.orgId)
    .eq('id', productId)
    .maybeSingle()

  if (error) throw new Error(`Could not load product: ${error.message}`)
  if (!data) return null

  const { data: lastTransition } = await supabase
    .from('product_decision_transitions')
    .select('actor_label')
    .eq('org_id', session.orgId)
    .eq('product_id', productId)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    id: data.id,
    sku: data.sku,
    title: data.title,
    category: data.category,
    stage: data.stage,
    decision: data.decision,
    decisionReason: data.decision_reason,
    decisionChangedAt: data.decision_changed_at,
    decisionChangedBy: lastTransition?.actor_label ?? null,
  }
}

const CHANNELS: readonly ChannelKey[] = ['shopify', 'amazon_uk', 'ebay']

export interface ChannelReadinessRow {
  channel: ChannelKey
  decision: ProductDecision
  decisionReason: string | null
  decisionChangedAt: string | null
  decisionChangedBy: string | null
  readiness: PublicationDecision
}

/**
 * Every channel's operator decision plus the deterministic "why" behind it
 * (`assessPublicationReadiness`, assembled from real data by
 * `channelReadiness.ts`) — the reasoning chain the product detail page
 * shows the operator. Demo mode has no real per-channel listing/supplier/
 * profitability data to assemble honestly, so it returns nothing here
 * rather than fabricating a chain (same choice `orders/repository.ts`'s
 * `getPurchaseQueue()` made for the identical reason).
 */
export async function getChannelReadinessList(product: ProductDetail): Promise<readonly ChannelReadinessRow[]> {
  const session = await requireSession()
  if (session.isDemo) return []

  const supabase = await createServerSupabase()

  const { data: decisionRows } = await supabase
    .from('channel_product_decisions')
    .select('channel, decision, decision_reason, decision_changed_at')
    .eq('org_id', session.orgId)
    .eq('product_id', product.id)

  const { data: transitionRows } = await supabase
    .from('channel_decision_transitions')
    .select('channel, actor_label, occurred_at')
    .eq('org_id', session.orgId)
    .eq('product_id', product.id)
    .order('occurred_at', { ascending: false })

  const decisionByChannel = new Map((decisionRows ?? []).map((r) => [r.channel, r]))
  const lastActorByChannel = new Map<ChannelKey, string | null>()
  for (const t of transitionRows ?? []) {
    if (!lastActorByChannel.has(t.channel)) lastActorByChannel.set(t.channel, t.actor_label)
  }

  return Promise.all(
    CHANNELS.map(async (channel) => {
      const row = decisionByChannel.get(channel)
      const decision: ProductDecision = row?.decision ?? 'review'
      const readiness = await getChannelReadiness(session.orgId, product.id, channel, product.stage as never, product.decision)
      return {
        channel,
        decision,
        decisionReason: row?.decision_reason ?? null,
        decisionChangedAt: row?.decision_changed_at ?? null,
        decisionChangedBy: lastActorByChannel.get(channel) ?? null,
        readiness,
      }
    }),
  )
}
