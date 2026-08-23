import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import type { SubjectProvider } from './runner'
import type { SupplierMonitorSubject } from './monitors/supplierMonitor'
import type { MarketplaceListingSubject } from './monitors/marketplaceMonitor'

/**
 * The live subject-enumeration layer.
 *
 * Honest scope boundary, same shape as Milestone 7's `FactsLoader`: the
 * monitors' own decision logic is real and tested; *which* entities get
 * checked on a live production run is a data-plumbing concern kept
 * separate, and only two of the five registered monitors have a real
 * live enumeration query wired here. `docs/MILESTONES.md` documents this
 * exactly — an unwired monitor still runs (and its own logic is fully
 * tested against explicit subjects), it simply has nothing to check yet on
 * a real schedule until its own enumeration query is added here.
 */
export const getLiveSubjects: SubjectProvider = async (orgId, monitorKey) => {
  const supabase = createServiceSupabase()

  if (monitorKey === 'supplier_stock_and_price') {
    const { data: offers } = await supabase.from('supplier_products').select('supplier_id, product_id').eq('org_id', orgId).eq('is_preferred', true)
    const { data: listings } = await supabase.from('channel_products').select('id, product_id').eq('org_id', orgId)
    const listingByProduct = new Map((listings ?? []).map((l) => [l.product_id, l.id]))

    return (offers ?? [])
      .map((offer): SupplierMonitorSubject | null => {
        const channelProductId = listingByProduct.get(offer.product_id)
        if (!channelProductId) return null
        return { supplierId: offer.supplier_id, productId: offer.product_id, channelProductId, entityId: offer.product_id }
      })
      .filter((s): s is SupplierMonitorSubject => s !== null)
  }

  if (monitorKey === 'marketplace_listing_sync') {
    const { data } = await supabase.from('channel_products').select('id, price_minor, status, updated_at').eq('org_id', orgId).eq('status', 'live')
    return (data ?? []).map(
      (row): MarketplaceListingSubject => ({
        connectorKey: 'shopify', // Only Shopify's live connector supports listing reads today; extended alongside further connector rollout.
        ours: { channelProductRef: row.id, priceMinor: row.price_minor ?? 0, status: row.status, recordedAt: row.updated_at },
      }),
    )
  }

  return []
}
