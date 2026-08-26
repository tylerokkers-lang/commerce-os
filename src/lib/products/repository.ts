import 'server-only'

import type { OpportunitySummary, ProductSummary, StockAlert } from '@/lib/core/domain'
import { demoOpportunities, demoProducts, demoStockAlerts } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import { zero } from '@/lib/core/money'

export async function getProducts(): Promise<readonly ProductSummary[]> {
  const session = await requireSession()
  if (session.isDemo) return demoProducts()

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, title, category, stage')
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

export async function getOpportunities(): Promise<readonly OpportunitySummary[]> {
  const session = await requireSession()
  return session.isDemo ? demoOpportunities() : []
}

export async function getStockAlerts(): Promise<readonly StockAlert[]> {
  const session = await requireSession()
  return session.isDemo ? demoStockAlerts() : []
}
