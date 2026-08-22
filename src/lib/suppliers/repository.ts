import 'server-only'

import type { SupplierSummary } from '@/lib/core/domain'
import { demoSuppliers } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'

export async function getSuppliers(): Promise<readonly SupplierSummary[]> {
  const session = await requireSession()
  if (session.isDemo) return demoSuppliers()

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('suppliers')
    .select('id, name, country, shopify_status, amazon_status, status_reason, typical_delivery_days_min, typical_delivery_days_max')
    .eq('org_id', session.orgId)
    .order('name')

  if (error) throw new Error(`Could not load suppliers: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    score: 0,
    shopifyStatus: row.shopify_status,
    amazonStatus: row.amazon_status,
    statusReason: row.status_reason,
    deliveryDaysMin: row.typical_delivery_days_min,
    deliveryDaysMax: row.typical_delivery_days_max,
    onTimeRatePct: null,
    productCount: 0,
  }))
}
